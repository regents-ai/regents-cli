"""Reading public records from Techtree's site: one GET, one capped JSON answer, no redirects.

The address is `--base-url`, then `TECHTREE_BASE_URL`, then the site this release publishes
to. What comes back is data that is checked before anything is written: a bundle is verified
offline in full, and a Skill against its fingerprint.
"""

from __future__ import annotations

from typing import Any, Final
from urllib.parse import quote, urlsplit

import httpx

from regents_cli.errors import EXIT_UNREACHABLE, CommandError
from regents_cli.http import answer, base_address
from regents_cli.techtree.release.document import packaged_release_core_bytes, parse_release_core

BASE_URL_VARIABLE: Final = "TECHTREE_BASE_URL"
SITE_RESPONSE_TOO_LARGE: Final = "site_response_too_large"

#: A published proof is the largest thing the site serves; nothing it serves is larger.
MAX_RESPONSE_BYTES: Final = 64 * 1024 * 1024
_TIMEOUT_SECONDS: Final = 120.0
_ENCODING_HEADERS: Final = frozenset({"content-encoding", "content-length", "transfer-encoding"})


def site_base(flag: str | None) -> str:
    """`--base-url`, then `TECHTREE_BASE_URL`, then the origin this release publishes to."""
    endpoint = parse_release_core(packaged_release_core_bytes()).publication.submission_endpoint
    parts = urlsplit(str(endpoint))
    return base_address(flag, BASE_URL_VARIABLE, f"{parts.scheme}://{parts.netloc}")


def get_json(base: str, *segments: str, client: httpx.Client | None = None) -> Any:
    """GET `base` + `/api/v1/<segments>` and return the JSON answer, or raise the site's refusal
    with its code, message and hint."""
    path = "/api/v1/" + "/".join(quote(segment, safe=":") for segment in segments)
    owned = client is None
    session = client or httpx.Client(timeout=_TIMEOUT_SECONDS)
    try:
        request = session.build_request("GET", base + path, headers={"accept": "application/json"})
        # SECURITY: no redirect is followed, so an answer always comes from the address named.
        response = session.send(request, stream=True, follow_redirects=False)
        try:
            body = _capped(response, base)
        finally:
            response.close()
    except httpx.HTTPError:
        raise CommandError(
            "unreachable",
            f"{base} could not be reached. The request was not retried.",
            exit_code=EXIT_UNREACHABLE,
        ) from None
    finally:
        if owned:
            session.close()
    # The body is already decoded, so the headers that describe its encoding stay behind.
    headers = {
        name: value
        for name, value in response.headers.items()
        if name.lower() not in _ENCODING_HEADERS
    }
    return answer(httpx.Response(response.status_code, headers=headers, content=body))


def _capped(response: httpx.Response, base: str) -> bytes:
    chunks: list[bytes] = []
    received = 0
    for chunk in response.iter_bytes():
        chunks.append(chunk)
        received += len(chunk)
        if received > MAX_RESPONSE_BYTES:
            raise CommandError(
                SITE_RESPONSE_TOO_LARGE,
                f"{base} answered with more than {MAX_RESPONSE_BYTES} bytes, which nothing it "
                "publishes is, so none of it was read further.",
            )
    return b"".join(chunks)
