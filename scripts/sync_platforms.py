"""Copy each platform's pinned files into src/regents_cli/platforms/.

A platform's command description and API documents live in its own public repository;
platforms.lock.json names the commit, which must be on that repository's GitHub main.

    uv run scripts/sync_platforms.py          # write the copies
    uv run scripts/sync_platforms.py --check  # fail when a copy differs from its pin
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent


def main(args: list[str]) -> int:
    if args not in ([], ["--check"]):
        print(f"unknown arguments: {' '.join(args)}", file=sys.stderr)
        return 2
    check = args == ["--check"]
    lock = json.loads((ROOT / "platforms.lock.json").read_text("utf-8"))
    drifted = []
    for name, pin in lock.items():
        for source, copy in pin["files"].items():
            url = f"https://raw.githubusercontent.com/{pin['repository']}/{pin['commit']}/{source}"
            response = httpx.get(url, timeout=30)
            if response.status_code != 200:
                print(f"{name}: {source} answered {response.status_code} ({url})", file=sys.stderr)
                return 1
            target = ROOT / copy
            if check:
                if not target.is_file() or target.read_bytes() != response.content:
                    drifted.append(copy)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(response.content)
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
