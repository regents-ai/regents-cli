"""Puts Verifiers' chat program where its subprocess runtime looks for it, at image build.

Verifiers runs the model's side of an evaluation as a small standalone program with its own
packages, and prepares it with `uv sync --script` the first time a run needs it, which would
install those packages from PyPI while the job runs. The GPU image prepares it while it is
built instead, from chat-program.lock in this folder, which names every wheel by sha256. With
that lock beside the program and its environment already made, the runtime's own preparation
finds nothing to do. Prints the program's path.
"""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

from verifiers.v1.harnesses.utils.launch import CHAT_PROGRAM_SOURCE
from verifiers.v1.runtimes.subprocess import SubprocessRuntime

LOCK = Path(__file__).with_name("chat-program.lock")


def main() -> None:
    program = CHAT_PROGRAM_SOURCE.encode()
    path = Path(SubprocessRuntime.scripts_dir) / f"{hashlib.sha256(program).hexdigest()}.py"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(program)
    shutil.copy(LOCK, f"{path}.lock")
    print(path)


if __name__ == "__main__":
    main()
