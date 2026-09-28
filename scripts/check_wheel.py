"""Build the wheel and fail when it lacks a pinned description or the format it follows.

A wheel without them installs a `regents` with no site commands, so this runs before
any release.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    wanted = {
        str(path.relative_to(ROOT / "src")) for path in (ROOT / "src/regents_cli").rglob("*.json")
    }
    with tempfile.TemporaryDirectory() as out:
        subprocess.run(["uv", "build", "--wheel", "--out-dir", out, "-q"], cwd=ROOT, check=True)
        [wheel] = Path(out).glob("*.whl")
        missing = sorted(wanted - set(zipfile.ZipFile(wheel).namelist()))
    if missing:
        print(f"the wheel lacks: {', '.join(missing)}", file=sys.stderr)
        return 1
    print(f"the wheel carries all {len(wanted)} pinned files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
