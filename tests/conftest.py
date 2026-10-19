"""No test reaches past this machine. A connection to anything but a loopback address is refused,
and the test that tried it fails, even when the code under test catches the refusal.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Iterator
from typing import Any

import pytest

pytest_plugins = ["pytester"]


@pytest.fixture(autouse=True)
def only_this_machine(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    tried: list[str] = []
    connect, connect_ex = socket.socket.connect, socket.socket.connect_ex

    def refused(sock: socket.socket, address: Any) -> bool:
        if sock.family not in (socket.AF_INET, socket.AF_INET6):
            return False
        if ipaddress.ip_address(address[0].split("%")[0]).is_loopback:
            return False
        tried.append(f"{address[0]} port {address[1]}")
        return True

    def guarded_connect(sock: socket.socket, address: Any) -> None:
        if refused(sock, address):
            raise ConnectionRefusedError(f"tests stay on this machine; refused {address[0]}")
        connect(sock, address)

    def guarded_connect_ex(sock: socket.socket, address: Any) -> int:
        return 111 if refused(sock, address) else connect_ex(sock, address)

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", guarded_connect_ex)
    yield
    if tried:
        pytest.fail("reached past this machine: " + ", ".join(tried), pytrace=False)
