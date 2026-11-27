"""`regents techtree orders create`: pack sanitized intake materials (<= 5 MiB .tar.gz)
and submit a Techtree Uplift Factory order with optional Runbook automation settings."""

from __future__ import annotations

import base64
import gzip
import hashlib
import io
import re
import tarfile
from dataclasses import replace
from pathlib import Path
from typing import Any, Final

import click
from rich.console import RenderableType
from rich.panel import Panel
from rich.table import Table

from regents_cli import output, runner, siwa
from regents_cli.errors import CommandError, UsageError
from regents_cli.http import Request, base_address, send
from regents_cli.next_steps import Step, run
from regents_cli.platforms import DEFAULT_TIMEOUT_MS
from regents_cli.techtree.commands.answers import BASE_URL, JSON
from regents_cli.techtree.site import site_base

#: Matches Regents' & OrderBridge's 5 MiB intake archive cap and 25 MiB unpacked cap.
MAX_INTAKE_BYTES: Final = 5 * 1024 * 1024
MAX_UNPACKED_INTAKE_BYTES: Final = 25 * 1024 * 1024
_SITE: Final = "regents"
_ORDERS_PATH: Final = "/api/v1/techtree/account/orders"
_LANES: Final = ("skills", "evals", "environments", "models")
_MODES: Final = ("supervised", "auto")
_GPUS: Final = ("auto", "L4", "G4", "A100", "H100")
_TRAIN_MODES: Final = ("sft", "rl")
_SKIP_NAMES: Final = frozenset({".DS_Store", ".git", ".venv", "__pycache__", ".netrc"})
# Matches uplift-factory Job.Material: strip secrets & macOS metadata while keeping
# safe .env.example / .env.sample / .env.template fixtures for :environments repos.
_SECRET_RE: Final = re.compile(
    r"^(\._.*|\.env(\.(?!example$|sample$|template$).+|rc)?|id_(rsa|dsa|ecdsa|ed25519)|.*\.(pem|key|p12|pfx))$",
    re.I,
)


def pack_materials(path: Path) -> tuple[bytes, str, int]:
    """Pack a local directory or validate an existing .tar.gz into clean <= 5 MiB bytes
    (zero macOS `._*` AppleDouble entries, zero symlinks, zero path traversal)."""
    if path.is_file():
        raw = path.read_bytes()
        _validate_existing_tgz(raw)
        return raw, hashlib.sha256(raw).hexdigest(), len(raw)

    if not path.is_dir():
        raise UsageError(f"Materials path does not exist: {path}")

    root = path.resolve()
    files: list[tuple[str, Path]] = []
    for item in sorted(root.rglob("*")):
        rel = item.relative_to(root)
        if any(_should_skip(part) for part in rel.parts):
            continue
        if item.is_symlink():
            continue
        if item.is_file():
            files.append((rel.as_posix(), item))

    if not files:
        raise UsageError(f"Materials folder contains no packable files: {path}")

    buf = io.BytesIO()
    with (
        gzip.GzipFile(filename="", mode="wb", fileobj=buf, mtime=0) as gz,
        tarfile.open(fileobj=gz, mode="w", format=tarfile.USTAR_FORMAT) as tf,
    ):
        for rel_posix, full_path in files:
            data = full_path.read_bytes()
            info = tarfile.TarInfo(name=rel_posix)
            info.size = len(data)
            info.mode = 0o644
            info.mtime = 0
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            tf.addfile(info, io.BytesIO(data))

    raw = buf.getvalue()
    if len(raw) > MAX_INTAKE_BYTES:
        raise CommandError(
            "materials_too_large",
            f"Packed materials archive is {len(raw):,} bytes, exceeding the 5 MiB "
            f"({MAX_INTAKE_BYTES:,} byte) intake limit.",
        )
    return raw, hashlib.sha256(raw).hexdigest(), len(raw)


def _should_skip(name: str) -> bool:
    return name in _SKIP_NAMES or bool(_SECRET_RE.match(name))


def _validate_existing_tgz(raw: bytes) -> None:
    if not raw:
        raise UsageError("Materials archive is empty.")
    if len(raw) > MAX_INTAKE_BYTES:
        raise CommandError(
            "materials_too_large",
            f"Materials archive is {len(raw):,} bytes, exceeding the 5 MiB intake limit.",
        )
    try:
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tf:
            members = tf.getmembers()
            if not any(m.isfile() for m in members):
                raise UsageError("Materials archive contains no files.")
            total_unpacked = 0
            for member in members:
                if member.issym() or member.islnk():
                    raise UsageError(
                        f"Materials archive contains a link ({member.name}), which is refused."
                    )
                if not (member.isfile() or member.isdir()):
                    raise UsageError(
                        f"Materials archive contains unsupported entry ({member.name}), "
                        "which is refused."
                    )
                name = member.name.rstrip("/")
                parts = Path(name).parts
                if name.startswith("/") or ".." in parts or "\\" in name:
                    raise UsageError(f"Materials archive contains unsafe path: {member.name}")
                if member.isfile():
                    total_unpacked += member.size
                    if total_unpacked > MAX_UNPACKED_INTAKE_BYTES:
                        raise CommandError(
                            "materials_too_large",
                            f"Materials archive unpacks past the 25 MiB "
                            f"({MAX_UNPACKED_INTAKE_BYTES:,} byte) safety limit.",
                        )
    except tarfile.TarError as exc:
        raise UsageError(f"Materials file is not a valid gzipped tar archive: {exc}") from None


def _render_order(order: dict[str, Any]) -> list[RenderableType]:
    grid = Table.grid(padding=(0, 2))
    grid.add_column(style="bold", no_wrap=True)
    grid.add_column(overflow="fold")
    grid.add_row("Order ID", str(order.get("id")))
    grid.add_row("Lane", str(order.get("lane")))
    grid.add_row("Title", str(order.get("title")))
    grid.add_row("Project slug", str(order.get("project_name") or "—"))
    grid.add_row("State", str(order.get("state")))
    runbook = order.get("runbook")
    if isinstance(runbook, dict):
        grid.add_row(
            "Runbook",
            f"mode={runbook.get('mode')} · auto_deliver={runbook.get('auto_deliver')} · "
            f"max_gpu_cents={runbook.get('max_gpu_cents')} · gpu={runbook.get('default_gpu')} · "
            f"training={runbook.get('default_training_mode')}",
        )
    materials = order.get("materials")
    if isinstance(materials, dict):
        grid.add_row(
            "Materials",
            f"{materials.get('size_bytes', 0):,} bytes · sha256:{materials.get('sha256')}",
        )
    return [
        Panel(
            grid,
            title="Techtree · Uplift Factory Order Created",
            title_align="left",
            border_style="cyan",
        )
    ]


def _signed_by_caller(base: str, req: Request, timeout_ms: int) -> Request:
    """Verify a `--phase prepare` envelope piped back with its external SIWA signature."""
    piped = runner.read_stdin(timeout_ms)
    shape = (
        '{"request": …, "signature": …} '
        "(the request is --phase prepare's answer, less its next_steps)"
    )
    if not isinstance(piped, dict) or set(piped) != {"request", "signature"}:
        raise UsageError(f"stdin must hold {shape}.")
    given, signature = piped["request"], piped["signature"]
    keys = {"contract", "origin", "method", "path", "body", "headers", "message"}
    if (
        not isinstance(given, dict)
        or set(given) != keys
        or not isinstance(given["headers"], dict)
        or not isinstance(given["body"], str)
        or not isinstance(signature, str)
    ):
        raise UsageError(f"stdin must hold {shape}.")
    if given["contract"] != siwa.contract_id():
        raise UsageError(
            "This request was prepared under another signing contract than this regents signs "
            "with. Prepare it again with --phase prepare and sign the new message."
        )
    if (given["origin"], given["method"], given["path"]) != (base, req.method, req.target):
        raise UsageError("The prepared request is for another site, method or path.")
    expected_bytes = req.content
    if expected_bytes is None or given["body"].encode("utf-8") != expected_bytes:
        raise UsageError("The prepared body does not match this command's flags and materials.")
    headers, message = siwa.rebuild(req, given["headers"], base)
    if message != given["message"]:
        raise UsageError("The prepared message does not match its request.")
    return replace(req, headers=siwa.with_signature(headers, signature))


def _prepare_send_command(
    *,
    lane: str,
    title: str,
    success: str,
    project_name: str | None,
    materials: Path | None,
    company: str | None,
    contact_name: str | None,
    contact_email: str | None,
    mode: str,
    auto_deliver: bool,
    max_gpu_cents: int,
    gpu: str,
    learning_rate: float,
    training_mode: str,
    base_url: str | None,
    timeout_ms: int,
    as_json: bool,
) -> list[str]:
    return [
        "regents",
        "techtree",
        "orders",
        "create",
        "--lane",
        lane,
        "--title",
        title,
        "--success",
        success,
        *(["--project-name", project_name] if project_name else []),
        *(["--materials", str(materials)] if materials is not None else []),
        *(["--company", company] if company else []),
        *(["--contact-name", contact_name] if contact_name else []),
        *(["--contact-email", contact_email] if contact_email else []),
        "--mode",
        mode,
        "--auto-deliver" if auto_deliver else "--no-auto-deliver",
        "--max-gpu-cents",
        str(max_gpu_cents),
        "--gpu",
        gpu,
        "--learning-rate",
        str(learning_rate),
        "--training-mode",
        training_mode,
        *(["--base-url", base_url] if base_url else []),
        *(["--timeout-ms", str(timeout_ms)] if timeout_ms != DEFAULT_TIMEOUT_MS else []),
        "--phase",
        "send",
        *(["--json"] if as_json else []),
    ]


def create_order(
    lane: str,
    title: str,
    success: str,
    project_name: str | None,
    materials: Path | None,
    company: str | None,
    contact_name: str | None,
    contact_email: str | None,
    mode: str,
    auto_deliver: bool,
    max_gpu_cents: int,
    gpu: str,
    learning_rate: float,
    training_mode: str,
    phase: str | None,
    base_url: str | None,
    timeout_ms: int,
    as_json: bool,
) -> None:
    body: dict[str, Any] = {
        "lane": lane,
        "title": title,
        "success": success,
        "runbook": {
            "mode": mode,
            "auto_deliver": auto_deliver,
            "max_gpu_cents": max_gpu_cents,
            "default_gpu": gpu,
            "default_learning_rate": learning_rate,
            "default_training_mode": training_mode,
        },
    }
    if project_name:
        body["project_name"] = project_name
    if company:
        body["customer_company"] = company
    if contact_name:
        body["customer_contact_name"] = contact_name
    if contact_email:
        body["customer_contact_email"] = contact_email

    if materials is not None:
        raw, _digest, _size = pack_materials(materials)
        body["material_archive_base64"] = base64.b64encode(raw).decode("ascii")

    base = base_address(
        base_url,
        "TECHTREE_BASE_URL",
        site_base(None),
        fallback_env_var="REGENTS_BASE_URL",
    )
    req = Request("POST", _ORDERS_PATH, body=body)

    siwa.signs_for(_SITE, base, timeout_ms)
    if phase == "send":
        signed = _signed_by_caller(base, req, timeout_ms)
    else:
        receipt = siwa.current(_SITE, timeout_ms)
        if phase == "prepare":
            ready = runner.prepared(base, req, receipt)
            send_cmd = _prepare_send_command(
                lane=lane,
                title=title,
                success=success,
                project_name=project_name,
                materials=materials,
                company=company,
                contact_name=contact_name,
                contact_email=contact_email,
                mode=mode,
                auto_deliver=auto_deliver,
                max_gpu_cents=max_gpu_cents,
                gpu=gpu,
                learning_rate=learning_rate,
                training_mode=training_mode,
                base_url=base_url,
                timeout_ms=timeout_ms,
                as_json=as_json,
            )
            output.emit(
                ready,
                as_json=as_json,
                next_steps=[runner.send_signed(ready, send_cmd)],
            )
            return
        signed = replace(req, headers=siwa.sign(req, receipt, base))

    created = send(base, signed, max(timeout_ms, 60_000))
    if not isinstance(created, dict) or not created.get("id"):
        raise CommandError("invalid_response", "The site did not return the created order.")

    order_id = str(created["id"])
    shared = [*(["--base-url", base_url] if base_url else []), *(["--json"] if as_json else [])]
    steps: list[Step] = [
        run(
            ["regents", "techtree", "orders", "show", order_id, *shared],
            "Check the order's quote and delivery status.",
        ),
        run(
            ["regents", "techtree", "orders", "list", *shared],
            "List all Techtree Uplift Factory orders.",
        ),
    ]
    shown = None if as_json else _render_order(created)
    output.emit(created, as_json=as_json, next_steps=steps, shown=shown)


ORDERS = click.Group(
    "orders",
    help="Request, inspect, and cancel Techtree Uplift Factory orders.",
    no_args_is_help=True,
)
ORDERS.add_command(
    click.Command(
        "create",
        callback=create_order,
        help="Submit a new Techtree Uplift Factory order with optional <= 5 MiB materials "
        "(directory packed cleanly in Python or verified .tar.gz) and Runbook policy.",
        params=[
            click.Option(
                ["--lane"],
                type=click.Choice(_LANES),
                required=True,
                help="Uplift Factory lane.",
            ),
            click.Option(["--title"], required=True, help="Short order title (1-200 chars)."),
            click.Option(
                ["--success"],
                required=True,
                help="Measurable success statement (1-2000 chars).",
            ),
            click.Option(
                ["--project-name"],
                help="Optional lowercase-hyphenated project slug (at most 63 chars).",
            ),
            click.Option(
                ["--materials"],
                type=click.Path(exists=True, path_type=Path),
                help="Local directory or .tar.gz archive (<= 5 MiB) of customer intake materials.",
            ),
            click.Option(["--company"], help="Customer company name."),
            click.Option(["--contact-name"], help="Customer contact name."),
            click.Option(["--contact-email"], help="Customer contact email."),
            click.Option(
                ["--mode"],
                type=click.Choice(_MODES),
                default="supervised",
                show_default=True,
                help="Factory Runbook automation mode.",
            ),
            click.Option(
                ["--auto-deliver/--no-auto-deliver"],
                default=False,
                show_default=True,
                help="Allow invariant-gated auto-delivery once the final report passes.",
            ),
            click.Option(
                ["--max-gpu-cents"],
                type=click.IntRange(0, 1_000_000),
                default=500,
                show_default=True,
                help="Maximum GPU spend cap in cents for auto-approval.",
            ),
            click.Option(
                ["--gpu"],
                type=click.Choice(_GPUS),
                default="auto",
                show_default=True,
                help="Preferred Colab GPU tier.",
            ),
            click.Option(
                ["--learning-rate"],
                type=click.FloatRange(min=1e-7, max=1.0),
                default=0.0002,
                show_default=True,
                help="Default learning rate for model training.",
            ),
            click.Option(
                ["--training-mode"],
                type=click.Choice(_TRAIN_MODES),
                default="sft",
                show_default=True,
                help="Default model training mode (sft or rl).",
            ),
            click.Option(
                ["--phase"],
                type=click.Choice(["prepare", "send"]),
                default=None,
                help=(
                    "For an external SIWA signer: --phase prepare prints the request and message "
                    'to personal_sign; --phase send reads {"request": ..., "signature": ...} '
                    "from stdin and sends it."
                ),
            ),
            BASE_URL,
            click.Option(
                ["--timeout-ms"],
                type=click.IntRange(1, 300_000),
                default=DEFAULT_TIMEOUT_MS,
                show_default=True,
                help="How long to wait for the answer.",
            ),
            JSON,
        ],
    )
)
