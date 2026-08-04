"""One-request JSON-RPC entrypoint for the local Verify runtime."""

from __future__ import annotations

import json
import sys
from typing import Any

from .forge_family import FAMILY_CONTRACT, ValidationError, validate_family


METHOD_SHOW = "techtree.forge.family.show"
METHOD_VALIDATE = "techtree.forge.family.validate"


def _error(request_id: str | None, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }


def _dispatch(request: Any) -> dict[str, Any]:
    if type(request) is not dict:
        return _error(None, -32600, "request must be an object")

    request_id = request.get("id") if type(request.get("id")) is str else None
    if set(request) - {"jsonrpc", "id", "method", "params"}:
        return _error(request_id, -32600, "request has additional fields")
    if request.get("jsonrpc") != "2.0" or request_id is None or type(request.get("method")) is not str:
        return _error(request_id, -32600, "invalid JSON-RPC request")

    method = request["method"]
    params = request.get("params")
    try:
        if method == METHOD_SHOW:
            if params is not None:
                raise ValidationError("show params must be omitted")
            result = FAMILY_CONTRACT
        elif method == METHOD_VALIDATE:
            if type(params) is not dict or set(params) != {"input"}:
                raise ValidationError("validate params must contain only input")
            result = validate_family(params["input"])
        else:
            return _error(request_id, -32601, "method not found")
    except ValidationError as error:
        return _error(request_id, -32602, str(error))

    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def main() -> int:
    try:
        request = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        response = _error(None, -32700, "invalid JSON")
    else:
        response = _dispatch(request)

    sys.stdout.write(json.dumps(response, sort_keys=True, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
