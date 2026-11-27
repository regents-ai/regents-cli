"""`regents techtree account project-package`: download, SHA-256 verify, and inspect a
delivered Techtree project package (`uplift-package/1` or `uplift-package/2`)."""

from __future__ import annotations

import hashlib
import io
import json
import re
import tarfile
from dataclasses import replace
from pathlib import Path
from typing import Any, Final

import click
import httpx
from rich.console import Group, RenderableType
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from regents_cli import output, siwa
from regents_cli.errors import EXIT_UNREACHABLE, CommandError, UsageError
from regents_cli.http import Request, answer, base_address, client_header, send
from regents_cli.next_steps import Step, done, run
from regents_cli.platforms import DEFAULT_TIMEOUT_MS
from regents_cli.techtree.commands.answers import BASE_URL, JSON
from regents_cli.techtree.site import site_base

#: Matches Regents' 128 MiB maximum delivered project package (for 4B-8B LoRA adapters).
MAX_PACKAGE_BYTES: Final = 128 * 1024 * 1024
_UUID_RE: Final = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_SITE: Final = "regents"
_ENCODING_HEADERS: Final = frozenset({"content-encoding", "content-length", "transfer-encoding"})


def verify_and_inspect_archive(
    raw_bytes: bytes,
    *,
    expected_sha256: str,
    expected_size: int | None = None,
    inspect_archive: bool = True,
) -> dict[str, Any]:
    """Verify exact SHA-256 + size of a downloaded archive and optionally inspect
    manifest/rerun_test in memory without extracting to disk."""
    actual_sha = hashlib.sha256(raw_bytes).hexdigest()
    actual_size = len(raw_bytes)
    if actual_sha != expected_sha256.lower():
        raise CommandError(
            "package_digest_mismatch",
            f"Downloaded package SHA-256 {actual_sha} does not match expected {expected_sha256}. "
            "Nothing was written to disk.",
        )
    if expected_size is not None and actual_size != expected_size:
        raise CommandError(
            "package_size_mismatch",
            f"Downloaded package size {actual_size} bytes does not match expected "
            f"{expected_size} bytes. Nothing was written to disk.",
        )

    if not inspect_archive:
        return {
            "sha256": actual_sha,
            "sha256_verified": True,
            "size_bytes": actual_size,
            "file_count": None,
            "schema": None,
            "line": None,
            "verdict": None,
            "rerun_test": None,
        }

    manifest: dict[str, Any] | None = None
    rerun_test: dict[str, Any] | None = None
    file_count = 0
    try:
        with tarfile.open(fileobj=io.BytesIO(raw_bytes), mode="r:gz") as tf:
            for member in tf.getmembers():
                if not member.isfile():
                    continue
                file_count += 1
                parts = Path(member.name).parts
                norm = "/".join(parts)
                rel = "/".join(parts[1:]) if len(parts) > 1 else norm
                if rel == "manifest.json" or norm == "manifest.json":
                    extracted = tf.extractfile(member)
                    if extracted is not None:
                        parsed = json.loads(extracted.read().decode("utf-8"))
                        if isinstance(parsed, dict):
                            manifest = parsed
                elif rel == "rerun/test.json" or norm == "rerun/test.json":
                    extracted = tf.extractfile(member)
                    if extracted is not None:
                        parsed = json.loads(extracted.read().decode("utf-8"))
                        if isinstance(parsed, dict):
                            rerun_test = parsed
    except (tarfile.TarError, OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CommandError(
            "invalid_package_archive",
            f"Verified SHA-256, but archive inspection failed: {exc}",
        ) from None

    return {
        "sha256": actual_sha,
        "sha256_verified": True,
        "size_bytes": actual_size,
        "file_count": file_count,
        "schema": manifest.get("schema") if manifest else None,
        "line": manifest.get("line") if manifest else None,
        "verdict": manifest.get("verdict") if manifest else None,
        "rerun_test": rerun_test,
    }


def _download_signed_bytes(
    base: str,
    path: str,
    receipt: siwa.Receipt,
    timeout_ms: int,
) -> bytes:
    request = Request(
        "GET",
        path,
        headers={"accept": "application/gzip", "accept-encoding": "identity"},
    )
    signed = replace(request, headers=siwa.sign(request, receipt, base))
    timeout = timeout_ms / 1000.0
    try:
        with httpx.Client(timeout=timeout) as session:
            req = session.build_request(
                "GET",
                base + path,
                headers={**signed.headers, **client_header()},
            )
            # SECURITY: never follow redirects on signed requests or binary downloads.
            response = session.send(req, stream=True, follow_redirects=False)
            try:
                encoding = response.headers.get("content-encoding", "").strip().lower()
                if response.status_code == 200 and encoding not in {"", "identity"}:
                    raise CommandError(
                        "unexpected_content_encoding",
                        f"Refused package response with unexpected Content-Encoding: {encoding!r}.",
                    )
                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_raw():
                    chunks.append(chunk)
                    total += len(chunk)
                    if total > MAX_PACKAGE_BYTES:
                        raise CommandError(
                            "package_too_large",
                            f"Package exceeded the {MAX_PACKAGE_BYTES} byte safety limit.",
                        )
                body = b"".join(chunks)
            finally:
                response.close()
    except httpx.HTTPError:
        raise CommandError(
            "unreachable",
            f"{base} could not be reached. The request was not retried.",
            exit_code=EXIT_UNREACHABLE,
        ) from None

    if response.status_code != 200:
        headers = {k: v for k, v in response.headers.items() if k.lower() not in _ENCODING_HEADERS}
        answer(httpx.Response(response.status_code, headers=headers, content=body))
        raise CommandError(
            "download_failed",
            f"{base}{path} returned HTTP {response.status_code}.",
        )
    return body


def _default_filename(title: str, project_id: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60].strip("-")
    prefix = f"{slug}-" if slug else ""
    return f"{prefix}{project_id[:8]}.tar.gz"


def _render_panel(
    project: dict[str, Any],
    inspection: dict[str, Any],
    dest: Path,
) -> list[RenderableType]:
    grid = Table.grid(padding=(0, 2))
    grid.add_column(style="bold", no_wrap=True)
    grid.add_column(overflow="fold")
    grid.add_row("Project", str(project.get("title") or project.get("id")))
    grid.add_row("Service", str(project.get("service") or inspection.get("line") or "unknown"))
    grid.add_row("Verdict", str(project.get("verdict_name") or project.get("verdict") or "unknown"))
    if inspection.get("schema"):
        grid.add_row("Schema", f"{inspection['schema']} ({inspection['file_count']} files)")
    grid.add_row("Saved to", str(dest))
    grid.add_row("Size", f"{inspection['size_bytes']:,} bytes")
    grid.add_row("SHA-256", f"{inspection['sha256']} (verified)")

    blocks: list[RenderableType] = [grid]
    rerun_test = inspection.get("rerun_test") or project.get("rerun_test")
    if isinstance(rerun_test, dict):
        training = rerun_test.get("training")
        if isinstance(training, dict):
            prompt_mode = training.get("inference_prompt_mode")
            mode = training.get("mode")
            verified = rerun_test.get("source_verified") is True
            grid.add_row("Training mode", str(mode or "unknown"))
            grid.add_row("Source weights", "verified" if verified else "unverified")
            if prompt_mode == "no_skill":
                blocks.append(
                    Text(
                        "\nPrompt Alignment Law (no_skill): trained WITHOUT SKILL.md — "
                        "do not re-attach a Skill prompt when serving this adapter.",
                        style="bold yellow",
                    )
                )
            elif prompt_mode == "with_skill":
                blocks.append(
                    Text(
                        "\nPrompt Alignment Law (with_skill): trained WITH SKILL.md — "
                        "keep the exact training Skill prompt attached at inference.",
                        style="bold cyan",
                    )
                )
        elif rerun_test.get("kind") == "environment":
            tasks = rerun_test.get("tasks") or []
            grid.add_row("Sound tasks", str(len(tasks)))
        elif rerun_test.get("kind") == "eval":
            cases = rerun_test.get("cases") or []
            grid.add_row("Reviewed cases", str(len(cases)))

    return [
        Panel(
            Group(*blocks),
            title="Techtree · Verified Project Package",
            title_align="left",
            border_style="green",
        )
    ]


def project_package(
    project_id: str,
    out: Path | None,
    inspect_archive: bool,
    base_url: str | None,
    timeout_ms: int,
    as_json: bool,
) -> None:
    if not _UUID_RE.fullmatch(project_id):
        raise UsageError(f"{project_id!r} is not a project UUID.")

    base = base_address(
        base_url,
        "TECHTREE_BASE_URL",
        site_base(None),
        fallback_env_var="REGENTS_BASE_URL",
    )
    siwa.signs_for(_SITE, base, timeout_ms)
    receipt = siwa.current(_SITE, timeout_ms)

    meta_req = Request("GET", f"/api/v1/techtree/account/projects/{project_id}")
    signed_meta = replace(meta_req, headers=siwa.sign(meta_req, receipt, base))
    project = send(base, signed_meta, timeout_ms)
    if not isinstance(project, dict) or not isinstance(project.get("package"), dict):
        raise CommandError(
            "invalid_response",
            "The site did not return project package metadata.",
        )

    pkg_meta = project["package"]
    expected_sha = str(pkg_meta.get("sha256") or "")
    expected_size = pkg_meta.get("size_bytes")
    if len(expected_sha) != 64:
        raise CommandError("invalid_response", "Project metadata did not include a valid sha256.")

    # Fresh SIWA signature for the binary package request.
    raw_bytes = _download_signed_bytes(
        base,
        f"/api/v1/techtree/account/projects/{project_id}/package",
        receipt,
        max(timeout_ms, 120_000),
    )

    inspection = verify_and_inspect_archive(
        raw_bytes,
        expected_sha256=expected_sha,
        expected_size=expected_size if isinstance(expected_size, int) else None,
        inspect_archive=inspect_archive,
    )

    dest = (
        out
        if out is not None
        else Path(_default_filename(str(project.get("title") or ""), project_id))
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(raw_bytes)
    tmp.replace(dest)

    payload: dict[str, Any] = {
        "project_id": project_id,
        "title": project.get("title"),
        "service": project.get("service"),
        "verdict": project.get("verdict"),
        "saved_to": str(dest),
        "sha256": inspection["sha256"],
        "sha256_verified": True,
        "size_bytes": inspection["size_bytes"],
        "file_count": inspection["file_count"],
        "schema": inspection["schema"],
    }
    if inspect_archive:
        payload["rerun_test"] = inspection.get("rerun_test") or project.get("rerun_test")

    shared = [*(["--base-url", base_url] if base_url else []), *(["--json"] if as_json else [])]
    steps: list[Step] = [
        run(
            ["regents", "techtree", "account", "project", project_id, *shared],
            "Read the full project report and manifest.",
        ),
        done(f"Verified archive written to {dest}."),
    ]
    shown = None if as_json else _render_panel(project, inspection, dest)
    output.emit(payload, as_json=as_json, next_steps=steps, shown=shown)


ACCOUNT = click.Group(
    "account",
    help="Signed account reads and verified project package downloads.",
    no_args_is_help=True,
)
ACCOUNT.add_command(
    click.Command(
        "project-package",
        callback=project_package,
        help="Download a delivered Techtree project package, verify its SHA-256 checksum before "
        "writing to disk, and inspect uplift-package/2 metadata (including Prompt Alignment).",
        params=[
            click.Argument(["project_id"], metavar="ID"),
            click.Option(
                ["--out"],
                type=click.Path(dir_okay=False, path_type=Path),
                help=(
                    "Output path for the verified .tar.gz archive. Default: ./<title>-<id8>.tar.gz."
                ),
            ),
            click.Option(
                ["--inspect/--no-inspect", "inspect_archive"],
                default=True,
                show_default=True,
                help="Inspect manifest.json and rerun/test.json inside the verified archive.",
            ),
            BASE_URL,
            click.Option(
                ["--timeout-ms"],
                type=click.IntRange(1, 300_000),
                default=DEFAULT_TIMEOUT_MS,
                show_default=True,
                help="How long to wait for metadata requests.",
            ),
            JSON,
        ],
    )
)
