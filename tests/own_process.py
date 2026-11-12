"""`regents` run in its own process, as a person or agent runs it, and what it prints there."""

from __future__ import annotations

import os
import selectors
import subprocess
import sys
import time


def started(code: str, *args: str) -> subprocess.Popen[bytes]:
    return subprocess.Popen(
        [sys.executable, "-c", code, *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=dict(os.environ),
    )


def read_until(running: subprocess.Popen[bytes], seen: bytes, on_stderr: bool) -> dict[int, bytes]:
    """What `running` printed on each pipe, read until `seen` is on the one watched."""
    assert running.stdout is not None and running.stderr is not None
    shown = {running.stdout.fileno(): b"", running.stderr.fileno(): b""}
    looking = (running.stderr if on_stderr else running.stdout).fileno()
    deadline = time.monotonic() + 30
    with selectors.DefaultSelector() as watch:
        for pipe in shown:
            os.set_blocking(pipe, False)
            watch.register(pipe, selectors.EVENT_READ)
        while seen not in shown[looking]:
            assert time.monotonic() < deadline, shown
            for ready, _ in watch.select(deadline - time.monotonic()):
                shown[ready.fd] += os.read(ready.fd, 65536)
    return shown
