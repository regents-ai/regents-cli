"""A Skill the site would refuse is refused here, with the site's code, before it can go public.

The costly failures: a private key, an API key or a transaction hash in a Skill is published
with its Result and cannot be taken back; a Skill whose bytes are not its fingerprint is run,
published or written to disk as if it were; a Skill larger than the site accepts is paid for
and then cannot be published. The CLI and Techtree's site run this same list (cli/COMMANDS.md,
decision 68 a), so each refusal carries the code the site would answer with.
"""

from __future__ import annotations

import pytest

from regents_cli.techtree.canonical import sha256_digest_bytes
from regents_cli.techtree.constants import SKILL_SCHEMA_VERSION
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.manifests.builder import skill_content_digest
from regents_cli.techtree.models.skill import SkillArtifact, SkillFile
from regents_cli.techtree.skills.checks import check_public_skill

_CLEAN = b"# Count letters\n\nSplit the word into letters, then count the ones asked for.\n"


def _skill(files: dict[str, bytes]) -> SkillArtifact:
    entries = [
        SkillFile(
            path=path,
            media_type="text/markdown" if path.endswith(".md") else "text/plain",
            size=len(data),
            digest=sha256_digest_bytes(data),
        )
        for path, data in sorted(files.items())
    ]
    return SkillArtifact(
        schema_version=SKILL_SCHEMA_VERSION,
        name="count-letters",
        root_digest=skill_content_digest(entries),
        files=entries,
        source_kind="manual",
        parent_skill_digest=None,
    )


def _refusal(files: dict[str, bytes], sent: dict[str, bytes] | None = None) -> str:
    skill = _skill(files)
    with pytest.raises(ValidationError) as refused:
        check_public_skill(skill, files if sent is None else sent, expected_root=skill.root_digest)
    return refused.value.code


def test_a_plain_instruction_skill_holds_every_check() -> None:
    files = {"SKILL.md": _CLEAN, "notes.txt": b"Commit 3f2a9c1 and address 0x" + b"ab" * 20}
    skill = _skill(files)
    check_public_skill(skill, files, expected_root=skill.root_digest)


@pytest.mark.parametrize(
    "secret",
    [
        b"-----BEGIN OPENSSH PRIVATE KEY-----",
        b"sk-" + b"a1B2" * 6,
        b"sk-ant-api03-" + b"x9" * 12,
        b"ghp_" + b"A1" * 18,
        b"github_pat_" + b"11ABCDEFG" * 3,
        b"AKIA" + b"ABCDEFGH23456789",
        b"xoxb-1234567890-abcdef",
        b"tx 0x" + b"0f" * 32 + b" settled",
    ],
)
def test_a_skill_holding_a_key_or_a_32_byte_hex_value_is_refused(secret: bytes) -> None:
    assert _refusal({"SKILL.md": _CLEAN + secret + b"\n"}) == "skill_contains_secret"


def test_a_skill_larger_than_the_site_accepts_is_refused() -> None:
    assert _refusal({"SKILL.md": b"a" * (128 * 1024 + 1)}) == "skill_too_large"
    many = {"SKILL.md": _CLEAN, **{f"part-{index:02d}.txt": b"x" for index in range(32)}}
    assert _refusal(many) == "skill_too_large"


def test_bytes_that_are_not_the_fingerprint_are_refused() -> None:
    files = {"SKILL.md": _CLEAN}
    assert _refusal(files, {"SKILL.md": _CLEAN + b" "}) == "skill_fingerprint_mismatch"
    assert _refusal(files, {**files, "extra.md": b"x"}) == "skill_fingerprint_mismatch"
    skill = _skill(files)
    other = _skill({"SKILL.md": b"# Another Skill\n"})
    with pytest.raises(ValidationError) as refused:
        check_public_skill(skill, files, expected_root=other.root_digest)
    assert refused.value.code == "skill_fingerprint_mismatch"


def test_a_path_out_of_the_skill_or_of_another_kind_is_refused() -> None:
    files = {"SKILL.md": _CLEAN}
    assert _refusal(files, {**files, "../SKILL.md": _CLEAN}) == "skill_path_invalid"
    assert _refusal({"SKILL.md": _CLEAN, "run.sh": b"echo hi\n"}) == "skill_path_invalid"
