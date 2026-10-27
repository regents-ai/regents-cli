"""The feature map, verification/features.yml, in the shape control/verification/standard.md
sets out: each thing a person, agent or operator does with `regents`, who does it, its level
(copy, ordinary or protected), the files that serve it, how it is reached, the tests that prove
it, the bugs those tests keep fixed, and its gaps.

Each site's commands are one feature per command group, written from the pinned copies with
the WebMCP tool that does the same (scripts/webmcp_parity.py); a group with a signed or paying
command is protected. The features `regents` serves itself are listed here by hand; the map
grows as features are touched. A proof is a property proof when it uses Hypothesis's `@given`,
and an end-to-end proof when it runs whole `regents` commands (`app.main`).

    uv run scripts/features.py --write     # write verification/features.yml
    uv run scripts/features.py --check     # make check
    uv run scripts/features.py --release   # make release-check

`--check` fails when the file is not the map of the pinned copies, an allowlisted tool or command
in scripts/webmcp_parity.py no longer needs its entry, a proof or regression test does not exist,
or a source file changed since the last release (the newest v* tag) is in no feature. `--release`
also fails when a protected feature the change touches lacks a property or an end-to-end proof.
Both print the features the change touches, its level, and every gap.
"""

from __future__ import annotations

import json
import subprocess
import sys
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any

import yaml
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from webmcp_parity import (
    PLATFORMS,
    TOOL_MANIFESTS,
    WHO,
    command_state,
    compare,
    stale,
    tool_state,
)

ROOT = Path(__file__).resolve().parent.parent
FEATURES = ROOT / "verification/features.yml"
LOCK = ROOT / "platforms.lock.json"
REPLAYS = ROOT / "tests/replays"
LEVELS = ("copy", "ordinary", "protected")
#: Where the map's files live; a changed file elsewhere (tests, docs) is a proof or a note.
MAPPED_ROOTS = ("src/", "scripts/")

SIGNED_FILES = [
    f"src/regents_cli/{name}"
    for name in (
        "__init__.py",
        "__main__.py",
        "app.py",
        "base.py",
        "errors.py",
        "http.py",
        "next_steps.py",
        "output.py",
        "runner.py",
        "siwa.py",
        "platforms/__init__.py",
        "schemas/**",
    )
]

#: The features `regents` serves itself, not from a site's description.
OWN: list[dict[str, Any]] = [
    {
        "id": "signed-requests",
        "what": "An agent runs any site's command: regents builds the request from the site's "
        "pinned description, signs it with the agent key, sends it once, and returns the answer "
        "or the refusal with what to do next.",
        "who": "agent",
        "level": "protected",
        "paths": SIGNED_FILES,
        "entry": [
            {"cli": "regents <site> <command>"},
            {"cli": "regents <site> <command> --phase prepare, then --phase send"},
        ],
        "proofs": [
            "tests/test_properties.py",
            "tests/test_replays.py",
            "tests/test_next_steps.py",
            "tests/test_prepared.py",
            "tests/test_contract.py",
        ],
        "regressions": [
            {
                "id": "R-20261018-refusal-fields",
                "from": "1.10.15 candidate: a site error field named exit_code crashed regents",
                "test": "tests/test_properties.py",
            },
            {
                "id": "R-20261018-deep-bodies",
                "from": "review of 6570fcd: an answer nested too deep, or holding NaN",
                "test": "tests/test_properties.py",
            },
            {
                "id": "R-20261018-dash-values",
                "from": "review of 6098f3b: a printed command misread values starting with -",
                "test": "tests/test_properties.py",
            },
            {
                "id": "R-20261019-node-words",
                "from": "1.10.15 hold: a Base node's own refusal reached the screen, and a short "
                "wallet was not told how much it needed",
                "test": "tests/test_register.py",
            },
            {
                "id": "R-20261020-pairing-page",
                "from": "16 Oct review: an unpaired agent on any site was sent to regents.sh to "
                "pair, though each site pairs its own agents",
                "test": "tests/test_next_steps.py",
            },
        ],
        "gaps": [
            "Signed commands are proven against local stand-ins only; nothing is signed against "
            "the live sites."
        ],
    },
    {
        "id": "site-doctor",
        "what": "An agent checks a site: it answers, its public reads answer, and this machine's "
        "sign-in is good, or not made yet; a site that fails is searched for on patchbay.help, "
        "then reported there.",
        "who": "agent",
        "level": "ordinary",
        "paths": ["src/regents_cli/doctor.py"],
        "entry": [{"cli": "regents <site> doctor"}],
        "proofs": [],
        "regressions": [],
        "gaps": [
            "No test yet (tests wait until a release has worked live for an hour): a failing "
            "site is searched for before it is reported; checks against another address are "
            "not posted against the site; no sign-in yet exits 0; an expired sign-in exits 1.",
            "The sign-in check is not run against the live sign-in server.",
        ],
    },
    {
        "id": "sign-in",
        "what": "An agent signs in to a site with its key, or a person with their own wallet, and "
        "the site's receipt is kept for that site.",
        "who": "agent",
        "level": "protected",
        "paths": ["src/regents_cli/auth.py"],
        "entry": [
            {"cli": "regents auth login"},
            {"cli": "regents auth register"},
            {"cli": "regents auth status"},
            {"cli": "regents auth logout"},
            {"cli": "regents auth accept-world-id"},
        ],
        "proofs": ["tests/test_sign_in.py", "tests/test_register.py", "tests/test_contract.py"],
        "regressions": [
            {
                "id": "R-20261019-register-signs-server-step",
                "from": "1.10.15 hold: auth register signed the step the sign-in server sent "
                "without building it, and showed nothing before signing",
                "test": "tests/test_register.py",
            },
            {
                "id": "R-20261019-register-answer",
                "from": "1.10.15 hold: a registration answer missing a listing field crashed "
                "auth register",
                "test": "tests/test_register.py",
            },
            {
                "id": "R-20261019-register-keeps-hash",
                "from": "review of 026fda3: a sign-in server error after sending lost the "
                "transaction hash, inviting a second registration",
                "test": "tests/test_register.py",
            },
            {
                "id": "R-20261019-register-signed-bytes",
                "from": "review of 026fda3: the cost left out Base's fee for writing to "
                "Ethereum, node numbers were read loosely, and the helper's signed bytes went "
                "unchecked",
                "test": "tests/test_register.py",
            },
            {
                "id": "R-20261019-register-signing-hash",
                "from": "Sentinel read of 37063e8: the signed-bytes check compared only the shown "
                "fields, so an access list or an EIP-7702 delegation signed by the helper went "
                "out; review of 9ff97a5: other signature forms and spellings of the bytes passed",
                "test": "tests/test_register.py",
            },
        ],
        "gaps": [
            "auth accept-world-id is not run whole offline.",
            "auth register is proven against a stand-in Base node; nothing is sent on Base.",
        ],
    },
    {
        "id": "touch-id-key",
        "what": "On a Mac, a person locks the agent key with Touch ID; a helper keeps it unlocked "
        "until the Mac restarts and signs for the agent.",
        "who": "person",
        "level": "protected",
        "paths": [
            "src/regents_cli/passkey.py",
            "src/regents_cli/passkey.html",
            "src/regents_cli/browser.py",
        ],
        "entry": [{"cli": "regents auth login, the first time on a Mac"}],
        "proofs": ["tests/test_passkey.py", "tests/test_touch_id_page.py"],
        "regressions": [
            {
                "id": "R-20261008-stuck-helper",
                "from": "WD-002: a key helper that never answered hung every signed command",
                "test": "tests/test_passkey.py",
            }
        ],
        "gaps": [
            "The page is run in headless Chromium with a virtual Touch ID, not Safari, and on a "
            "Mac only: the publish workflow's Linux run skips it, and make release-check runs it. "
            "scripts/check_live.py checks it is the live sign-in server's page."
        ],
    },
    {
        "id": "techtree-model-sign-in",
        "what": "A person signs this machine in to their ChatGPT plan, so Climbs can run on it.",
        "who": "person",
        "level": "protected",
        "paths": [
            "src/regents_cli/techtree/chatgpt/**",
            "src/regents_cli/techtree/commands/model.py",
        ],
        "entry": [
            {"cli": "regents techtree model login"},
            {"cli": "regents techtree model status"},
            {"cli": "regents techtree model logout"},
        ],
        "proofs": ["tests/techtree/test_model_sign_in.py"],
        "regressions": [
            {
                "id": "R-20261018-deep-oauth-error",
                "from": "review of 6570fcd: a refused sign-in body nested too deep crashed login",
                "test": "tests/techtree/test_model_sign_in.py",
            },
            {
                "id": "R-20261019-model-sign-in-state",
                "from": "review of 026fda3: nothing checked an answer for another attempt or "
                "where logout revokes",
                "test": "tests/techtree/test_model_sign_in.py",
            },
        ],
        "gaps": ["model login, status and logout are proven against a stand-in for OpenAI only."],
    },
    {
        "id": "techtree-approval",
        "what": "Before a Techtree step that needs agreement, the agent shows its person the "
        "review and runs the step only once they agree.",
        "who": "agent",
        "level": "ordinary",
        "paths": ["src/regents_cli/techtree/approval.py"],
        "entry": [{"cli": "regents techtree publish"}, {"cli": "regents techtree withdraw"}],
        "proofs": ["tests/techtree/test_approval.py"],
    },
    {
        "id": "techtree-publication",
        "what": "An agent publishes a finished run to Techtree's public log or withdraws it, "
        "signed and sent once, and reads published runs and Skills back from the site.",
        "who": "agent",
        "level": "protected",
        "paths": [
            "src/regents_cli/techtree/publication/**",
            "src/regents_cli/techtree/site.py",
        ],
        "entry": [{"cli": "regents techtree publish"}, {"cli": "regents techtree withdraw"}],
        "proofs": [
            "tests/techtree/test_publish_command.py",
            "tests/techtree/test_publication_auth.py",
            "tests/techtree/test_published_skill.py",
        ],
        "gaps": ["Publishing is proven against a stand-in for techtree.sh only."],
    },
    {
        "id": "techtree-release",
        "what": "The Techtree release this build belongs to, and whether it holds.",
        "who": "operator",
        "level": "ordinary",
        "paths": [
            "src/regents_cli/techtree/release/**",
            "src/regents_cli/techtree/resources/release/**",
            "scripts/techtree/release-inputs.json",
            "scripts/techtree/build_release_*.py",
            "scripts/techtree/verify_release_core.py",
        ],
        "entry": [
            {"cli": "regents techtree release info"},
            {"cli": "regents techtree release verify"},
        ],
        "proofs": ["tests/techtree/test_release_checks.py"],
    },
    {
        "id": "techtree-evaluation-engine",
        "what": "A Climb's tasks are checked, and its runs scored, by the pinned Verifiers engine "
        "in the pinned images.",
        "who": "operator",
        "level": "ordinary",
        "paths": [
            "src/regents_cli/techtree/verifiers/**",
            "src/regents_cli/techtree/models/validation.py",
            "src/regents_cli/techtree/resources/engines/**",
            "src/regents_cli/techtree/resources/catalog/**",
            "scripts/techtree/build_engine_bundle.py",
            "scripts/techtree/build_fixture_catalog.py",
            "scripts/techtree/build_goldens.py",
            "scripts/techtree/tasksets.py",
            "scripts/techtree/subject-image/**",
            "scripts/techtree/subject-image-cpp/**",
            "scripts/techtree/tasksmith-image/**",
        ],
        "entry": [{"cli": "regents techtree climb start"}],
        "proofs": [
            "tests/techtree/test_golden.py",
            "tests/techtree/test_verifiers_child.py",
            "tests/techtree/test_proof.py",
        ],
        "regressions": [
            {
                "id": "R-20261027-provider-retry",
                "from": "1.10.19 paid runs: one provider 502 made a whole run unusable, because "
                "no task was ever rerun",
                "test": "tests/techtree/test_compiled_config.py",
            },
            {
                "id": "R-20261027-provider-cut-off",
                "from": "1.10.19 paid runs: a task the provider cut off partway was scored as "
                "the subject's result",
                "test": "tests/techtree/test_provider_failure.py",
            },
        ],
    },
    {
        "id": "release-gates",
        "what": "The maintainer's gates before each commit and release: the pinned copies, the "
        "command check sites also run, the feature map, the live reads and the wheel.",
        "who": "operator",
        "level": "ordinary",
        "paths": [
            "scripts/check_live.py",
            "scripts/check_siwa_server.py",
            "scripts/check_wheel.py",
            "scripts/features.py",
            "scripts/record_replays.py",
            "scripts/stamp_provenance.py",
            "scripts/sync_platforms.py",
            "scripts/webmcp_parity.py",
            "src/regents_cli/check_commands.py",
        ],
        "entry": [{"cli": "make check"}, {"cli": "make release-check"}, {"cli": "make sync"}],
        "proofs": [
            "tests/test_check_commands.py",
            "tests/test_replays.py",
            "tests/test_network_guard.py",
        ],
        "regressions": [
            {
                "id": "R-20261019-tests-stay-local",
                "from": "1.10.15 hold: nothing stopped a test reaching a live site",
                "test": "tests/test_network_guard.py",
            },
            {
                "id": "R-20261019-guard-proxy",
                "from": "review of 026fda3: a proxy on this machine carried a test past the "
                "guard, and its proof needed the network",
                "test": "tests/test_network_guard.py",
            },
        ],
    },
]


def site_features(site: dict[str, Any], replayed: set[str]) -> list[dict[str, Any]]:
    """One feature per command group of a pinned site."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in site["rows"]:
        groups.setdefault(row["command"].split(" ")[0], []).append(row)
    name = site["name"]
    features = []
    for group, rows in groups.items():
        rest = [row["command"].removeprefix(group).strip() for row in rows]
        uses = ", ".join(part for part in rest if part)
        protected = any(row["authority"] != "public" or row["effect"] == "payment" for row in rows)
        named = {row["command"] for row in rows}
        gaps = [
            f"`{command}` has no WebMCP tool"
            for command in site["lone_commands"]
            if command in named
        ] + [
            f"`{command}` names `{tool}`, which the site does not list"
            for command, tool in site["unknown_tools"]
            if command in named
        ]
        feature: dict[str, Any] = {
            "id": f"{name}-{group}",
            "what": f"Agents use regents {name} {group}" + (f": {uses}." if uses else "."),
            "who": "agent",
            "level": "protected" if protected else "ordinary",
            "paths": [f"src/regents_cli/platforms/{name}/**", f"tool_manifests/{name}.json"],
            "entry": [
                {
                    "cli": f"regents {name} {row['command']}",
                    "route": f"{row['method']} {row['path']}",
                    "who": WHO[row["authority"]],
                    "changes": row["effect"],
                    "webmcp": command_state(site, row).replace("**", ""),
                }
                for row in rows
            ],
            "proofs": ["tests/test_properties.py"]
            + (["tests/test_replays.py"] if named & replayed else []),
        }
        if gaps:
            feature["gaps"] = gaps
        features.append(feature)
    return features


def replayed_commands(site: str) -> set[str]:
    path = REPLAYS / f"{site}.json"
    if not path.is_file():
        return set()
    return {case["command"] for case in json.loads(path.read_text("utf-8"))}


def feature_map(sites: list[dict[str, Any]]) -> dict[str, Any]:
    lock = json.loads(LOCK.read_text("utf-8"))
    features = list(OWN)
    pinned = []
    for site in sites:
        features += site_features(site, replayed_commands(site["name"]))
        lone = sorted(tool for tool, by in site["done_by"].items() if not by)
        pinned.append(
            {
                "site": site["name"],
                "repository": lock[site["name"]]["repository"],
                "commit": lock[site["name"]]["commit"],
                "commands": site["commands"],
                "tools": site["tools"],
                "tools_with_no_command": [
                    {"tool": tool, "why": tool_state(site, tool).replace("**", "")} for tool in lone
                ],
            }
        )
    return {"repo": "regents-cli", "features": features, "sites": pinned}


def written(sites: list[dict[str, Any]]) -> str:
    header = (
        "# Written by uv run scripts/features.py --write from the pinned copies and the\n"
        "# features listed in that script; make check fails when this file is out of date.\n"
    )
    return header + yaml.safe_dump(
        feature_map(sites), sort_keys=False, allow_unicode=True, width=100
    )


def kinds(test: str) -> set[str]:
    """What a test proves beyond a unit: properties (Hypothesis), and whole commands run."""
    text = (ROOT / test).read_text("utf-8")
    return {
        kind for kind, mark in (("property", "@given"), ("end to end", "app.main(")) if mark in text
    }


def tests_of(feature: dict[str, Any]) -> list[str]:
    return [*feature["proofs"], *(r["test"] for r in feature.get("regressions", []))]


def git(*args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(ROOT), *args], capture_output=True, text=True, check=True
    ).stdout


def changed_since_release() -> tuple[str, list[str]]:
    """The newest release tag, and every file changed since it, committed or not."""
    tag = git("describe", "--tags", "--abbrev=0", "--match", "v*").strip()
    files = git("diff", "--name-only", tag).splitlines()
    files += git("ls-files", "--others", "--exclude-standard").splitlines()
    return tag, sorted(set(files))


def in_feature(path: str, feature: dict[str, Any]) -> bool:
    return any(fnmatchcase(path, pattern) for pattern in feature["paths"])


def main(args: list[str]) -> int:
    console = Console(highlight=False)
    if args not in (["--write"], ["--check"], ["--release"]):
        console.print("[red]Give one of --write, --check or --release.[/red]")
        return 2
    names = sorted(path.parent.name for path in PLATFORMS.glob("*/commands.json"))
    if missing := [name for name in names if not (TOOL_MANIFESTS / f"{name}.json").is_file()]:
        console.print(f"[red]Pinned sites with no tool manifest:[/red] {', '.join(missing)}")
        return 1
    sites = [compare(name) for name in names]
    text = written(sites)
    if args == ["--write"]:
        FEATURES.parent.mkdir(exist_ok=True)
        FEATURES.write_text(text, "utf-8")
        console.print(f"wrote {FEATURES.relative_to(ROOT)}")
        return 0
    problems: list[str] = []
    if unneeded := stale(sites):
        problems.append(f"Allowlist entries no site needs: {', '.join(unneeded)}")
    if not FEATURES.is_file() or FEATURES.read_text("utf-8") != text:
        problems.append(
            f"{FEATURES.relative_to(ROOT)} is not the map of the pinned copies. Run uv run "
            "scripts/features.py --write and read what changed."
        )
    features = feature_map(sites)["features"]
    tests = {test for feature in features for test in tests_of(feature)}
    problems += [
        f"{test} is named as a proof and does not exist"
        for test in sorted(tests)
        if not (ROOT / test).is_file()
    ]
    tag, changed = changed_since_release()
    unmapped = [
        path
        for path in changed
        if path.startswith(MAPPED_ROOTS)
        and (ROOT / path).exists()
        and not any(in_feature(path, feature) for feature in features)
    ]
    problems += [f"{path} changed since {tag} and is in no feature" for path in unmapped]
    touched = [f for f in features if any(in_feature(path, f) for path in changed)]

    # One row per feature of regents itself; a site's command groups share one row.
    own = {feature["id"] for feature in OWN}
    rows: dict[str, dict[str, Any]] = {}
    for feature in touched:
        proven = set().union(*(kinds(t) for t in tests_of(feature) if (ROOT / t).is_file()))
        lacking = {"property", "end to end"} - proven if feature["level"] == "protected" else set()
        if args == ["--release"]:
            problems += [
                f"{feature['id']} is protected and has no {kind} proof" for kind in sorted(lacking)
            ]
        first = feature["paths"][0]
        key = (
            first.removeprefix(f"{PLATFORMS.relative_to(ROOT)}/").removesuffix("/**")
            if feature["id"] not in own
            else feature["id"]
        )
        row = rows.setdefault(key, {"groups": 0, "level": LEVELS[0], "proven": proven, "gaps": []})
        row["groups"] += 1
        row["level"] = max(row["level"], feature["level"], key=LEVELS.index)
        row["proven"] &= proven
        row["gaps"] += [f"{feature['id']}: no {kind} proof" for kind in sorted(lacking)]
        row["gaps"] += [f"{feature['id']}: {gap}" for gap in feature.get("gaps", [])]
    table = Table(title=f"Features the change since {tag} touches", title_justify="left")
    for column in ("Feature", "Level", "Proofs beyond unit tests", "Gaps"):
        table.add_column(column)
    for key, row in rows.items():
        table.add_row(
            key if key in own else f"{key}: {row['groups']} command groups",
            row["level"],
            ", ".join(sorted(row["proven"])) or "none",
            escape("; ".join(row["gaps"])),
        )
    console.print(table)
    level = max((LEVELS.index(f["level"]) for f in touched), default=0)
    sources = git("ls-files", *MAPPED_ROOTS).splitlines()
    mapped_none = [p for p in sources if not any(in_feature(p, f) for f in features)]
    lone_tools = sum(1 for site in sites for _ in site["lone_tools"])
    gaps = sum(len(f.get("gaps", [])) for f in features) + lone_tools
    console.print(
        f"Level {LEVELS[level]}. {len(features)} features, {gaps} gaps "
        f"({lone_tools} WebMCP tools with no command); {len(mapped_none)} of {len(sources)} "
        "source files are in no feature yet."
    )
    if problems:
        for problem in problems:
            console.print(f"[red]✗[/red] {escape(problem)}")
        return 1
    console.print(f"[green]✓[/green] {FEATURES.relative_to(ROOT)} is current")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
