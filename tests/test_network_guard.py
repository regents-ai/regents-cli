"""The suite fails when a test reaches past this machine, even when the code catches the refusal,
and a test that stays on this machine still passes."""

from __future__ import annotations

from pathlib import Path

import pytest

CONFTEST = (Path(__file__).parent / "conftest.py").read_text("utf-8")


def test_a_test_that_reaches_a_live_site_fails_the_suite(pytester: pytest.Pytester) -> None:
    pytester.makeconftest(CONFTEST)
    pytester.makepyfile(
        """
        import httpx, socket, threading

        def test_probe_caught():
            try:
                httpx.get("https://regents.sh/", timeout=5)
            except httpx.HTTPError:
                pass

        def test_probe_by_address():
            socket.create_connection(("1.1.1.1", 443), timeout=5)

        def test_this_machine():
            server = socket.create_server(("127.0.0.1", 0))
            threading.Thread(target=server.accept, daemon=True).start()
            socket.create_connection(server.getsockname(), timeout=5).close()
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
