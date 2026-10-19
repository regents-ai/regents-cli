"""No test reaches past this machine. A connection to anything but a loopback address is refused,
and the test that tried it fails, even when the code under test catches the refusal. A proxy named
in the environment is dropped first, since a connection to a proxy on this machine would carry the
test past it.
"""

from __future__ import annotations

import errno
import ipaddress
import socket
from collections.abc import Iterator
from typing import Any

import pytest

pytest_plugins = ["pytester"]


@pytest.fixture(autouse=True)
def only_this_machine(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for proxy in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        monkeypatch.delenv(proxy, raising=False)
        monkeypatch.delenv(proxy.lower(), raising=False)
    tried: list[str] = []
    connect, connect_ex = socket.socket.connect, socket.socket.connect_ex

    def refused(sock: socket.socket, address: Any) -> bool:
        if sock.family not in (socket.AF_INET, socket.AF_INET6):
            return False
        host = address[0]
        try:
            loopback = ipaddress.ip_address(host.split("%")[0]).is_loopback
        except ValueError:
            loopback = host == "localhost"
        if loopback:
            return False
        tried.append(f"{address[0]} port {address[1]}")
        return True

    def guarded_connect(sock: socket.socket, address: Any) -> None:
        if refused(sock, address):
            raise ConnectionRefusedError(f"tests stay on this machine; refused {address[0]}")
        connect(sock, address)

    def guarded_connect_ex(sock: socket.socket, address: Any) -> int:
        return errno.ECONNREFUSED if refused(sock, address) else connect_ex(sock, address)

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", guarded_connect_ex)
    yield
    if tried:
        pytest.fail("reached past this machine: " + ", ".join(tried), pytrace=False)
