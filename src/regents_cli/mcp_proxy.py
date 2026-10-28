"""`regents mcp --site <site>`: the site's hosted MCP server, for an agent host on this machine.

An agent host runs this command as a local MCP server over stdin and stdout. Each message it
sends goes on as one POST to the site's `/mcp`, signed with this machine's agent key over the
exact bytes sent, so the site knows which agent is acting without a token in the agent host.
The MCP routing headers (Mcp-Method, Mcp-Name, MCP-Protocol-Version and any Mcp-Param-*) go
with each message as the protocol asks, and every answer comes back unchanged.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, AsyncIterable
from dataclasses import dataclass, field
from typing import Final, Protocol

import anyio
import httpx2
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.inbound import (
    MCP_METHOD_HEADER,
    MCP_NAME_HEADER,
    MCP_PROTOCOL_VERSION_HEADER,
    NAME_BEARING_METHODS,
    encode_header_value,
    find_invalid_x_mcp_header,
    mcp_param_headers,
    x_mcp_header_map,
)
from mcp.shared.message import ClientMessageMetadata, SessionMessage
from mcp_types import (
    PROTOCOL_VERSION_META_KEY,
    JSONRPCError,
    JSONRPCMessage,
    JSONRPCNotification,
    JSONRPCRequest,
    JSONRPCResponse,
    RequestId,
)

from regents_cli import output
from regents_cli.agent_hosts import Signer
from regents_cli.http import Request

#: Connecting and sending give up after 30 seconds; an answer may stream for five minutes.
TIMEOUT: Final = httpx2.Timeout(30, read=300)


class Sends(Protocol):
    async def send(self, item: SessionMessage, /) -> None: ...


class Signed(httpx2.Auth):
    """Signs each request over its method, path and the exact body bytes it sends."""

    requires_request_body = True

    def __init__(self, sign: Signer) -> None:
        self.sign = sign

    async def async_auth_flow(
        self, request: httpx2.Request
    ) -> AsyncGenerator[httpx2.Request, httpx2.Response]:
        signed = await self.sign(
            Request(
                request.method,
                request.url.raw_path.decode("ascii"),
                raw_content=request.content or None,
            )
        )
        request.headers.update(signed)
        yield request


@dataclass(slots=True)
class Routing:
    """The routing headers for each message, from the message and what the site answered."""

    version: str | None = None
    initializing: set[RequestId] = field(default_factory=set)
    listing: set[RequestId] = field(default_factory=set)
    param_headers: dict[str, dict[tuple[str, ...], str]] = field(default_factory=dict)

    def outgoing(self, message: JSONRPCMessage) -> dict[str, str]:
        headers: dict[str, str] = {}
        version = self.version
        if isinstance(message, JSONRPCRequest | JSONRPCNotification):
            params = message.params or {}
            headers[MCP_METHOD_HEADER] = message.method
            key = NAME_BEARING_METHODS.get(message.method)
            name = params.get(key) if key is not None else None
            if isinstance(name, str):
                headers[MCP_NAME_HEADER] = encode_header_value(name)
                if message.method == "tools/call" and name in self.param_headers:
                    arguments = params.get("arguments")
                    headers.update(
                        mcp_param_headers(
                            self.param_headers[name],
                            arguments if isinstance(arguments, dict) else {},
                        )
                    )
            if isinstance(message, JSONRPCRequest) and message.method == "initialize":
                self.initializing.add(message.id)
                return headers
            if isinstance(message, JSONRPCRequest) and message.method == "tools/list":
                self.listing.add(message.id)
            meta = params.get("_meta")
            if isinstance(meta, dict) and isinstance(meta.get(PROTOCOL_VERSION_META_KEY), str):
                version = meta[PROTOCOL_VERSION_META_KEY]
        if version is not None:
            headers[MCP_PROTOCOL_VERSION_HEADER] = version
        return headers

    def incoming(self, message: JSONRPCMessage) -> None:
        if not isinstance(message, JSONRPCResponse | JSONRPCError) or message.id is None:
            return
        initialized = message.id in self.initializing
        listed = message.id in self.listing
        self.initializing.discard(message.id)
        self.listing.discard(message.id)
        if not isinstance(message, JSONRPCResponse):
            return
        if initialized and isinstance(message.result.get("protocolVersion"), str):
            self.version = message.result["protocolVersion"]
        if listed:
            for tool in message.result.get("tools") or []:
                if not (isinstance(tool, dict) and isinstance(tool.get("name"), str)):
                    continue
                schema = tool.get("inputSchema")
                if find_invalid_x_mcp_header(schema) is None:
                    self.param_headers[tool["name"]] = x_mcp_header_map(schema)
                else:
                    self.param_headers.pop(tool["name"], None)


async def relay(
    url: str,
    sign: Signer,
    agent_read: AsyncIterable[SessionMessage | Exception],
    agent_write: Sends,
) -> None:
    """Carry messages between the agent host's streams and the site's MCP endpoint at `url`,
    until the agent host stops sending."""
    routing = Routing()
    async with (
        httpx2.AsyncClient(auth=Signed(sign), timeout=TIMEOUT) as client,
        streamable_http_client(url, http_client=client) as (site_read, site_write),
        anyio.create_task_group() as group,
    ):

        async def to_site() -> None:
            async with site_write:
                async for item in agent_read:
                    if isinstance(item, Exception):
                        output.stderr.print(f"regents mcp: unreadable: {item}", markup=False)
                        continue
                    headers = routing.outgoing(item.message)
                    await site_write.send(
                        SessionMessage(item.message, ClientMessageMetadata(headers=headers))
                    )
            group.cancel_scope.cancel()

        async def to_agent() -> None:
            async for item in site_read:
                if isinstance(item, Exception):
                    output.stderr.print(f"regents mcp: {item}", markup=False)
                    continue
                routing.incoming(item.message)
                await agent_write.send(item)

        group.start_soon(to_site)
        group.start_soon(to_agent)


async def serve(url: str, sign: Signer) -> None:
    from mcp.server.stdio import stdio_server

    async with stdio_server() as (agent_read, agent_write), agent_write:
        await relay(url, sign, agent_read, agent_write)
