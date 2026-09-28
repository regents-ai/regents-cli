"""Publishing sends nothing without a person's yes, and sends exactly the proof when it does.

The costly failures: a proof leaves the machine that nobody agreed to send, an address travels
that nobody typed, or an agent hangs on a prompt it cannot see instead of being told the flag.
"""

from __future__ import annotations

import json
import shlex
from base64 import b64decode
from pathlib import Path

import pytest

from regents_cli.app import main
from regents_cli.techtree.publication.models import PublicationSubmission
from tests.techtree.run_log import (
    BUNDLE_DIGEST,
    PINNED_ENDPOINT,
    RUN_ID,
    SKILL_NAME,
    RunLog,
    accept_publication,
    at_a_terminal,
    install,
    install_run,
)

PUBLISH = ["techtree", "publish", RUN_ID]
APPROVED = [*PUBLISH, "--yes", "--reviewed-on", "host-agent", "--json"]


@pytest.fixture
def log(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> RunLog:
    log = RunLog(accept_publication)
    install(monkeypatch, tmp_path / "home", log)
    return log


@pytest.fixture
def run_dir(tmp_path: Path) -> Path:
    return install_run(tmp_path / "home")


def test_saying_no_at_the_prompt_sends_nothing(
    monkeypatch: pytest.MonkeyPatch, log: RunLog, run_dir: Path
) -> None:
    _, stdout = at_a_terminal(monkeypatch, "n\n")

    assert main(PUBLISH) == 1

    assert "Publish this run to the public log?" in stdout.getvalue()
    assert log.requests == []
    assert not (run_dir / "publication.jsonl").exists()
    assert not (run_dir / "publication-receipt.json").exists()


def test_a_machine_that_cannot_be_asked_is_told_which_flag_to_pass(
    log: RunLog, run_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main([*PUBLISH, "--json"]) == 1

    error = json.loads(capsys.readouterr().out)["error"]
    assert error["code"] == "approval_required"
    assert shlex.split(error["approval"]["command"]) == [
        "regents",
        "techtree",
        "publish",
        RUN_ID,
        "--yes",
        "--reviewed-on",
        "host-agent",
    ]
    assert f"Publishing run {RUN_ID}" in error["review"]
    assert any(line.startswith("  bundle.json (") for line in error["review"])
    assert log.requests == []


def test_a_proof_that_does_not_verify_is_refused_before_anything_is_asked(
    monkeypatch: pytest.MonkeyPatch,
    log: RunLog,
    run_dir: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    receipt = run_dir / "proof" / "receipts" / "candidate" / "0001.json"
    raw = bytearray(receipt.read_bytes())
    position = raw.index(b'"task_hash":"sha256:') + len(b'"task_hash":"sha256:')
    raw[position] = ord("0") if raw[position] != ord("0") else ord("1")
    receipt.write_bytes(bytes(raw))
    stdin, stdout = at_a_terminal(monkeypatch, "y\ny\n")

    assert main(PUBLISH) == 1

    assert "proof_bundle_invalid" in capsys.readouterr().err
    assert stdin.tell() == 0, "a yes was waiting and nothing read it"
    assert "Publish this run" not in stdout.getvalue()
    assert log.requests == []


def test_a_machine_publishing_without_the_option_sends_no_address(
    log: RunLog, run_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(APPROVED) == 0

    [request] = log.requests
    assert request.method == "POST"
    assert str(request.url) == PINNED_ENDPOINT
    assert "x-techtree-contributor-address" not in request.headers
    assert request.headers["x-techtree-skill-name"] == SKILL_NAME
    assert "x-techtree-skill-github-url" not in request.headers
    submission = PublicationSubmission.model_validate_json(request.content)
    assert submission.run_id == RUN_ID
    assert submission.bundle_digest == BUNDLE_DIGEST
    proof = run_dir / "proof"
    stored = {
        path.relative_to(proof).as_posix(): path.read_bytes()
        for path in proof.rglob("*")
        if path.is_file()
    }
    assert {name: b64decode(data) for name, data in submission.files.items()} == stored

    answer = json.loads(capsys.readouterr().out)
    assert answer["contributor_address_sent"] is False
    assert answer["publication"] == "published"
    assert answer["skill_name"] == SKILL_NAME
    assert answer["retry"] == "reconcile_first"
    assert (run_dir / "publication-receipt.json").is_file()


@pytest.mark.parametrize("misspelt", [["--yes", "false"], ["--yes=no"], ["--yes", "0"]])
def test_a_yes_with_a_value_is_a_usage_error_and_sends_nothing(
    log: RunLog, run_dir: Path, misspelt: list[str]
) -> None:
    """`--yes false` must never read as yes: it is refused, and nothing leaves the machine."""
    assert main([*PUBLISH, *misspelt, "--json"]) == 2
    assert log.requests == []
    assert not (run_dir / "publication.jsonl").exists()
