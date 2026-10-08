"""Copy each platform's pinned files into src/regents_cli/platforms/, and check the copies.

A platform's command description and API documents live in its own repository, which may be
private; platforms.lock.json names the commit, which must be on that repository's GitHub main,
and the sha256 of each copy. The files are read at that commit from the platform's checkout
beside this one: `repos/<name>` next to regents-cli's own checkout, where `<name>` is the
repository's name.

    uv run scripts/sync_platforms.py           # write the copies and their sha256 in the lock
    uv run scripts/sync_platforms.py --check   # fail when a copy differs from its pinned commit
    uv run scripts/sync_platforms.py --copies  # fail when the copies are not exactly the lock's

`--check` reads the sites' checkouts, so it runs on the founder's machine before each release.
`--copies` reads only this tree, so the publish workflow runs it: a copy edited by hand, or a
platform folder the lock does not name, never ships.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / "platforms.lock.json"
PLATFORMS = ROOT / "src/regents_cli/platforms"
PACKAGE_FILES = {"__init__.py"}


def git(checkout: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(["git", "-C", str(checkout), *args], capture_output=True, check=False)


def checkouts() -> Path:
    """The folder holding every checkout: the parent of regents-cli's own main checkout."""
    common = git(ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir")
    return Path(common.stdout.decode().strip()).parent.parent


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def pinned_files(lock: dict[str, Any]) -> dict[str, str]:
    """Every copy the lock names, by path, with its sha256."""
    return {
        entry["copy"]: entry["sha256"] for pin in lock.values() for entry in pin["files"].values()
    }


def copies(lock: dict[str, Any]) -> int:
    pinned = pinned_files(lock)
    present = {
        str(path.relative_to(ROOT))
        for path in PLATFORMS.rglob("*")
        if path.is_file() and "__pycache__" not in path.parts and path.name not in PACKAGE_FILES
    }
    problems = [f"{copy} is not in the lock" for copy in sorted(present - set(pinned))]
    problems += [f"{copy} is missing" for copy in sorted(set(pinned) - present)]
    problems += [
        f"{copy} is not the pinned file"
        for copy in sorted(present & set(pinned))
        if sha256((ROOT / copy).read_bytes()) != pinned[copy]
    ]
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    print(f"all {len(pinned)} platform copies are the pinned files")
    return 0


def main(args: list[str]) -> int:
    if args not in ([], ["--check"], ["--copies"]):
        print(f"unknown arguments: {' '.join(args)}", file=sys.stderr)
        return 2
    lock = json.loads(LOCK.read_text("utf-8"))
    if args == ["--copies"]:
        return copies(lock)
    check = args == ["--check"]
    folder = checkouts()
    drifted = []
    for name, pin in lock.items():
        repository, commit = pin["repository"], pin["commit"]
        checkout = folder / repository.split("/")[1]
        if git(checkout, "fetch", "-q", "origin", "main").returncode != 0:
            print(f"{name}: could not fetch {repository} into {checkout}", file=sys.stderr)
            return 1
        if git(checkout, "merge-base", "--is-ancestor", commit, "origin/main").returncode != 0:
            print(f"{name}: {commit} is not on {repository}'s main", file=sys.stderr)
            return 1
        for source, entry in pin["files"].items():
            shown = git(checkout, "show", f"{commit}:{source}")
            if shown.returncode != 0:
                print(f"{name}: {source} is not in {repository} at {commit}", file=sys.stderr)
                return 1
            target = ROOT / entry["copy"]
            if check:
                if (
                    not target.is_file()
                    or target.read_bytes() != shown.stdout
                    or entry["sha256"] != sha256(shown.stdout)
                ):
                    drifted.append(entry["copy"])
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(shown.stdout)
                entry["sha256"] = sha256(shown.stdout)
                print(f"{name}: {source} -> {entry['copy']}")
    if drifted:
        print(
            f"differs from its pin: {', '.join(drifted)}. Run uv run scripts/sync_platforms.py",
            file=sys.stderr,
        )
        return 1
    if check:
        print("platform copies match their pins")
        return 0
    LOCK.write_text(json.dumps(lock, indent=2) + "\n", "utf-8")
    return copies(lock)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
