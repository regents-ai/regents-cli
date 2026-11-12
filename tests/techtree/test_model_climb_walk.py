"""Model Climb walked as a person takes it, and its two money rules for every input.

The costly failures: a GPU job rented before its grant was issued at this machine's terminal,
or after it was revoked; a job left running after its grant was revoked or its maximum went
over the grant; an attempt closed before the provider's final receipt, or spent without a job
because an answer that may hide a job was taken as a refusal; a resumed attempt submitted
without checking the account again; a provider's charge that never reaches the attempt's
record; a test certified as passing although a step never reported; a proof Techtree keeps
twice, or one signed and sent to an address the sign-in server does not list, sent unchecked or
signed by another machine; a job given more minutes than its grant pays for at the plan's rate;
and one grant spending more paid attempts than it allows, or one attempt spending two.
"""

from __future__ import annotations

import json
import sys
import tempfile
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from regents_cli import app
from regents_cli.techtree import paths
from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.errors import PolicyError
from regents_cli.techtree.identity.service import IdentityService
from regents_cli.techtree.identity.store import IdentityStore
from regents_cli.techtree.model_climb import (
    attempts,
    grants,
    ledger,
    profile_test,
    profiles,
    proof,
    provider,
)
from regents_cli.techtree.model_climb.contracts import (
    AttemptOperational,
    Created,
    ModelArtifact,
    ModelArtifactSpec,
    ModelUpliftReport,
    ResolvedModelPlan,
    StoredOperational,
    TrainingAttempt,
    TrainingAttemptSpec,
    seal,
)
from regents_cli.techtree.model_climb.store import ModelClimbStore
from regents_cli.techtree.models.base import JsonValue
from tests.signed_agent import ADDRESS, signer_of
from tests.techtree.run_log import Terminal
from tests.techtree.test_model_climb import LAYER_TYPES, digest, report_for, stored_plan

M0 = profiles.M0
#: The stand-in's price: 50,000 millionths of a dollar a GPU-minute, $3 a GPU-hour.
RATE = 50_000
#: What the stand-in's receipt says the job was charged.
CHARGED = 1_234_567
TOKEN = "test-only-token"


# A stand-in for the GPU provider and one for Techtree, each on this machine.


#: What a provider's error answer carries beside its code, which no answer of the CLI repeats.
PROVIDER_SAYS = "provider-reply-text-never-printed"


def queued(**fields: Any) -> dict[str, Any]:
    return {"status": "queued", **fields}


def receipt(charged: int = CHARGED) -> dict[str, Any]:
    return {
        "image_digest": "sha256:" + "f" * 64,
        "charged_usd_micros": charged,
        "billed_seconds": 600,
    }


def ended(status: str = "succeeded", **fields: Any) -> dict[str, Any]:
    return {"status": status, "result": job_result(), "receipt": receipt(), **fields}


@dataclass
class Provider:
    """Autoresearch's batch API as the engine uses it, with one job. Each look at the job gets
    the next of `looks`, and the last one again once they run out: by default it is queued at
    its first look and has ended, with its receipt, at the next."""

    looks: list[dict[str, Any]] = field(default_factory=lambda: [queued(), ended()])
    #: Error answers by (method, path), as the provider's status code.
    errors: dict[tuple[str, str], int] = field(default_factory=dict)
    #: Whether a submission answered with an error still created its job.
    created_anyway: bool = False
    auto_topup: bool = False
    submissions: list[dict[str, Any]] = field(default_factory=list)
    cancels: list[str] = field(default_factory=list)
    seen: int = 0
    ceiling: int = 0

    def answer(self, method: str, path: str, query: dict[str, str], body: Any) -> tuple[int, Any]:
        status = self.errors.get((method, path), 200)
        if path == "/preview/jobs" and method == "POST" and (status == 200 or self.created_anyway):
            self.submissions.append(body)
        if status != 200:
            return status, {"error": {"code": "refused", "message": PROVIDER_SAYS}}
        return 200, self._answer(method, path, query, body)

    def _answer(self, method: str, path: str, query: dict[str, str], body: Any) -> object:
        if path == "/preview/jobs/validate":
            cost = RATE * body["max_duration_minutes"] * body["chip_count"]
            self.ceiling = cost
            return {
                "max_cost_usd_micros": cost,
                "max_duration_minutes": body["max_duration_minutes"],
                "would_submit": True,
            }
        if path.startswith("/preview/missions/"):
            return {"name": path.rsplit("/", 1)[1]}
        if path == "/preview/usage":
            return {"builds": {"minutes": 0}}
        if path == "/preview/billing":
            return {
                "balance": {"at_zero": False, "available_usd_micros": 100_000_000},
                "auto_topup": {"enabled": self.auto_topup},
            }
        if path == "/preview/jobs" and method == "POST":
            return {"id": "job-1", "status": "queued"}
        if path == "/preview/jobs":
            labels = [job["label"] for job in self.submissions]
            return {
                "items": [{"id": "job-1", "status": "queued"}] if query["label"] in labels else []
            }
        if path.endswith("/cancel"):
            self.cancels.append(path)
            return {"id": "job-1", "status": "canceling"}
        look = self.looks[min(self.seen, len(self.looks) - 1)]
        self.seen += 1
        return {"id": "job-1", "max_cost_usd_micros": self.ceiling, **look}


@dataclass
class Techtree:
    """Techtree's private reports: it keeps a proof once under its idempotency key, and only
    when the paired agent's key signed exactly what arrived. It also stands in for the sign-in
    server, which lists this one address for Techtree."""

    base: str = ""
    kept: dict[str, bytes] = field(default_factory=dict)
    signers: list[str] = field(default_factory=list)
    #: What it answers in place of the kept report, when set.
    reply: dict[str, Any] | None = None

    def answer(self, target: str, body: bytes, headers: dict[str, str]) -> object:
        if target == "/api/shared/siwa/audiences":
            listed = [{"audience": "techtree", "origin": self.base}]
            return {"code": "audiences", "data": {"audiences": listed}}
        # x-regent-client names the command for the site's counts; no signature covers it.
        signed = {name: value for name, value in headers.items() if name != "x-regent-client"}
        self.signers.append(signer_of("POST", target, body, signed, self.base))
        self.kept.setdefault(headers["idempotency-key"], body)
        report = json.loads(body)["manifest"]["payload"]["report"]
        if self.reply is not None:
            return self.reply
        return {
            "report": {
                "report_digest": report,
                "signer_key_id": "stand-in",
                "results": {"outcome": "tie", "comparison": "valid", "release_gate": "none"},
            }
        }


@pytest.fixture
def stand_ins(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[Provider, Techtree]]:
    gpu, site = Provider(), Techtree()

    class Handler(BaseHTTPRequestHandler):
        def _handle(self) -> None:
            parts = urlsplit(self.path)
            raw = self.rfile.read(int(self.headers.get("content-length") or 0))
            if parts.path.startswith("/preview/"):
                if self.headers.get("authorization") != f"Bearer {TOKEN}":
                    return self._send(401, {"error": "unauthorized"})
                query = {name: values[0] for name, values in parse_qs(parts.query).items()}
                body = json.loads(raw) if raw else None
                return self._send(*gpu.answer(self.command, parts.path, query, body))
            headers = {name.lower(): value for name, value in self.headers.items()}
            return self._send(200, site.answer(self.path, raw, headers))

        def do_GET(self) -> None:
            self._handle()

        def do_POST(self) -> None:
            self._handle()

        def _send(self, status: int, body: object) -> None:
            content = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, *_: object) -> None:
            return None

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    site.base = base
    monkeypatch.setattr(provider, "BASE_URL", base)
    monkeypatch.setenv("SIWA_BROKER", base)
    monkeypatch.setenv(provider.TOKEN_ENV, TOKEN)
    try:
        yield gpu, site
    finally:
        server.shutdown()
        server.server_close()


# The container's answer and the job's result, as the image writes them when nothing is wrong.


def quiet() -> dict[str, JsonValue]:
    return {
        "dashboard": False,
        "heartbeat": None,
        "control": None,
        "monitors": {"prime": None, "wandb": None},
        "model": {"fusions": {"enabled": []}},
    }


def container_check(profile: profiles.Profile) -> profiles.Ran:
    answer = profiles.CheckAnswer.model_validate(
        {
            "model": profile.model.model_dump(mode="json"),
            "environment": {
                "prime_rl_revision": profile.trainer_revision,
                "python": "3.12",
                "machine": "x86_64",
                "torch": "2.9",
                "transformers": "5.0",
            },
            "dry_run": {
                "succeeded": True,
                "exit_code": 0,
                "input": "{}",
                "log_tail": [],
                "resolved": quiet(),
            },
            "fixtures": [
                {
                    "id": "invoice-fields",
                    "renderer": profile.renderer,
                    "tokens": 100,
                    "trained_tokens": 20,
                    "every_answer_trained": True,
                    "no_prompt_trained": True,
                    "residue": "",
                    "trained_spans": ["{}"],
                }
            ],
            "modules": {
                "model_class": "Qwen3_5ForConditionalGeneration",
                "attn": "sdpa",
                "language_layers": [profile.language_layers],
                "layer_types": LAYER_TYPES,
                "matched": profile.module_names(LAYER_TYPES),
            },
        }
    )
    return profiles.Ran(answer=answer, image_id="sha256:" + "e" * 64, log="")


def job_result() -> dict[str, JsonValue]:
    return {
        "profile": M0.name,
        "completed": True,
        "gpu_peak_memory_mib": {"0": 1, "1": 1},
        "environment": {
            "gpus": [
                {"index": str(n), "name": "H100", "memory_total_mib": 81559, "driver": "570"}
                for n in range(M0.gpu_count)
            ],
            "cuda": "12.8",
            "kernel": "6.8",
            "machine": "x86_64",
            "python": "3.12",
            "prime_rl_revision": M0.trainer_revision,
            "packages": {},
            "package_tools": {**profile_test.PACKAGE_TOOLS},
            "usage_reports": {**profile_test.USAGE_REPORTS},
        },
        "download": {
            "seconds": 1,
            "files_checked": len(M0.weight_files) + len(M0.tokenizer_files),
        },
        "train": {"seconds": 1, "resolved": quiet()},
        "adapter": {
            "step": M0.settings.max_steps,
            "sha256": "a" * 64,
            "config": {},
            "modules": [*M0.module_names(LAYER_TYPES)],
            "zero_lora_b": [],
        },
        "verifiers": {
            "taskset": M0.settings.taskset,
            "pushed": False,
            "episodes": 1,
            "rewards": [1.0],
        },
        "answers": [
            {
                "id": profile_test.DECIDING_FIXTURE,
                "structured_output": True,
                "base_text": "{}",
                "base_again_text": "{}",
                "adapter_text": '{"total": 1}',
                "noise": None,
                "signal": None,
            }
        ],
    }


# The walk.


def sign_in_to_techtree(folder: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """An agent home with a fixed test key, signed in to Techtree."""
    home = folder / "agent"
    (home / "receipts").mkdir(parents=True, mode=0o700)
    home.chmod(0o700)
    files = {
        "key.json": {"address": ADDRESS, "private_key": "0x" + "00" * 31 + "01"},
        "receipts/techtree.json": {
            "address": ADDRESS,
            "audience": "techtree",
            "receipt": "test-receipt",
            "receipt_expires_at": "2999-01-01T00:00:00Z",
            "key_id": ADDRESS,
        },
    }
    for name, content in files.items():
        (home / name).write_text(json.dumps(content), "utf-8")
        (home / name).chmod(0o600)
    monkeypatch.setenv("SIWA_AGENT_HOME", str(home))


def regents(capsys: pytest.CaptureFixture[str], *words: str) -> tuple[int, dict[str, Any]]:
    code = app.main(["techtree", "model-climb", *words, "--json"])
    return code, json.loads(capsys.readouterr().out)


def issue_at_a_terminal(monkeypatch: pytest.MonkeyPatch, words: list[str], typed: str) -> int:
    """A person at this machine's terminal answers the grant's questions."""
    screen = sys.stdout
    monkeypatch.setattr(sys, "stdin", Terminal(typed))
    monkeypatch.setattr(sys, "stdout", Terminal())
    try:
        return app.main(["techtree", "model-climb", "grant", "issue", *words])
    finally:
        monkeypatch.setattr(sys, "stdout", screen)


def a_report(store: ModelClimbStore, plan: ResolvedModelPlan, intent_id: str) -> str:
    """The uplift report a later Model Climb step writes from the attempt, sealed into the store."""
    now = datetime.now(UTC)
    attempt = seal(
        TrainingAttempt,
        TrainingAttemptSpec(
            plan=plan.digest,
            run_id="run-1",
            attempt_id=intent_id,
            observed_config_digest=digest_object(quiet()),
            steps=M0.settings.max_steps,
            tokens=100,
            checkpoints=[],
            exit_reason="succeeded",
            measured_cost_cents=provider.cents(CHARGED),
            predecessor=None,
            optimizer_state_restored=False,
            rng_state_restored=False,
        ),
        AttemptOperational(
            intent_id=intent_id,
            upstream_job_id="job-1",
            event_cursor=None,
            started_at=now,
            ended_at=now,
        ),
    )
    artifact = seal(
        ModelArtifact,
        ModelArtifactSpec(
            base_weights_root=digest("1"),
            adapter_root=digest("2"),
            adapter_config_digest=digest("3"),
            tokenizer_digest=digest("4"),
            config_digest=digest("5"),
            merged_weights_root=None,
            plan=plan.digest,
            attempt=attempt.digest,
            licence="apache-2.0",
            privacy_class="private",
        ),
        StoredOperational(storage_handle="local", created_at=now),
    )
    report = seal(
        ModelUpliftReport,
        report_for(artifact.digest, plan.spec.benchmark_release),
        Created(created_at=now),
    )
    for value in (attempt, artifact, report):
        store.put(value)
    return report.digest


def test_a_person_walks_model_climb_and_nothing_is_rented_without_their_grant(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    stand_ins: tuple[Provider, Techtree],
) -> None:
    gpu, site = stand_ins
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    sign_in_to_techtree(tmp_path, monkeypatch)
    monkeypatch.setattr(profiles, "run_check", container_check)
    store = ModelClimbStore(paths.home().model_climb_dir)

    code, checked = regents(capsys, "profile", "check", M0.name, "--dry-run")
    assert code == 0 and checked["next_steps"]

    code, planned = regents(capsys, "plan", "--profile", M0.name, "--max-usd", "10")
    assert code == 0 and planned["next_steps"]
    plan_digest = planned["plan"]

    # The paid step without a grant, and with a grant id nobody issued: nothing is rented.
    for refused in ([], ["--grant", "grant_" + "0" * 32]):
        code, answer = regents(capsys, "profile", "test", M0.name, *refused)
        assert code != 0 and answer["error"]["code"] == "approval_required"
        assert answer["next_steps"]
    assert gpu.submissions == []

    hours = str(Decimal(planned["max_duration_minutes"]) / 60)
    limits = ["--plan", plan_digest, "--operation", grants.PROFILE_TEST, "--max-usd", "10"]
    limits += ["--max-hours", hours, "--max-attempts", "1", "--expires-in", "12h"]
    # A person who will not answer for the account's spending limit issues nothing.
    assert issue_at_a_terminal(monkeypatch, limits, "n\n") != 0
    assert not store.grants_dir.exists() or not any(store.grants_dir.iterdir())
    assert issue_at_a_terminal(monkeypatch, limits, "y\ny\n10\n") == 0
    [grant_file] = store.grants_dir.glob("*.json")
    grant_id = grant_file.stem
    assert gpu.submissions == []

    code, waiting = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code == 0 and waiting["state"] == "running" and waiting["next_steps"]
    assert len(gpu.submissions) == 1
    assert gpu.submissions[0]["max_duration_minutes"] * RATE * M0.gpu_count <= 10 * 10_000 * 100

    code, measured = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code == 0 and measured["state"] == "measured" and measured["next_steps"]
    assert len(gpu.submissions) == 1 and gpu.cancels == []
    intent_id = measured["measured_profile"]["intent_id"]
    outcome = json.loads((store.attempts_dir / intent_id / "outcome.json").read_text())
    assert outcome["charged_usd_micros"] == CHARGED
    assert measured["measured_profile"]["measured_cost_cents"] == provider.cents(CHARGED)

    identity = IdentityService(IdentityStore(paths.home())).ensure()
    envelope = store.get_grant(grant_id)
    events = [
        (line.event, line.intent_id) for line in ledger.lines(store.ledger_path, identity, envelope)
    ]
    assert events == [("issued", None), ("used", intent_id)]

    plan = grants.stored_plan(store, plan_digest)
    folder = tmp_path / "proof"
    proof.write(
        store,
        IdentityService(IdentityStore(paths.home())),
        a_report(store, plan, intent_id),
        folder,
    )
    code = app.main(["techtree", "proof", "verify", str(folder), "--json"])
    verified = json.loads(capsys.readouterr().out)
    assert code == 0 and verified["next_steps"]
    for _ in range(2):
        code, sent = regents(capsys, "submit", str(folder), "--base-url", site.base)
        assert code == 0 and sent["next_steps"], sent
    assert len(site.kept) == 1
    assert site.signers == [ADDRESS, ADDRESS]

    # The spent grant pays for no second job, and a new grant revoked before it is used pays
    # for none at all.
    code, answer = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code != 0 and answer["error"]["code"] == "approval_required"
    assert issue_at_a_terminal(monkeypatch, limits, "y\ny\n10\n") == 0
    [second] = {path.stem for path in store.grants_dir.glob("*.json")} - {grant_id}
    code, revoked = regents(capsys, "grant", "revoke", second)
    assert code == 0 and revoked["next_steps"]
    code, answer = regents(capsys, "profile", "test", M0.name, "--grant", second)
    assert code != 0 and answer["error"]["code"] == "approval_required"
    assert len(gpu.submissions) == 1


# The job's ends, walked from a grant.


def granted(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> tuple[ModelClimbStore, str]:
    """A profile checked, its plan written for $10 and a grant issued at the terminal."""
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setattr(profiles, "run_check", container_check)
    store = ModelClimbStore(paths.home().model_climb_dir)
    assert regents(capsys, "profile", "check", M0.name, "--dry-run")[0] == 0
    code, planned = regents(capsys, "plan", "--profile", M0.name, "--max-usd", "10")
    assert code == 0
    hours = str(Decimal(planned["max_duration_minutes"]) / 60)
    limits = ["--plan", planned["plan"], "--operation", grants.PROFILE_TEST, "--max-usd", "10"]
    limits += ["--max-hours", hours, "--max-attempts", "1", "--expires-in", "12h"]
    assert issue_at_a_terminal(monkeypatch, limits, "y\ny\n10\n") == 0
    [grant_file] = store.grants_dir.glob("*.json")
    return store, grant_file.stem


def outcome(store: ModelClimbStore) -> dict[str, Any] | None:
    """The one attempt's outcome, or None while it is open."""
    [folder] = store.attempts_dir.iterdir()
    path = folder / "outcome.json"
    return json.loads(path.read_text()) if path.exists() else None


def test_a_receipt_on_a_job_that_has_not_ended_never_closes_its_attempt(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    stand_ins: tuple[Provider, Techtree],
) -> None:
    gpu, _ = stand_ins
    store, grant_id = granted(monkeypatch, tmp_path, capsys)
    # Running with the charge so far, then ended before its receipt is ready, then receipted.
    gpu.looks = [
        {"status": "running", "receipt": receipt(charged=1)},
        ended(receipt=None),
        ended(),
    ]
    for _ in range(2):
        code, answer = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
        assert code == 0 and answer["state"] == "running"
        assert outcome(store) is None
    code, answer = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code == 0 and answer["state"] == "measured"
    closed = outcome(store)
    assert closed is not None and closed["charged_usd_micros"] == CHARGED
    assert len(gpu.submissions) == 1 and gpu.cancels == []


@pytest.mark.parametrize("status", [408, 409, 500])
def test_a_submission_whose_answer_may_hide_a_job_is_looked_up_and_never_sent_again(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    stand_ins: tuple[Provider, Techtree],
    status: int,
) -> None:
    gpu, _ = stand_ins
    store, grant_id = granted(monkeypatch, tmp_path, capsys)
    gpu.errors[("POST", "/preview/jobs")] = status
    gpu.created_anyway = True
    code, answer = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code == 0 and answer["state"] == "running" and answer["job_id"] == "job-1"
    assert outcome(store) is None
    code, answer = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code == 0 and answer["state"] == "measured"
    assert len(gpu.submissions) == 1


def test_a_refused_submission_spends_the_use_and_prints_none_of_the_reply(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    stand_ins: tuple[Provider, Techtree],
) -> None:
    gpu, _ = stand_ins
    store, grant_id = granted(monkeypatch, tmp_path, capsys)
    gpu.errors[("POST", "/preview/jobs")] = 422
    code, answer = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code != 0 and answer["next_steps"]
    assert answer["error"]["details"]["provider_code"] == "refused"
    assert PROVIDER_SAYS not in json.dumps(answer)
    closed = outcome(store)
    assert closed is not None and closed["exit_reason"] == "failed"
    code, answer = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code != 0 and answer["error"]["code"] == "approval_required"
    assert gpu.submissions == []


def test_a_provider_refusal_never_prints_its_reply(
    stand_ins: tuple[Provider, Techtree],
) -> None:
    gpu, _ = stand_ins
    gpu.errors[("GET", "/preview/billing")] = 403
    with pytest.raises(provider.ProviderError) as refused:
        provider.Autoresearch(TOKEN).billing()
    assert refused.value.details["provider_code"] == "refused"
    assert PROVIDER_SAYS not in refused.value.message + json.dumps(refused.value.details)


def test_an_attempt_resumed_before_its_submission_checks_the_account_again(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    stand_ins: tuple[Provider, Techtree],
) -> None:
    gpu, _ = stand_ins
    store, grant_id = granted(monkeypatch, tmp_path, capsys)
    submit_once = attempts.submit_once
    stops = [KeyboardInterrupt()]

    def stopped_once(*args: Any) -> str:
        if stops:
            raise stops.pop()
        return submit_once(*args)

    # Stopped after the use is on the ledger and before the submission is written down.
    monkeypatch.setattr(profile_test, "submit_once", stopped_once)
    code, _ = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code != 0 and gpu.submissions == []
    gpu.auto_topup = True
    code, answer = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code != 0 and answer["error"]["code"] == "approval_required"
    assert gpu.submissions == []
    gpu.auto_topup = False
    code, answer = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code == 0 and answer["state"] == "running" and len(gpu.submissions) == 1
    assert outcome(store) is None


def test_a_job_whose_maximum_is_over_the_grant_is_cancelled_and_closed_on_its_receipt(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    stand_ins: tuple[Provider, Techtree],
) -> None:
    gpu, _ = stand_ins
    store, grant_id = granted(monkeypatch, tmp_path, capsys)
    over = 10 * 10_000 * 100 + 1
    # After the cancel: still canceling with the charge so far, then canceled with no receipt
    # yet, then the receipt.
    gpu.looks = [
        queued(max_cost_usd_micros=over),
        {"status": "canceling", "max_cost_usd_micros": over, "receipt": receipt(charged=1)},
        {"status": "canceled", "max_cost_usd_micros": over},
        ended("canceled", max_cost_usd_micros=over, result=None),
    ]
    for _ in range(2):
        code, answer = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
        assert code != 0 and answer["error"]["code"] == "budget_exhausted"
        assert outcome(store) is None
    code, answer = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code != 0 and answer["error"]["code"] == "budget_exhausted" and answer["next_steps"]
    closed = outcome(store)
    assert closed is not None and closed["exit_reason"] == "budget_exhausted"
    assert closed["charged_usd_micros"] == CHARGED
    assert len(gpu.submissions) == 1 and len(gpu.cancels) == 1


def test_a_grant_revoked_while_its_job_runs_cancels_the_job_at_the_next_look(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    stand_ins: tuple[Provider, Techtree],
) -> None:
    gpu, _ = stand_ins
    store, grant_id = granted(monkeypatch, tmp_path, capsys)
    gpu.looks = [queued(), queued(), ended("canceled", result=None)]
    code, answer = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code == 0 and answer["state"] == "running"
    code, revoked = regents(capsys, "grant", "revoke", grant_id)
    assert code == 0 and revoked["job_may_be_running"] is True
    code, answer = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code != 0 and answer["error"]["code"] == "approval_required"
    closed = outcome(store)
    assert closed is not None and closed["exit_reason"] == "cancelled"
    assert closed["charged_usd_micros"] == CHARGED
    assert len(gpu.submissions) == 1 and len(gpu.cancels) == 1


# Steps a check or a job never reported.


def test_a_model_free_check_that_reports_no_fixture_or_modules_never_passes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    def skipped(profile: profiles.Profile) -> profiles.Ran:
        ran = container_check(profile)
        answer = ran.answer.model_copy(update={"fixtures": None, "modules": None})
        return profiles.Ran(answer=answer, image_id=ran.image_id, log="")

    monkeypatch.setattr(profiles, "run_check", skipped)
    code, answer = regents(capsys, "profile", "check", M0.name, "--dry-run")
    assert code != 0 and answer["error"]["code"] == "verification_error"
    code, answer = regents(capsys, "plan", "--profile", M0.name, "--max-usd", "10")
    assert code != 0 and answer["next_steps"]


def test_a_paid_test_whose_job_reports_only_that_it_completed_never_passes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    stand_ins: tuple[Provider, Techtree],
) -> None:
    gpu, _ = stand_ins
    _, grant_id = granted(monkeypatch, tmp_path, capsys)
    bare = {"profile": M0.name, "completed": True, "gpu_peak_memory_mib": {}}
    gpu.looks = [queued(), ended(result=bare)]
    code, _ = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code == 0
    code, answer = regents(capsys, "profile", "test", M0.name, "--grant", grant_id)
    assert code != 0 and answer["error"]["code"] == "verification_error"
    assert len(gpu.submissions) == 1


# Sending a proof.


def a_proof(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    signed_elsewhere: bool = False,
) -> Path:
    """A proof of a report on a plan this machine wrote, signed with this machine's key, or
    with another machine's."""
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    sign_in_to_techtree(tmp_path, monkeypatch)
    monkeypatch.setattr(profiles, "run_check", container_check)
    store = ModelClimbStore(paths.home().model_climb_dir)
    assert regents(capsys, "profile", "check", M0.name, "--dry-run")[0] == 0
    code, planned = regents(capsys, "plan", "--profile", M0.name, "--max-usd", "10")
    assert code == 0
    report = a_report(store, grants.stored_plan(store, planned["plan"]), "attempt-1")
    if signed_elsewhere:
        monkeypatch.setenv("HOME", str(tmp_path / "elsewhere"))
    folder = tmp_path / "proof"
    proof.write(store, IdentityService(IdentityStore(paths.home())), report, folder)
    monkeypatch.setenv("HOME", str(home))
    return folder


def test_a_proof_is_signed_and_sent_only_to_an_address_the_sign_in_server_lists(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    stand_ins: tuple[Provider, Techtree],
) -> None:
    _, site = stand_ins
    folder = a_proof(monkeypatch, tmp_path, capsys)
    elsewhere = site.base.rsplit(":", 1)[0] + ":9"
    code, answer = regents(capsys, "submit", str(folder), "--base-url", elsewhere)
    assert code != 0 and answer["error"]["code"] == "address_not_listed"
    monkeypatch.setenv("TECHTREE_BASE_URL", elsewhere)
    code, answer = regents(capsys, "submit", str(folder))
    assert code != 0 and answer["error"]["code"] == "address_not_listed"
    assert site.kept == {} and site.signers == []


@pytest.mark.parametrize("broken", ["object_missing", "signed_elsewhere"])
def test_a_proof_that_fails_its_check_or_another_machine_signed_is_never_sent(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    stand_ins: tuple[Provider, Techtree],
    broken: str,
) -> None:
    _, site = stand_ins
    folder = a_proof(monkeypatch, tmp_path, capsys, signed_elsewhere=broken == "signed_elsewhere")
    if broken == "object_missing":
        next((folder / "objects").iterdir()).unlink()
    code, answer = regents(capsys, "submit", str(folder), "--base-url", site.base)
    assert code != 0 and answer["next_steps"]
    assert site.kept == {} and site.signers == []


def test_a_techtree_answer_without_its_report_is_a_clean_refusal(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    stand_ins: tuple[Provider, Techtree],
) -> None:
    _, site = stand_ins
    folder = a_proof(monkeypatch, tmp_path, capsys)
    for reply in ({"ok": True}, {"report": {"report_digest": "x", "signer_key_id": "y"}}):
        site.reply = reply
        code, answer = regents(capsys, "submit", str(folder), "--base-url", site.base)
        assert code != 0 and answer["error"]["code"] == "invalid_response"
        assert answer["next_steps"]


# The money rules, for every input.


@given(
    max_cents=st.integers(min_value=1, max_value=grants.PROFILE_TEST_MAX_CENTS * 10),
    cents_per_gpu_hour=st.integers(min_value=1, max_value=100_000),
    gpu_count=st.integers(min_value=1, max_value=16),
    wall_seconds=st.one_of(st.none(), st.integers(min_value=0, max_value=7 * 86_400)),
)
def test_a_job_is_never_given_more_minutes_than_its_grant_pays_for(
    max_cents: int, cents_per_gpu_hour: int, gpu_count: int, wall_seconds: int | None
) -> None:
    minutes = profile_test.job_minutes(max_cents, cents_per_gpu_hour, gpu_count, wall_seconds)
    assert minutes >= 0 and minutes % profile_test.MINUTE_STEP == 0
    assert minutes * cents_per_gpu_hour * gpu_count <= max_cents * 60
    if wall_seconds is not None:
        assert minutes * 60 <= wall_seconds
    # Nor fewer than it pays for: three more minutes would break one of the two limits.
    longer = minutes + profile_test.MINUTE_STEP
    assert longer * cents_per_gpu_hour * gpu_count > max_cents * 60 or (
        wall_seconds is not None and longer * 60 > wall_seconds
    )


@settings(suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=None)
@given(
    max_attempts=st.integers(min_value=1, max_value=3),
    attempts=st.lists(
        st.sampled_from(["intent-a", "intent-b", "intent-c", "intent-d"]), max_size=8
    ),
)
def test_a_grant_never_spends_more_attempts_than_it_allows(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, max_attempts: int, attempts: list[str]
) -> None:
    store, plan_digest = stored_plan(monkeypatch, tmp_path)
    service = IdentityService(IdentityStore(paths.home()))
    identity = service.ensure()
    now = datetime.now(UTC)
    grant = grants.draft_grant(
        store,
        identity=identity,
        plan_digest=plan_digest,
        operation="model_climb_start",
        limits=grants.Limits(
            max_cents=1000,
            max_wall_time_seconds=3600,
            max_attempts=max_attempts,
            expires_in=profile_test.PLAN_LIFETIME,
        ),
        now=now,
    )
    envelope = service.sign_object(grant)
    with tempfile.TemporaryDirectory(dir=tmp_path) as fresh:
        ledgered = ModelClimbStore(Path(fresh))
        ledger.record(ledgered.ledger_path, service, envelope, "issued", at=now)
        spent: list[str] = []
        for intent_id in attempts:
            try:
                grants.use(ledgered, service, envelope, intent_id=intent_id, now=now)
            except PolicyError as refused:
                assert refused.code == grants.APPROVAL_REQUIRED
                assert len(set(spent)) == max_attempts and intent_id not in spent
                continue
            spent.append(intent_id)
        used = [
            line.intent_id
            for line in ledger.lines(ledgered.ledger_path, identity, envelope)
            if line.event == "used"
        ]
    assert len(used) == len(set(used)) <= max_attempts
    assert set(used) == set(spent)
