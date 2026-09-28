"""Build the wheel and fail when it lacks a pinned description, the format it follows, or
any of Techtree's resource files, or the source-commit stamp the build hook writes.

A wheel without them installs a `regents` with no site commands, or a Techtree whose engine,
catalog or release digests no longer match, so this runs before any release.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    package = ROOT / "src/regents_cli"
    resources = package / "techtree/resources"
    wanted = {
        str(path.relative_to(ROOT / "src"))
        for path in [*package.rglob("*.json"), *resources.rglob("*")]
        if path.is_file() and "__pycache__" not in path.parts
    }
    # Stamped by scripts/stamp_provenance.py while the wheel is built; never in the tree.
    wanted.add("regents_cli/techtree/resources/release/build-provenance.json")
    with tempfile.TemporaryDirectory() as out:
        subprocess.run(["uv", "build", "--wheel", "--out-dir", out, "-q"], cwd=ROOT, check=True)
        [wheel] = Path(out).glob("*.whl")
        missing = sorted(wanted - set(zipfile.ZipFile(wheel).namelist()))
    if missing:
        print(f"the wheel lacks: {', '.join(missing)}", file=sys.stderr)
        return 1
    print(f"the wheel carries all {len(wanted)} pinned and resource files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
