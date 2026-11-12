"""The suite fails when a test reaches past this machine, even when the code catches the refusal
or a proxy on this machine is named, and a test that stays on this machine still passes. The
probes use addresses, not names, so the proof needs no network to look a name up."""

from __future__ import annotations

from pathlib import Path

import pytest

CONFTEST = (Path(__file__).parent / "conftest.py").read_text("utf-8")


def test_a_test_that_reaches_a_live_site_fails_the_suite(
    pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Port 9 on this machine refuses, which the guard allows; without dropping the proxy, the
    # probe below would reach only it and pass.
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:9")
    pytester.makeconftest(CONFTEST)
    pytester.makepyfile(
        """
        import httpx, socket, threading

        def test_probe_caught():
            try:
                httpx.get("https://192.0.2.1/", timeout=5)
            except httpx.HTTPError:
                pass

        def test_probe_by_address():
            socket.create_connection(("1.1.1.1", 443), timeout=5)

        def test_this_machine():
            server = socket.create_server(("127.0.0.1", 0))
            threading.Thread(target=server.accept, daemon=True).start()
            socket.create_connection(server.getsockname(), timeout=5).close()
            with socket.socket() as by_name:
                by_name.connect(("localhost", server.getsockname()[1]))
        """
    )
    ran = pytester.runpytest("-p", "no:cacheprovider")
    # The caught probe passes its own body and fails after it; the loopback test passes.
    ran.assert_outcomes(passed=2, failed=1, errors=2)
    assert ran.ret == pytest.ExitCode.TESTS_FAILED
    ran.stdout.fnmatch_lines_random(
        [
            "*ERROR*::test_probe_caught*",
            "*ERROR*::test_probe_by_address*",
            "*reached past this machine: * port 443*",
        ]
    )
    ran.stdout.no_fnmatch_line("*test_this_machine*reached*")
