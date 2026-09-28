"""The one place in Techtree that opens a socket: one POST, one answer, no redirects.

SECURITY: only https; nothing ever goes into a URL or query string; a volunteered address
travels in a header beside the body, never inside it; no redirect is followed, so a proof
bundle and a private header are never re-sent to an origin nobody agreed to; the answer must
be JSON and must end, so the body is read in chunks against a cap.
"""

from __future__ import annotations

import json
import os
from typing import Final
from urllib.parse import urlsplit

import httpx

from regents_cli.techtree.errors import TechtreeError, ValidationError
from regents_cli.techtree.release.models import PublicationCoordinates

CONTRIBUTOR_ADDRESS_HEADER: Final = "x-techtree-contributor-address"
SKILL_NAME_HEADER: Final = "x-techtree-skill-name"
SKILL_GITHUB_URL_HEADER: Final = "x-techtree-skill-github-url"

#: Points a development build at a local stand-in for the run log. The pinned network key is
#: never overridable: a key a person can point elsewhere removes what makes a receipt mean
#: anything.
ENDPOINT_VARIABLE: Final = "REGENTS_TECHTREE_PUBLICATION_ENDPOINT"

PUBLICATION_ENDPOINT_INVALID: Final = "publication_endpoint_invalid"
PUBLICATION_TRANSPORT_FAILED: Final = "publication_transport_failed"
PUBLICATION_TRANSPORT_REDIRECTED: Final = "publication_transport_redirected"
PUBLICATION_RESPONSE_NOT_JSON: Final = "publication_response_not_json"
PUBLICATION_RESPONSE_TOO_LARGE: Final = "publication_response_too_large"

MAX_RESPONSE_BYTES: Final = 4 * 1024 * 1024
_MEDIA_TYPE: Final = "application/json"
_TIMEOUT_SECONDS: Final = 120.0


class HttpsPublicationTransport:
    """The real request. A test hands in an `httpx.Client` over `httpx.MockTransport`."""

    def __init__(self, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client(timeout=_TIMEOUT_SECONDS)

    def submit(
        self,
        *,
        endpoint: str,
        body: bytes,
        contributor_address: str | None,
        skill_name: str | None,
        skill_github_url: str | None,
    ) -> bytes:
        """POST `body` to `endpoint` and return the response bytes, or raise a typed failure."""
        headers = {"Content-Type": _MEDIA_TYPE, "Accept": _MEDIA_TYPE}
        if contributor_address is not None:
            headers[CONTRIBUTOR_ADDRESS_HEADER] = contributor_address
        if skill_name is not None:
            headers[SKILL_NAME_HEADER] = skill_name
        if skill_github_url is not None:
            headers[SKILL_GITHUB_URL_HEADER] = skill_github_url
        request = self._client.build_request(
            "POST", validated_endpoint(endpoint), content=body, headers=headers
        )
        try:
            # SECURITY: follow_redirects is set here, on the send, so no client anybody
            # builds can turn it on.
            response = self._client.send(request, stream=True, follow_redirects=False)
            try:
                return _response_bytes(response)
            finally:
                response.close()
        except httpx.HTTPError as error:
            raise TechtreeError(
                "the run log could not be reached, so nothing was sent",
                code=PUBLICATION_TRANSPORT_FAILED,
                details={"reason": type(error).__name__},
            ) from error


def _response_bytes(response: httpx.Response) -> bytes:
    """The answer, having proved it is a JSON document that ended."""
    if 300 <= response.status_code < 400:
        raise TechtreeError(
            f"the run log answered HTTP {response.status_code} and pointed somewhere else, and "
            "a proof bundle is not re-sent to an address that was not the one agreed to",
            code=PUBLICATION_TRANSPORT_REDIRECTED,
            details={"status": response.status_code},
        )
    media_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if not response.is_success:
        refusal = _refusal(_capped_bytes(response)) if media_type == _MEDIA_TYPE else {}
        raise TechtreeError(
            f"the run log refused this submission: HTTP {response.status_code}"
            + (f": {refusal['message']}" if "message" in refusal else ""),
            code=PUBLICATION_TRANSPORT_FAILED,
            details={"status": response.status_code, **refusal},
        )
    if media_type != _MEDIA_TYPE:
        raise TechtreeError(
            f"the run log answered with {media_type or 'no content type'} rather than "
            f"{_MEDIA_TYPE}, so what came back is not a publication receipt",
            code=PUBLICATION_RESPONSE_NOT_JSON,
            details={"content_type": media_type},
        )
    return _capped_bytes(response)


def _refusal(body: bytes) -> dict[str, str]:
    """The site's own `{"error": {code, message, hint}}`, as far as it is there."""
    try:
        error = json.loads(body).get("error")
    except (ValueError, AttributeError):
        return {}
    if not isinstance(error, dict):
        return {}
    said = {
        "site_code": error.get("code"),
        "message": error.get("message"),
        "hint": error.get("hint"),
    }
    return {key: value for key, value in said.items() if isinstance(value, str)}


def _capped_bytes(response: httpx.Response) -> bytes:
    """The whole body, read in chunks against the cap."""
    chunks: list[bytes] = []
    received = 0
    for chunk in response.iter_bytes():
        chunks.append(chunk)
        received += len(chunk)
        if received > MAX_RESPONSE_BYTES:
            raise TechtreeError(
                f"the run log's answer is longer than {MAX_RESPONSE_BYTES} bytes, which no "
                "publication receipt is, so none of it was read further",
                code=PUBLICATION_RESPONSE_TOO_LARGE,
                details={"limit": MAX_RESPONSE_BYTES},
            )
    return b"".join(chunks)


def publication_endpoint(coordinates: PublicationCoordinates) -> str:
    """The address a publication or a withdrawal goes to: the override, else the pinned one."""
    override = os.environ.get(ENDPOINT_VARIABLE)
    if override is not None:
        return validated_endpoint(override)
    return coordinates.submission_endpoint


def validated_endpoint(endpoint: str) -> str:
    """The endpoint, or a refusal of an address nothing may be sent to."""
    parts = urlsplit(endpoint)
    if parts.scheme != "https" or not parts.netloc:
        raise ValidationError(
            "a run log address is an https URL, and this one is not",
            code=PUBLICATION_ENDPOINT_INVALID,
            details={"scheme": parts.scheme},
        )
    if parts.query or parts.fragment:
        raise ValidationError(
            "a run log address carries no query string: a submission travels in the request "
            "body and never in a URL",
            code=PUBLICATION_ENDPOINT_INVALID,
            details={"scheme": parts.scheme},
        )
    return endpoint
