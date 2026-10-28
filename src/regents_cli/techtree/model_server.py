"""The open_weights route: whether an operator's vLLM server serves the model a block names.

A model substitution run reaches each side's model on a vLLM server the operator runs, by the
base URL of its OpenAI-compatible API. Each side is served under its own `weights_root` as the
served model name (vLLM `--served-model-name`), so the name the subject asks for is the digest
of the weights it should be answered by, and the two sides cannot be swapped unseen.

Before a run uses a server, it is asked, with two free reads:

- `GET <base_url>/models` lists exactly one model, the side's `weights_root`, with
  `max_model_len` equal to the block's `serving.max_model_len`. A second name or a LoRA adapter
  on the same server would let a request for one side be answered by other weights;
- `GET <server>/version` answers the block's `serving.version`.

What the server cannot show, the bytes it loaded, its dtype and quantization, stays the
operator's statement; a rerun by someone else is what checks it. When the server needs a key it
is read from `VLLM_API_KEY`, vLLM's own name for it, sent as a bearer token and never shown.
"""

from __future__ import annotations

import contextlib
import os
from dataclasses import dataclass
from typing import Final, NoReturn

import httpx
from pydantic import BaseModel, ConfigDict
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.errors import PrerequisiteError, UsageError, ValidationError
from regents_cli.techtree.models.open_weights import OpenWeightsModel

MODEL_SERVER_MISMATCH: Final = "model_server_mismatch"
MODEL_SERVER_UNREACHABLE: Final = "model_server_unreachable"
MODEL_SERVER_URL_INVALID: Final = "model_server_url_invalid"
MODEL_SERVER_KEY_INVALID: Final = "model_server_key_invalid"
SERVER_KEY_ENV: Final = "VLLM_API_KEY"

_API_PATH_SUFFIX: Final = "/v1"
_TIMEOUT_SECONDS: Final = 10.0
_HIGHEST_PORT: Final = 65535


class _Upstream(BaseModel):
    """An answer vLLM writes: only the members read here are checked."""

    model_config = ConfigDict(strict=True, extra="ignore", frozen=True)


class _ServedModel(_Upstream):
    id: str
    max_model_len: int | None


class _ServedModels(_Upstream):
    data: list[_ServedModel]


class _ServerVersion(_Upstream):
    version: str


@dataclass(frozen=True)
class ServerCheck:
    """A server that serves the block's weights under their root, as the block says."""

    base_url: str
    served_model: str
    version: str
    max_model_len: int


def api_base_url(base_url: str) -> httpx.URL:
    """`base_url` when it is the base of an OpenAI-compatible API: http or https, ending in
    `/v1`, with no user, password, query or fragment. Its path is kept as written, escapes and
    all."""
    try:
        url = httpx.URL(base_url)
    except httpx.InvalidURL:
        _invalid_url("it is not a URL")
    if url.scheme not in ("http", "https") or not url.host:
        _invalid_url("it must be an http or https address")
    if url.port is not None and not 0 < url.port <= _HIGHEST_PORT:
        _invalid_url(f"its port must be between 1 and {_HIGHEST_PORT}")
    if url.userinfo or url.query or url.fragment:
        _invalid_url("it must carry no user, password, query or fragment")
    if not url.raw_path.rstrip(b"/").endswith(_API_PATH_SUFFIX.encode()):
        _invalid_url(f"it must be the API's base, ending in {_API_PATH_SUFFIX}")
    return httpx.URL(str(url).rstrip("/"))


def check_server(
    base_url: str, block: OpenWeightsModel, *, client: httpx.Client | None = None
) -> ServerCheck:
    """The server at `base_url`, checked against `block`; refused when it serves anything else."""
    api = api_base_url(base_url)
    served_name = block.weights.weights_root
    headers = _key_header()
    with (
        contextlib.nullcontext(client)
        if client is not None
        else httpx.Client(timeout=_TIMEOUT_SECONDS)
    ) as http:
        models = _get(http, httpx.URL(f"{api}/models"), _ServedModels, headers)
        version = _get(
            http,
            httpx.URL(f"{str(api).removesuffix(_API_PATH_SUFFIX)}/version"),
            _ServerVersion,
            headers,
        )
    served = [model.id for model in models.data]
    if served != [served_name]:
        _mismatch(
            f"the server must serve {served_name} and nothing else, but it lists "
            f"{len(served)} model(s); start it with --served-model-name {served_name} alone and "
            "no LoRA adapters",
            served=served,
        )
    max_model_len = models.data[0].max_model_len
    if max_model_len != block.serving.max_model_len:
        _mismatch(
            f"the server's context length is {max_model_len} tokens, but the block says "
            f"{block.serving.max_model_len}",
            served_max_model_len=max_model_len,
        )
    if version.version != block.serving.version:
        _mismatch(
            f"the server runs vLLM {version.version}, but the block says {block.serving.version}",
            served_version=version.version,
        )
    return ServerCheck(
        base_url=str(api),
        served_model=served_name,
        version=version.version,
        max_model_len=max_model_len,
    )


def _key_header() -> dict[str, str]:
    key = os.environ.get(SERVER_KEY_ENV)
    if not key:
        return {}
    if not (key.isascii() and key.isprintable()):
        # The key is never repeated, not even the character at fault.
        raise UsageError(
            f"{SERVER_KEY_ENV} holds characters a request header cannot carry; set it to the "
            "key the server was started with",
            code=MODEL_SERVER_KEY_INVALID,
        )
    return {"Authorization": f"Bearer {key}"}


def _get[T: _Upstream](
    http: httpx.Client, url: httpx.URL, shape: type[T], headers: dict[str, str]
) -> T:
    try:
        response = http.get(url, headers=headers)
    except httpx.HTTPError as error:
        raise PrerequisiteError(
            f"the model server at {url} could not be reached: {type(error).__name__}",
            code=MODEL_SERVER_UNREACHABLE,
            details={"url": str(url)},
        ) from error
    if response.status_code == httpx.codes.UNAUTHORIZED:
        raise PrerequisiteError(
            f"the model server at {url} asks for a key; set {SERVER_KEY_ENV} to the key it was "
            "started with",
            code=MODEL_SERVER_UNREACHABLE,
            details={"url": str(url), "status": response.status_code},
        )
    if response.status_code != httpx.codes.OK:
        raise PrerequisiteError(
            f"the model server at {url} answered {response.status_code}",
            code=MODEL_SERVER_UNREACHABLE,
            details={"url": str(url), "status": response.status_code},
        )
    try:
        return shape.model_validate_json(response.content)
    except PydanticValidationError as error:
        _mismatch(
            f"the server at {url} did not answer as vLLM does: {error.error_count()} problem(s)",
            url=str(url),
        )


def _mismatch(message: str, **details: object) -> NoReturn:
    raise ValidationError(message, code=MODEL_SERVER_MISMATCH, details=details)


def _invalid_url(reason: str) -> NoReturn:
    # The address is never repeated: it may carry a password.
    raise UsageError(
        f"the model server address is not usable: {reason}", code=MODEL_SERVER_URL_INVALID
    )
