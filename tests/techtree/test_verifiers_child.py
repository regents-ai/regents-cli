"""A model credential never rides on a child's command line.

The costly failure: the key from ~/.prime/config.json lands in argv, where every process listing
and every supervisor log on the machine can read it.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from regents_cli.techtree.verifiers.child import eval_argv


def test_no_credential_can_appear_in_the_invocation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    secret = "sk-child-unit-test-secret"
    monkeypatch.setenv("PRIME_API_KEY", secret)

    argv = eval_argv(eval_executable=tmp_path / "eval", input_config_path=tmp_path / "input.json")

    assert not any(secret in argument for argument in argv)
