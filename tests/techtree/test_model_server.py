"""`regents techtree model check-server` accepts a server only when it serves the block's model.

The costly failure: a run's two sides answered by the wrong weights, swapped, or served with
another context length or vLLM version, published as a comparison of one change.
"""

from __future__ import annotations

import contextlib
import io
import json
import socket
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from regents_cli import app
from regents_cli.techtree.canonical import to_json_value
from regents_cli.techtree.models.open_weights import OpenWeightsModel, ServingSpec, WeightsRef

BASELINE_ROOT = "sha256:" + "1" * 64
CANDIDATE_ROOT = "sha256:" + "2" * 64
KEY = "server-key-for-tests"


def _block(weights_root: str) -> OpenWeightsModel:
    return OpenWeightsModel(
        weights=WeightsRef(repo=None, revision=None, weights_root=weights_root),
        tokenizer_digest="sha256:" + "3" * 64,
        chat_template_digest="sha256:" + "4" * 64,
        serving=ServingSpec(
            engine="vllm",
            version="0.11.0",
            dtype="bfloat16",
            quantization=None,
            max_model_len=32768,
        ),
        derivation=None,
    )


@contextlib.contextmanager
def _vllm(
    *, served: str, version: str = "0.11.0", max_model_len: int = 32768, key: str | None = None
) -> Iterator[str]:
    """A stand-in for vLLM's two reads, at its own address."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if key is not None and self.headers.get("Authorization") != f"Bearer {key}":
                self._answer(401, {"error": "Unauthorized"})
            elif self.path == "/v1/models":
                model = {"id": served, "object": "model", "root": "/models/x"}
                self._answer(
                    200, {"object": "list", "data": [model | {"max_model_len": max_model_len}]}
                )
            elif self.path == "/version":
                self._answer(200, {"version": version})
            else:
                self._answer(404, {"detail": "Not Found"})

        def _answer(self, status: int, body: object) -> None:
            content = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, *_: object) -> None:
            return None

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/v1"
    finally:
        server.shutdown()
        server.server_close()


def _check(tmp_path: Path, block: OpenWeightsModel, base_url: str) -> tuple[int, str]:
    block_file = tmp_path / "block.json"
    block_file.write_text(json.dumps(to_json_value(block)))
    shown = io.StringIO()
    with contextlib.redirect_stdout(shown), contextlib.redirect_stderr(io.StringIO()):
        exit_code = app.main(
            [
                "techtree",
                "model",
                "check-server",
                "--block",
                str(block_file),
                "--base-url",
                base_url,
                "--json",
            ]
        )
    return exit_code, shown.getvalue()


def _code(output: str) -> str:
    return json.loads(output)["error"]["code"]  # type: ignore[no-any-return]


def test_a_server_serving_the_block_under_its_root_is_accepted(tmp_path: Path) -> None:
    with _vllm(served=BASELINE_ROOT) as base_url:
        exit_code, output = _check(tmp_path, _block(BASELINE_ROOT), base_url + "/")

    assert exit_code == 0, output
    answer = json.loads(output)
    assert answer["served_model"] == BASELINE_ROOT
    assert answer["base_url"] == base_url
    assert (answer["version"], answer["max_model_len"]) == ("0.11.0", 32768)


@pytest.mark.parametrize(
    "server",
    [
        {"served": BASELINE_ROOT},
        {"served": CANDIDATE_ROOT, "version": "0.10.2"},
        {"served": CANDIDATE_ROOT, "max_model_len": 8192},
    ],
    ids=["the other side's weights", "another vLLM", "another context length"],
)
def test_a_server_serving_anything_else_is_refused(
    tmp_path: Path, server: dict[str, object]
) -> None:
    with _vllm(**server) as base_url:  # type: ignore[arg-type]
        exit_code, output = _check(tmp_path, _block(CANDIDATE_ROOT), base_url)

    assert exit_code != 0
    assert _code(output) == "model_server_mismatch"


def test_a_key_is_read_from_the_environment_and_never_shown(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _vllm(served=BASELINE_ROOT, key=KEY) as base_url:
        monkeypatch.delenv("VLLM_API_KEY", raising=False)
        exit_code, output = _check(tmp_path, _block(BASELINE_ROOT), base_url)
        assert exit_code != 0
        assert _code(output) == "model_server_unreachable"
        assert "VLLM_API_KEY" in output

        monkeypatch.setenv("VLLM_API_KEY", KEY)
        exit_code, output = _check(tmp_path, _block(BASELINE_ROOT), base_url)

    assert exit_code == 0, output
    assert KEY not in output


@pytest.mark.parametrize(
    "base_url",
    [
        "http://operator:hunter2-secret@127.0.0.1:8000/v1",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:8000/v1?model=x",
        "file:///v1",
    ],
    ids=["a password", "not the API base", "a query", "not http"],
)
def test_an_address_that_is_not_an_api_base_is_refused_without_being_repeated(
    tmp_path: Path, base_url: str
) -> None:
    exit_code, output = _check(tmp_path, _block(BASELINE_ROOT), base_url)

    assert exit_code != 0
    assert _code(output) == "model_server_url_invalid"
    assert "hunter2-secret" not in output


def test_a_server_that_cannot_be_reached_is_refused(tmp_path: Path) -> None:
    with socket.socket() as unused:
        unused.bind(("127.0.0.1", 0))
        port = unused.getsockname()[1]
    exit_code, output = _check(tmp_path, _block(BASELINE_ROOT), f"http://127.0.0.1:{port}/v1")

    assert exit_code != 0
    assert _code(output) == "model_server_unreachable"
