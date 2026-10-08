"""A stuck key helper ends the command with a clear error and never unlocks the key a second
time behind it (WD-002: without a limit, every signed command hung with no message)."""

from __future__ import annotations

import os
import socket
import tempfile
import threading
import time
from collections.abc import Iterator
from typing import Any

import pytest

from regents_cli import passkey
from regents_cli.errors import CommandError


@pytest.fixture
def stuck_helper(request: pytest.FixtureRequest) -> Iterator[str]:
    """A helper socket that is listening but never answers; it accepts the connection or not."""
    path = os.path.join(tempfile.mkdtemp(prefix="rc", dir="/tmp"), "h.sock")
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(path)
    listener.listen(1)
    held: list[socket.socket] = []
    if request.param == "accepts":
        threading.Thread(target=lambda: held.append(listener.accept()[0]), daemon=True).start()
    yield path
    for connection in held:
        connection.close()
    listener.close()
    os.unlink(path)
    os.rmdir(os.path.dirname(path))


@pytest.mark.parametrize("stuck_helper", ["never_accepts", "accepts"], indirect=True)
def test_a_silent_helper_ends_the_command(
    stuck_helper: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    def must_not_unlock(*_: Any) -> None:
        raise AssertionError("unlocked the key again behind a stuck helper")

    monkeypatch.setattr(passkey, "HELPER_ANSWER_SECONDS", 0.5)
    monkeypatch.setattr(passkey, "_helper_socket", lambda _address: stuck_helper)
    monkeypatch.setattr(passkey, "_open_box", must_not_unlock)
    monkeypatch.setattr(passkey, "start_helper", must_not_unlock)

    started = time.monotonic()
    with pytest.raises(CommandError) as raised:
        passkey.unlocked("0x" + "ab" * 20, {}, {"op": "address"})
    assert raised.value.code == "key_helper_not_answering"
    assert stuck_helper in raised.value.message
    assert time.monotonic() - started < 5
