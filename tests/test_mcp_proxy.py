"""`regents mcp`, run whole against a stand-in MCP server on this machine: an MCP client talks
to it through the relay, every request the site receives is signed by the agent's key over the
exact bytes received, the routing headers go with each message, and answers come back unchanged.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import anyio
import pytest
import uvicorn
from hypothesis import given
from hypothesis import strategies as st
from mcp import Client, StdioServerParameters
from mcp.server.mcpserver import MCPServer
from mcp.shared.inbound import decode_header_value
from mcp.shared.message import SessionMessage
from mcp_types import JSONRPCNotification, JSONRPCRequest, JSONRPCResponse

from regents_cli import app, mcp_proxy
from regents_cli.agent_hosts import key_signer
from tests.signed_agent import ADDRESS, sign_in, signer_of

pytestmark = pytest.mark.anyio

#: Runs `regents` whole, the way an agent host starts it.
REGENTS = "import sys; from regents_cli import app; sys.exit(app.main(sys.argv[1:]))"


def stand_in() -> MCPServer:
    server: MCPServer = MCPServer(name="stand-in")

    @server.tool()
    def echo(text: str) -> str:
        """Answer the text unchanged."""
        return text

    return server


@pytest.fixture
def site(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[str, list[Any]]]:
    """A stand-in MCP server on this machine, and every request it received."""
    sign_in(tmp_path, monkeypatch)
    received: list[dict[str, Any]] = []
    inner = stand_in().streamable_http_app()

    async def recording(scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await inner(scope, receive, send)
            return
        body = bytearray()

        async def reading() -> Any:
            message = await receive()
            body.extend(message.get("body", b""))
            return message

        await inner(scope, reading, send)
        received.append(
            {
                "method": scope["method"],
                "path": scope["raw_path"].decode(),
                "headers": {k.decode(): v.decode() for k, v in scope["headers"]},
                "body": bytes(body),
            }
        )

    listening = socket.socket()
    listening.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(recording, log_level="warning", lifespan="on"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listening]})
    thread.start()
    while not server.started:
        time.sleep(0.01)
    try:
        yield f"http://127.0.0.1:{listening.getsockname()[1]}/mcp", received
    finally:
        server.should_exit = True
        thread.join()
        listening.close()


@asynccontextmanager
async def through_relay(url: str) -> AsyncIterator[Any]:
    """An MCP client transport whose messages go through `regents mcp`'s relay."""
    to_relay, relay_reads = anyio.create_memory_object_stream[SessionMessage | Exception](16)
    relay_writes, from_relay = anyio.create_memory_object_stream[SessionMessage](16)
    sign = key_signer("ash-template")
    async with anyio.create_task_group() as group:
        group.start_soon(mcp_proxy.relay, url, sign, relay_reads, relay_writes)
        async with to_relay, from_relay:
            yield from_relay, to_relay


async def test_signs_every_request_and_passes_the_routing_headers(
    site: tuple[str, list[dict[str, Any]]],
) -> None:
    url, received = site
    async with Client(through_relay(url)) as client:
        listed = await client.list_tools()
        answered = await client.call_tool("echo", {"text": "héllo"})
    assert [tool.name for tool in listed.tools] == ["echo"]
    assert answered.structured_content == {"result": "héllo"}

    assert received
    for request in received:
        assert request["path"] == "/mcp"
        signer = signer_of(request["method"], "/mcp", request["body"], request["headers"])
        assert signer == ADDRESS
    posts = [request for request in received if request["method"] == "POST"]
    [called] = [post for post in posts if post["headers"].get("mcp-method") == "tools/call"]
    assert called["headers"]["mcp-name"] == "echo"
    assert json.loads(called["body"])["params"]["arguments"] == {"text": "héllo"}
    versioned = [post for post in posts if b'"initialize"' not in post["body"]]
    assert all("mcp-protocol-version" in post["headers"] for post in versioned)


async def test_runs_whole_as_an_agent_hosts_mcp_server(
    site: tuple[str, list[dict[str, Any]]],
) -> None:
    url, received = site
    command = StdioServerParameters(
        command=sys.executable,
        args=["-c", REGENTS, "mcp", "--site", "ash-template", "--base-url", url[: -len("/mcp")]],
        env={"SIWA_AGENT_HOME": os.environ["SIWA_AGENT_HOME"]},
    )
    async with Client(command) as client:
        answered = await client.call_tool("echo", {"text": "hi"})
    assert answered.structured_content == {"result": "hi"}
    assert received
    for request in received:
        signer = signer_of(request["method"], "/mcp", request["body"], request["headers"])
        assert signer == ADDRESS


def test_stops_when_the_agent_host_closes_its_input(
    site: tuple[str, list[dict[str, Any]]],
) -> None:
    url, _ = site
    opening = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "host", "version": "1"},
        },
    }
    started = time.monotonic()
    finished = subprocess.run(
        [sys.executable, "-c", REGENTS, "mcp", "--site", "ash-template", "--base-url", url[:-4]],
        input=json.dumps(opening) + "\n",
        capture_output=True,
        text=True,
        timeout=60,
        env={"SIWA_AGENT_HOME": os.environ["SIWA_AGENT_HOME"]},
    )
    assert finished.returncode == 0, finished.stderr
    assert time.monotonic() - started < 30


def test_mirrors_the_parameters_a_listed_tool_marks_for_headers() -> None:
    routing = mcp_proxy.Routing(version="2026-07-28")
    routing.outgoing(JSONRPCRequest(jsonrpc="2.0", id=1, method="tools/list", params={}))
    schema = {
        "type": "object",
        "properties": {"region": {"type": "string", "x-mcp-header": "Region"}},
    }
    routing.incoming(
        JSONRPCResponse(
            jsonrpc="2.0",
            id=1,
            result={"tools": [{"name": "deploy", "inputSchema": schema}]},
        )
    )
    headers = routing.outgoing(
        JSONRPCRequest(
            jsonrpc="2.0",
            id=2,
            method="tools/call",
            params={"name": "deploy", "arguments": {"region": "eu-west"}},
        )
    )
    assert {name.lower(): value for name, value in headers.items()} == {
        "mcp-method": "tools/call",
        "mcp-name": "deploy",
        "mcp-param-region": "eu-west",
        "mcp-protocol-version": "2026-07-28",
    }


def test_carries_the_version_the_handshake_settled() -> None:
    routing = mcp_proxy.Routing()
    opening = routing.outgoing(
        JSONRPCRequest(jsonrpc="2.0", id=1, method="initialize", params={"capabilities": {}})
    )
    assert "mcp-protocol-version" not in {name.lower() for name in opening}
    routing.incoming(JSONRPCResponse(jsonrpc="2.0", id=1, result={"protocolVersion": "2025-11-25"}))
    later = routing.outgoing(JSONRPCNotification(jsonrpc="2.0", method="notifications/initialized"))
    assert {name.lower(): value for name, value in later.items()} == {
        "mcp-method": "notifications/initialized",
        "mcp-protocol-version": "2025-11-25",
    }


@given(name=st.text(min_size=1), version=st.sampled_from(["2025-11-25", "2026-07-28"]))
def test_routing_headers_carry_any_tool_name_safely(name: str, version: str) -> None:
    routing = mcp_proxy.Routing(version=version)
    headers = routing.outgoing(
        JSONRPCRequest(
            jsonrpc="2.0", id=1, method="tools/call", params={"name": name, "arguments": {}}
        )
    )
    lowered = {key.lower(): value for key, value in headers.items()}
    assert decode_header_value(lowered["mcp-name"]) == name
    assert lowered["mcp-protocol-version"] == version
    assert all(value.isascii() and value.isprintable() for value in headers.values())


@pytest.mark.parametrize(
    ("command", "missing", "install"),
    [
        ("mcp", "httpx2", "'regents-cli[mcp]'"),
        ("mcp", "mcp", "'regents-cli[mcp]'"),
        ("browser", "playwright", "'regents-cli[browser]'"),
        ("browser", "jsonschema", "'regents-cli[browser]'"),
    ],
)
def test_names_the_install_line_for_a_missing_part(
    command: str,
    missing: str,
    install: str,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setitem(sys.modules, missing, None)
    code = app.main([command, "--site", "ash-template"])
    shown = capsys.readouterr()

    assert code != 0
    assert "needs a part of regents-cli this installation lacks" in shown.err
    assert install in shown.err.replace("\n", " ")
