"""A refused ChatGPT sign-in step is read for its OAuth error code whatever the body holds, and
never crashes `regents techtree model login` (R-20261018-deep-oauth-error: a body nested deeper
than Python reads raised RecursionError instead of answering).
"""

from __future__ import annotations

import json

import httpx
from hypothesis import example, given
from hypothesis import strategies as st

from regents_cli.techtree.chatgpt.signin import _oauth_error

JSON = st.recursive(
    st.none() | st.booleans() | st.integers() | st.text(),
    lambda inner: st.lists(inner, max_size=3) | st.dictionaries(st.text(), inner, max_size=3),
    max_leaves=10,
)
BODIES = st.binary() | JSON.map(lambda value: json.dumps(value).encode("utf-8"))


@given(BODIES)
@example(b"[" * 100_000 + b"]" * 100_000)
@example(b'{"error": "invalid_grant"}')
def test_any_refused_body_gives_its_error_code_or_none(body: bytes) -> None:
    code = _oauth_error(httpx.Response(400, content=body))
    try:
        read = json.loads(body)
    except (ValueError, RecursionError):
        assert code is None
        return
    said = read.get("error") if isinstance(read, dict) else None
    assert code == (said if isinstance(said, str) else None)
