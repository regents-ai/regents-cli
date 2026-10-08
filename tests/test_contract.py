"""`regents` signs every request byte for byte as the elixir-utils `siwa` library does: one
header, component or parameter out of step and the sign-in server refuses every agent on every
site at once. The library's pinned fixtures are the reference; `--phase send` reads each one
back to the same message."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from regents_cli import passkey, siwa
from regents_cli.http import Request

FIXTURES: dict[str, Any] = json.loads((siwa.CONTRACT.parent / "fixtures.json").read_text("utf-8"))


def test_the_fixtures_are_for_this_contract() -> None:
    assert FIXTURES["contract_id"] == siwa.contract_id()


@pytest.mark.parametrize("case", FIXTURES["signed"], ids=lambda case: case["name"])
def test_signs_as_the_library_does(
    case: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SIWA_AGENT_HOME", str(tmp_path))
    sent = case["request"]
    path, _, query = sent["path"].partition("?")
    body = None if sent["body"] is None else json.loads(sent["body"])
    request = Request(sent["method"], path, dict([query.split("=")]) if query else {}, body)
    assert request.target == sent["path"]
    assert request.content == (None if sent["body"] is None else sent["body"].encode("utf-8"))
    principal, signing = FIXTURES["principal"], FIXTURES["signing"]
    headers, message = siwa.unsigned(
        request,
        receipt=FIXTURES["receipt"]["token"],
        wallet_address=principal["wallet_address"],
        chain_id=principal["chain_id"],
        key_id=principal["key_id"],
        created=signing["created"],
        expires=signing["expires"],
        nonce=signing["nonce"],
    )
    assert message == case["signing_message"]
    signature = passkey.sign_message_with(FIXTURES["signer"]["private_key"], message)
    assert siwa.with_signature(headers, signature) == dict(sent["headers"])
    assert siwa.rebuild(request, headers) == (headers, message)
