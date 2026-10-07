"""Copy each platform's pinned files into src/regents_cli/platforms/.

A platform's command description and API documents live in its own repository, which may be
private; platforms.lock.json names the commit, which must be on that repository's GitHub main.
The files are read at that commit from the platform's checkout beside this one: `repos/<name>`
next to regents-cli's own checkout, where `<name>` is the repository's name. So this runs on the
founder's machine, before each release, and not in the publish workflow.

    uv run scripts/sync_platforms.py          # write the copies
    uv run scripts/sync_platforms.py --check  # fail when a copy differs from its pin
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def git(checkout: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(["git", "-C", str(checkout), *args], capture_output=True, check=False)


def checkouts() -> Path:
    """The folder holding every checkout: the parent of regents-cli's own main checkout."""
    common = git(ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir")
    return Path(common.stdout.decode().strip()).parent.parent


def main(args: list[str]) -> int:
    if args not in ([], ["--check"]):
        print(f"unknown arguments: {' '.join(args)}", file=sys.stderr)
        return 2
    check = args == ["--check"]
    lock = json.loads((ROOT / "platforms.lock.json").read_text("utf-8"))
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
        for source, copy in pin["files"].items():
            shown = git(checkout, "show", f"{commit}:{source}")
            if shown.returncode != 0:
                print(f"{name}: {source} is not in {repository} at {commit}", file=sys.stderr)
                return 1
            target = ROOT / copy
            if check:
                if not target.is_file() or target.read_bytes() != shown.stdout:
                    drifted.append(copy)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(shown.stdout)
                print(f"{name}: {source} -> {copy}")
    if drifted:
        print(
            f"differs from its pin: {', '.join(drifted)}. Run uv run scripts/sync_platforms.py",
            file=sys.stderr,
        )
        return 1
    if check:
        print("platform copies match their pins")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
