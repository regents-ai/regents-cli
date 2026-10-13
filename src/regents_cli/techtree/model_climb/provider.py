"""San Francisco Compute's Autoresearch batch jobs, over its HTTP API (contract 6.1).

The engine signs in with the operator's service token, read from `GMN_TOKEN`; it is never
printed, stored or sent anywhere but that API. Six calls are all the engine makes: read the
rate, ask whether a job would be taken, submit one job, find a job by its label, read a job,
and cancel a job.

Autoresearch publishes what each call takes and describes what it answers in prose. The answer
fields read here are the ones its manual names (read 13 Oct 2026). An answer without one of
them is refused, never guessed at.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Final

import httpx
from pydantic import BaseModel, ConfigDict
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.errors import TechtreeError
from regents_cli.techtree.model_climb.attempts import SubmissionOutcomeUnknownError
from regents_cli.techtree.models.base import JsonValue

BASE_URL: Final = "https://autoresearch.sfcompute.com"
TOKEN_ENV: Final = "GMN_TOKEN"
TIMEOUT_SECONDS: Final = 60.0
UNSUPPORTED_CAPABILITY: Final = "unsupported_capability"
MICROS_PER_CENT: Final = 10_000
#: What the free preflight reads of a job; the rest only matters to a real run.
PREFLIGHT_FIELDS: Final = (
    "chip",
    "chip_count",
    "command",
    "env",
    "model",
    "checks",
    "max_duration_minutes",
    "resume",
)


class SubmissionRefusedError(TechtreeError):
    """The provider answered the submission and created no job."""


class _Answer(BaseModel):
    """The fields the engine reads from an answer; Autoresearch sends many more."""

    model_config = ConfigDict(extra="ignore")


class Validation(_Answer):
    max_cost_usd_micros: int
    max_duration_minutes: int
    would_submit: bool
    #: The provider's own account of each thing it looked at, as it gave it.
    preflight: JsonValue = None


class Receipt(_Answer):
    """What ran and what it cost, which Autoresearch puts on a job once it has ended."""

    image_digest: str | None = None
    charged_usd_micros: int
    billed_seconds: int


class Job(_Answer):
    id: str
    status: str
    #: The ceiling of one attempt, worked out by the provider from minutes, GPUs and rate.
    max_cost_usd_micros: int | None = None
    #: What the job wrote to $GMN_RESULT_PATH, as it wrote it.
    result: JsonValue = None
    receipt: Receipt | None = None

    @property
    def ended(self) -> bool:
        return self.receipt is not None


class _Jobs(_Answer):
    items: list[Job]


@dataclass(frozen=True)
class Autoresearch:
    token: str

    @classmethod
    def signed_in(cls) -> Autoresearch:
        token = os.environ.get(TOKEN_ENV, "")
        if not token:
            raise TechtreeError(
                f"the compute provider can't be read: {TOKEN_ENV} is not set on this machine. "
                "The operator creates a service token scoped to the workspace and sets it "
                "there; nothing was sent.",
                code=UNSUPPORTED_CAPABILITY,
                details={"step": "provider_token"},
            )
        return cls(token)

    def micros_per_gpu_minute(self, chip: str, count: int) -> int:
        """The batch-job rate now, read from the provider's free preflight of an hour-long
        job. Submits nothing."""
        minutes = 60
        answer = self._send(
            "POST",
            "/preview/jobs/validate",
            body={
                "chip": chip,
                "chip_count": count,
                "max_duration_minutes": minutes,
                "resume": "none",
            },
        )
        validation = _read(Validation, answer, "the job preflight")
        rate, rest = divmod(validation.max_cost_usd_micros, minutes * count)
        if validation.max_duration_minutes != minutes or rest or rate <= 0:
            raise TechtreeError(
                "the compute provider's price can't be read: its preflight answered a maximum "
                f"of {validation.max_cost_usd_micros} millionths of a dollar for "
                f"{validation.max_duration_minutes} minutes on {count} GPUs, which is no "
                "whole rate per GPU-minute",
                code=UNSUPPORTED_CAPABILITY,
                details={"step": "price"},
            )
        return rate

    def preflight(self, body: dict[str, JsonValue]) -> int:
        """The most, in millionths of a dollar, the provider says this job could be billed;
        refused when it says it would not take the job. Free, and submits nothing."""
        answer = self._send(
            "POST", "/preview/jobs/validate", body={name: body[name] for name in PREFLIGHT_FIELDS}
        )
        validation = _read(Validation, answer, "the job preflight")
        if not validation.would_submit:
            raise TechtreeError(
                "the compute provider would not take this job, so nothing was submitted: "
                + json.dumps(validation.preflight)[:500],
                code=UNSUPPORTED_CAPABILITY,
                details={"step": "preflight", "preflight": validation.preflight},
            )
        return validation.max_cost_usd_micros

    def submit(self, body: dict[str, JsonValue]) -> str:
        """Create the job and return its id. `SubmissionOutcomeUnknownError` when the request
        left and no answer says whether a job exists; `SubmissionRefusedError` when the
        provider answered that it took none."""
        try:
            response = self._request("POST", "/preview/jobs", body=body)
        except httpx.TransportError as error:
            raise SubmissionOutcomeUnknownError from error
        if response.status_code >= 500:
            raise SubmissionOutcomeUnknownError
        if response.status_code >= 400:
            raise SubmissionRefusedError(
                f"the compute provider refused the job ({response.status_code}), so none "
                f"exists: {response.text[:500]}",
                code=UNSUPPORTED_CAPABILITY,
                details={"step": "submit", "status": response.status_code},
            )
        try:
            return Job.model_validate_json(response.content).id
        except PydanticValidationError as error:
            raise SubmissionOutcomeUnknownError from error

    def find(self, label: str) -> str | None:
        """The id of the job submitted under `label`, if the provider has one."""
        answer = self._send("GET", "/preview/jobs", query={"label": label, "limit": "2"})
        jobs = _read(_Jobs, answer, "the job list").items
        return jobs[0].id if jobs else None

    def job(self, job_id: str) -> Job:
        # links=false: a download link is a credential for that file, and none is needed here.
        answer = self._send("GET", f"/preview/jobs/{job_id}", query={"links": "false"})
        return _read(Job, answer, f"job {job_id}")

    def cancel(self, job_id: str) -> None:
        self._send("POST", f"/preview/jobs/{job_id}/cancel", body={})

    def build_usage(self) -> JsonValue:
        """What this month's usage shows for image builds, as the provider gives it; None
        when it shows none."""
        answer = self._send("GET", "/preview/usage")
        return answer.get("builds") if isinstance(answer, dict) else None

    def _send(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, str] | None = None,
        body: dict[str, JsonValue] | None = None,
    ) -> Any:
        try:
            response = self._request(method, path, query=query, body=body)
        except httpx.TransportError as error:
            raise TechtreeError(
                f"the compute provider at {BASE_URL} could not be reached; the request was "
                "not sent again",
                code=UNSUPPORTED_CAPABILITY,
                details={"step": "provider", "path": path},
            ) from error
        if response.status_code >= 400:
            raise _refused(response)
        return response.json()

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, str] | None = None,
        body: dict[str, JsonValue] | None = None,
    ) -> httpx.Response:
        return httpx.request(
            method,
            BASE_URL + path,
            params=query,
            json=body,
            headers={"authorization": f"Bearer {self.token}", "accept": "application/json"},
            timeout=TIMEOUT_SECONDS,
            follow_redirects=False,
        )


def _read[T: _Answer](shape: type[T], answer: Any, what: str) -> T:
    try:
        return shape.model_validate(answer)
    except PydanticValidationError as error:
        problem = error.errors()[0]
        field = ".".join(str(part) for part in problem["loc"])
        raise TechtreeError(
            f"the compute provider's answer for {what} can't be read: {field}: {problem['msg']}",
            code=UNSUPPORTED_CAPABILITY,
            details={"step": "provider_answer", "field": field},
        ) from error


def _refused(response: httpx.Response) -> TechtreeError:
    return TechtreeError(
        f"the compute provider refused the request ({response.status_code}): {response.text[:500]}",
        code=UNSUPPORTED_CAPABILITY,
        details={"step": "provider", "status": response.status_code},
    )


def cents(micros: int) -> int:
    """An amount in millionths of a dollar as whole cents, rounded up: never under-reported."""
    return -(-micros // MICROS_PER_CENT)
