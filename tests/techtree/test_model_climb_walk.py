"""Model Climb walked as a person takes it, and its two money rules for every input.

The costly failures: a GPU job rented before a person issued its grant, or after they revoked
it; a provider's charge that never reaches the attempt's record; a proof Techtree keeps twice;
a job given more minutes than its grant pays for at the plan's rate; and one grant spending
more paid attempts than it allows, or one attempt spending two.
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
from regents_cli.techtree.model_climb import grants, ledger, profile_test, profiles, proof, provider
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


@dataclass
class Provider:
    """Autoresearch's batch API as the engine uses it: one job, which is queued at its first
    look and has ended, with its receipt, at the next."""

    submissions: list[dict[str, Any]] = field(default_factory=list)
    cancels: list[str] = field(default_factory=list)
    looks: int = 0
    ceiling: int = 0

    def answer(self, method: str, path: str, query: dict[str, str], body: Any) -> object:
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
                "auto_topup": {"enabled": False},
            }
        if path == "/preview/jobs" and method == "POST":
            self.submissions.append(body)
            return {"id": "job-1", "status": "queued"}
        if path == "/preview/jobs":
            labels = [job["label"] for job in self.submissions]
            return {
                "items": [{"id": "job-1", "status": "queued"}] if query["label"] in labels else []
            }
        if path.endswith("/cancel"):
            self.cancels.append(path)
            return {}
        self.looks += 1
        if self.looks == 1:
            return {"id": "job-1", "status": "queued", "max_cost_usd_micros": self.ceiling}
        return {
            "id": "job-1",
            "status": "succeeded",
            "max_cost_usd_micros": self.ceiling,
            "result": job_result(),
            "receipt": {
                "image_digest": "sha256:" + "f" * 64,
                "charged_usd_micros": CHARGED,
                "billed_seconds": 600,
            },
        }


@dataclass
class Techtree:
    """Techtree's private reports: it keeps a proof once under its idempotency key, and only
    when the paired agent's key signed exactly what arrived."""

    base: str = ""
    kept: dict[str, bytes] = field(default_factory=dict)
    signers: list[str] = field(default_factory=list)

    def answer(self, target: str, body: bytes, headers: dict[str, str]) -> object:
        # x-regent-client names the command for the site's counts; no signature covers it.
        signed = {name: value for name, value in headers.items() if name != "x-regent-client"}
        self.signers.append(signer_of("POST", target, body, signed, self.base))
        self.kept.setdefault(headers["idempotency-key"], body)
        report = json.loads(body)["manifest"]["payload"]["report"]
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
                return self._send(200, gpu.answer(self.command, parts.path, query, body))
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
