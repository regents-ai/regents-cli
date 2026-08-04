from __future__ import annotations

import json
import subprocess
import sys
from copy import deepcopy

from verify_runtime import FAMILY_CONTRACT


def call(request: object) -> dict[str, object]:
    result = subprocess.run(
        [sys.executable, "-m", "verify_runtime"],
        input=json.dumps(request),
        text=True,
        capture_output=True,
        check=True,
    )
    assert result.stderr == ""
    return json.loads(result.stdout)


def test_show_is_stable_json() -> None:
    request = {
        "jsonrpc": "2.0",
        "id": "show",
        "method": "techtree.forge.family.show",
    }
    first = call(request)
    second = call(request)

    assert first == second == {"jsonrpc": "2.0", "id": "show", "result": FAMILY_CONTRACT}


def test_validate_is_stable_json() -> None:
    request = {
        "jsonrpc": "2.0",
        "id": "validate",
        "method": "techtree.forge.family.validate",
        "params": {
            "input": {
                "family": deepcopy(FAMILY_CONTRACT),
                "baseline": {"files": {"SKILL.md": "before"}},
                "candidate": {"files": {"SKILL.md": "after"}},
            }
        },
    }

    assert call(request) == call(request)


def test_rejects_unknown_methods_and_extra_envelope_fields() -> None:
    assert call({"jsonrpc": "2.0", "id": "x", "method": "verify.run"})["error"] == {
        "code": -32601,
        "message": "method not found",
    }
    assert call(
        {
            "jsonrpc": "2.0",
            "id": "x",
            "method": "techtree.forge.family.show",
            "extra": True,
        }
    )["error"] == {"code": -32600, "message": "request has additional fields"}
