"""Write the Techtree release record for one published regents-cli release.

Techtree serves its first-run steps from a release record: `priv/releases/<release id>/`
(bootstrap.json, checksums.json, release-core.json) and the catalog snapshot
`priv/catalog/sources/<cli source revision>/` beside it. This writes both, in that layout, under
`--out`, for the Techtree chief to commit.

The CLI's half comes from the release's tag (`v<version>`): its ReleaseCore and catalog, byte
for byte, and the wheel's sha256 from PyPI. Techtree's half (each starter Skill's details, the
host prompt, the minimums other than Hermes, the plugin repository) comes from the previous
record, with the plugin revision Techtree names. The previous record must hold another release
id, and each Climb's starter Skill must be the one this ReleaseCore names.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

import httpx

from regents_cli.techtree.canonical import canonical_json_bytes, sha256_digest_bytes
from regents_cli.techtree.release.document import parse_release_core, render_document
from regents_cli.techtree.release.models import ReleaseCore

ROOT: Final = Path(__file__).resolve().parents[2]
RESOURCES: Final = "src/regents_cli/techtree/resources"
CHECKSUMS_SCHEMA: Final = "techtree.release-checksums.v2"
REVISION_LENGTH: Final = 40


class RecordError(Exception):
    """Why the record can't be written."""


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def tagged_files(revision: str, folder: str) -> dict[str, bytes]:
    """Every file under `folder` at `revision`, by its path inside `folder`."""
    listed = git("ls-tree", "-r", "--name-only", revision, folder).decode()
    return {
        path.removeprefix(f"{folder}/"): git("show", f"{revision}:{path}")
        for path in listed.splitlines()
    }


def wheel_sha256(version: str) -> str:
    answer = httpx.get(f"https://pypi.org/pypi/regents-cli/{version}/json", timeout=30)
    answer.raise_for_status()
    wheels = [u for u in answer.json()["urls"] if u["packagetype"] == "bdist_wheel"]
    if len(wheels) != 1:
        raise RecordError(f"PyPI lists {len(wheels)} wheels for regents-cli {version}, not one.")
    return f"sha256:{wheels[0]['digests']['sha256']}"


def bootstrap(
    previous: dict[str, Any],
    core: ReleaseCore,
    version: str,
    revision: str,
    wheel: str,
    plugin: str,
    published_at: str,
) -> dict[str, Any]:
    climbs = {}
    for reference, climb in core.climbs.items():
        skill = previous["climbs"].get(reference, {}).get("starter_skill")
        if (
            skill is None
            or skill["tree_digest"] != climb.starter_skill_digest
            or skill["object_url"] != climb.starter_skill_object_url
        ):
            raise RecordError(
                f"{reference}'s starter Skill is not the previous record's; its name, size and "
                "file digest have to come from Techtree."
            )
        climbs[reference] = {"starter_skill": skill}
    plugin_block = previous["hermes_plugin"]
    install = plugin_block["install_argv"]
    return {
        "channel": previous["channel"],
        "cli": {
            "distribution": "regents-cli",
            "install_argv": [
                "uv",
                "tool",
                "install",
                "--python",
                "3.12",
                f"regents-cli=={version}",
            ],
            "source_revision": revision,
            "version": version,
            "wheel_sha256": wheel,
        },
        "climbs": climbs,
        "hermes_plugin": {
            **plugin_block,
            "install_argv": [*install[: install.index("--ref") + 1], plugin, "--enable"],
            "revision": plugin,
        },
        "introductory_climb": {
            "host_prompt": previous["introductory_climb"]["host_prompt"],
            "reference": core.intro_climb_reference,
        },
        "minimums": {**previous["minimums"], "hermes_version": core.minimum_host_hermes_version},
        "placeholder_release": False,
        "published_at": published_at,
        "schema_version": previous["schema_version"],
    }


def checksums(
    core: ReleaseCore,
    core_raw: bytes,
    boot: dict[str, Any],
    boot_raw: bytes,
    wheel: str,
    previous: dict[str, Any],
) -> bytes:
    core_digest = sha256_digest_bytes(core_raw)
    payload = {
        "coordinates": {
            "catalog_index": core.catalog_digest,
            "cli_wheel": wheel,
            "climbs": {
                reference: {
                    "engine": climb.engine_digest,
                    "starter_skill_file": boot["climbs"][reference]["starter_skill"]["file_digest"],
                    "starter_skill_tree": climb.starter_skill_digest,
                }
                for reference, climb in core.climbs.items()
            },
        },
        "files": {
            "bootstrap.json": sha256_digest_bytes(boot_raw),
            "release-core.json": core_digest,
        },
        "release_id": core.release_id,
        "schema_version": CHECKSUMS_SCHEMA,
        "sources": {
            "cli_source_revision": boot["cli"]["source_revision"],
            "hermes_plugin_commit": boot["hermes_plugin"]["revision"],
            "hermes_plugin_repository": previous["sources"]["hermes_plugin_repository"],
            "release_core_digest": core_digest,
        },
    }
    return (json.dumps(payload, indent=1, sort_keys=True, ensure_ascii=False) + "\n").encode()


def main() -> int:
    """Write the record, or say why not and write nothing."""
    try:
        return write_record()
    except RecordError as refused:
        print(refused, file=sys.stderr)
        return 1


def write_record() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--version", required=True, help="The published CLI version, such as 1.10.2."
    )
    parser.add_argument(
        "--previous", required=True, type=Path, help="The previous release's folder."
    )
    parser.add_argument("--plugin-revision", required=True, help="The Hermes plugin commit.")
    parser.add_argument("--out", required=True, type=Path, help="An empty folder to write into.")
    parser.add_argument("--published-at", help="When the record is published; default now.")
    arguments = parser.parse_args()
    plugin = arguments.plugin_revision
    if len(plugin) != REVISION_LENGTH or not all(c in "0123456789abcdef" for c in plugin):
        raise RecordError("--plugin-revision is a full 40-character commit.")
    if arguments.out.exists() and any(arguments.out.iterdir()):
        raise RecordError(f"{arguments.out} is not empty.")
    tag = f"v{arguments.version}"
    revision = git("rev-parse", f"{tag}^{{commit}}").decode().strip()
    release = tagged_files(revision, f"{RESOURCES}/release")
    catalog = tagged_files(revision, f"{RESOURCES}/catalog")
    core_raw = release["release-core.json"]
    core = parse_release_core(core_raw)
    if core.cli_version != arguments.version:
        raise RecordError(f"{tag}'s ReleaseCore names CLI {core.cli_version}.")
    previous_boot = json.loads((arguments.previous / "bootstrap.json").read_bytes())
    previous_sums = json.loads((arguments.previous / "checksums.json").read_bytes())
    if previous_sums["release_id"] == core.release_id:
        raise RecordError(
            f"The previous record already holds {core.release_id}; release the CLI with a new "
            "release_id in scripts/techtree/release-inputs.json."
        )
    now = datetime.now(UTC)
    published_at = arguments.published_at or now.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    wheel = wheel_sha256(arguments.version)
    boot = bootstrap(previous_boot, core, arguments.version, revision, wheel, plugin, published_at)
    boot_raw = canonical_json_bytes(boot)
    source = render_document(
        {
            "catalog_digest": core.catalog_digest,
            "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "generator_version": arguments.version,
            "techtree_python_revision": revision,
        }
    )
    written = {
        f"releases/{core.release_id}/release-core.json": core_raw,
        f"releases/{core.release_id}/bootstrap.json": boot_raw,
        f"releases/{core.release_id}/checksums.json": checksums(
            core, core_raw, boot, boot_raw, wheel, previous_sums
        ),
        f"catalog/sources/{revision}/bootstrap.json": boot_raw,
        f"catalog/sources/{revision}/source.json": source,
        **{f"catalog/sources/{revision}/{path}": raw for path, raw in catalog.items()},
    }
    for path, raw in written.items():
        target = arguments.out / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    print(f"{core.release_id}: regents-cli {arguments.version} ({revision}), plugin {plugin}")
    print(f"  bootstrap {sha256_digest_bytes(boot_raw)}")
    print(f"  release-core {sha256_digest_bytes(core_raw)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
