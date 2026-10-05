"""`regents techtree skill starter | fetch`: put a Skill on this machine, either a Climb's
starter Skill as this release pins it or a Skill someone published with a Result."""

from __future__ import annotations

import shlex
from pathlib import Path
from typing import Final

import click

from regents_cli.techtree import paths
from regents_cli.techtree.commands.answers import BASE_URL, JSON, emit
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.release.document import packaged_release_core_bytes, parse_release_core
from regents_cli.techtree.site import site_base
from regents_cli.techtree.skills.published import fetch_skill
from regents_cli.techtree.skills.starter import STARTER_SKILLS, StarterSkillService

_OBTAINED: Final[dict[str, str]] = {
    "cache": "was already on this machine",
    "release": "was fetched from the address this release publishes it at",
}


def starter(climb: str | None, as_json: bool) -> None:
    release = parse_release_core(packaged_release_core_bytes())
    reference = release.intro_climb_reference if climb is None else climb
    coordinates = release.climb(reference)
    skill = STARTER_SKILLS[reference]
    materialized = StarterSkillService(paths.home()).materialize(coordinates, skill)
    skill_path = str(materialized.entrypoint)
    # The label is stated because `climb prepare` would otherwise name the candidate after its
    # directory, which is the digest it was verified against.
    prepare_command = shlex.join(
        [
            "regents",
            "techtree",
            "climb",
            "prepare",
            reference,
            "--skill",
            skill_path,
            "--label",
            skill.candidate_label,
        ]
    )
    answer: dict[str, JsonValue] = {
        "release_id": release.release_id,
        "climb_reference": reference,
        "skill_root_digest": materialized.root_digest,
        "skill_path": skill_path,
        "skill_name": skill.name,
        "skill_purpose": skill.purpose,
        "candidate_label": skill.candidate_label,
        "file_count": materialized.file_count,
        "total_bytes": materialized.total_bytes,
        "origin": materialized.origin,
        "prepare_command": prepare_command,
    }
    answer["report"] = "\n".join(
        [
            f"The starter Skill for {reference} {_OBTAINED[materialized.origin]} and matches "
            "the digest this release pins. It is prepared the same way any other Skill is.",
            "",
            f"- Release: {release.release_id}",
            f"- Climb: {reference}",
            f"- Skill: {skill.name}",
            f"- Purpose: {skill.purpose}",
            f"- Candidate label: {skill.candidate_label}",
            f"- Skill content digest: {materialized.root_digest}",
            f"- Skill file: {skill_path}",
            f"- Files: {materialized.file_count}",
            f"- Size: {materialized.total_bytes} bytes",
            "",
            f"Next: {prepare_command}",
        ]
    )
    emit(answer, as_json=as_json)


def fetch(root_digest: str, to: Path | None, base_url: str | None, as_json: bool) -> None:
    fetched = fetch_skill(root_digest, base=site_base(base_url), to=to)
    skill = fetched.skill
    answer: dict[str, JsonValue] = {
        "skill_root_digest": skill.root_digest,
        "skill_name": skill.name,
        "folder": str(fetched.folder),
        "files": [entry.path for entry in skill.files],
        "total_bytes": sum(entry.size for entry in skill.files),
        "results": list(fetched.results),
    }
    answer["report"] = "\n".join(
        [
            f"The Skill {skill.name} matches the fingerprint asked for, and its files are in "
            f"{fetched.folder}. Nothing in it was run.",
            "",
            f"- Fingerprint: {skill.root_digest}",
            f"- Files: {', '.join(entry.path for entry in skill.files)}",
            f"- Size: {answer['total_bytes']} bytes",
            "",
            "Published Results that carried it, newest first:",
            *(f"- {digest}" for digest in fetched.results),
            "",
            "To rerun one: regents techtree climb prepare --rerun-of <digest>",
        ]
    )
    emit(answer, as_json=as_json)


SKILL = click.Group(
    "skill", help="Skills on this machine: a Climb's starter Skill, or one someone published."
)
SKILL.add_command(
    click.Command(
        "starter",
        callback=starter,
        help="Fetch and verify a Climb's starter Skill, and say how to prepare it.",
        params=[
            click.Option(
                ["--climb"],
                metavar="REF",
                help="The Climb whose starter Skill to fetch. Default: the introductory Climb.",
            ),
            JSON,
        ],
    )
)
SKILL.add_command(
    click.Command(
        "fetch",
        callback=fetch,
        help="Fetch a published Skill by its fingerprint, check every file against it, and "
        "write it to a folder. Nothing in it is run.",
        params=[
            click.Argument(["root_digest"], metavar="ROOT_DIGEST"),
            click.Option(
                ["--to"],
                type=click.Path(file_okay=False, path_type=Path),
                help="A new or empty folder. Default: ./<skill name>-<first 12 hex>.",
            ),
            BASE_URL,
            JSON,
        ],
    )
)
