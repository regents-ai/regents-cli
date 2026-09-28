"""`regents techtree skill starter`: put the starter Skill this release pins on this machine."""

from __future__ import annotations

import shlex
from typing import Final

import click

from regents_cli.techtree import paths
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.constants import (
    STARTER_SKILL_CANDIDATE_LABEL,
    STARTER_SKILL_NAME,
    STARTER_SKILL_PURPOSE,
)
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.release.document import packaged_release_core_bytes, parse_release_core
from regents_cli.techtree.skills.starter import StarterSkillService

_OBTAINED: Final[dict[str, str]] = {
    "cache": "was already on this machine",
    "release": "was fetched from the address this release publishes it at",
}


def starter(as_json: bool) -> None:
    release = parse_release_core(packaged_release_core_bytes())
    materialized = StarterSkillService(paths.home()).materialize(release)
    skill_path = str(materialized.entrypoint)
    # The label is stated because `climb prepare` would otherwise name the candidate after its
    # directory, which is the digest it was verified against.
    prepare_command = shlex.join(
        [
            "regents",
            "techtree",
            "climb",
            "prepare",
            release.intro_climb_reference,
            "--skill",
            skill_path,
            "--label",
            STARTER_SKILL_CANDIDATE_LABEL,
        ]
    )
    answer: dict[str, JsonValue] = {
        "release_id": release.release_id,
        "skill_root_digest": materialized.root_digest,
        "skill_path": skill_path,
        "skill_name": STARTER_SKILL_NAME,
        "skill_purpose": STARTER_SKILL_PURPOSE,
        "candidate_label": STARTER_SKILL_CANDIDATE_LABEL,
        "file_count": materialized.file_count,
        "total_bytes": materialized.total_bytes,
        "origin": materialized.origin,
        "intro_climb_reference": release.intro_climb_reference,
        "prepare_command": prepare_command,
    }
    answer["report"] = "\n".join(
        [
            f"The starter Skill {_OBTAINED[materialized.origin]} and matches the digest this "
            "release pins. It is prepared the same way any other Skill is.",
            "",
            f"- Release: {release.release_id}",
            f"- Skill: {STARTER_SKILL_NAME}",
            f"- Purpose: {STARTER_SKILL_PURPOSE}",
            f"- Candidate label: {STARTER_SKILL_CANDIDATE_LABEL}",
            f"- Skill content digest: {materialized.root_digest}",
            f"- Skill file: {skill_path}",
            f"- Files: {materialized.file_count}",
            f"- Size: {materialized.total_bytes} bytes",
            "",
            f"Next: {prepare_command}",
        ]
    )
    emit(answer, as_json=as_json)


SKILL = click.Group("skill", help="The starter Skill this release pins.")
SKILL.add_command(
    click.Command(
        "starter",
        callback=starter,
        help="Fetch and verify the release's starter Skill, and say how to prepare it.",
        params=[JSON],
    )
)
