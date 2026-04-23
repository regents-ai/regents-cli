import {
  readIdentityReceipt,
  updateIdentityReceipt,
} from "../internal-runtime/identity/cache.js";
import { getBooleanFlag, type ParsedCliArgs } from "../parse.js";
import { CLI_PALETTE, printJson, renderPanel, tone } from "../printer.js";
import { parsePollingIntervalSeconds, requirePositional } from "./autolaunch/shared.js";
import { buildAgentAuthHeaders, requireAgentAuthState } from "./agent-auth.js";

interface CreateAgentbookTrustSessionRequest {
  source: string;
}

interface AgentbookTrustSummary {
  connected: boolean;
  world_human_id: string | null;
  unique_agent_count: number;
  connected_at: string | null;
  source: string | null;
}

interface AgentbookFrontendRequest {
  app_id: string;
  action: string;
  signal: string;
  rp_context: Record<string, unknown>;
}

interface AgentbookSessionPayload {
  session_id: string;
  status: string;
  wallet_address: string;
  chain_id: number;
  registry_address: string;
  token_id: string;
  network: string;
  source: string;
  approval_url: string | null;
  connector_uri: string | null;
  deep_link_uri: string | null;
  expires_at: string;
  error_text: string | null;
  frontend_request: AgentbookFrontendRequest | null;
  tx_request: Record<string, unknown> | null;
  trust: AgentbookTrustSummary;
}

interface AgentbookSessionResponse {
  ok: boolean;
  session: AgentbookSessionPayload;
}

interface AgentbookLookupResult {
  wallet_address: string;
  chain_id: number;
  registry_address: string;
  token_id: string;
  connected: boolean;
  world_human_id: string | null;
  unique_agent_count: number;
  connected_at: string | null;
  source: string | null;
}

interface AgentbookLookupResponse {
  ok: boolean;
  result: AgentbookLookupResult;
}

const DEFAULT_PLATFORM_PHX_BASE_URL = "http://127.0.0.1:4000";
const PLATFORM_PHX_BASE_URL_ENV = "PLATFORM_PHX_BASE_URL";
const TERMINAL_SESSION_STATUSES = new Set(["registered", "failed"]);

const platformPhxBaseUrl = (): string =>
  (process.env[PLATFORM_PHX_BASE_URL_ENV] ?? DEFAULT_PLATFORM_PHX_BASE_URL).replace(/\/+$/, "");

const watchInterval = async (seconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
};

const shouldWatch = (args: ParsedCliArgs): boolean => getBooleanFlag(args, "watch");

const parsePlatformError = (text: string, status: number): string => {
  if (!text.trim()) {
    return `Platform request failed (${status}).`;
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const statusMessage = typeof parsed.statusMessage === "string" ? parsed.statusMessage : undefined;
    const errorMessage =
      parsed.error &&
      typeof parsed.error === "object" &&
      typeof (parsed.error as { message?: unknown }).message === "string"
        ? String((parsed.error as { message: string }).message)
        : undefined;

    return statusMessage ?? errorMessage ?? `Platform request failed (${status}).`;
  } catch {
    return text;
  }
};

const requestPlatformJson = async <TResponse>(
  method: "GET" | "POST",
  endpointPath: string,
  input?: { body?: unknown; configPath?: string },
): Promise<TResponse> => {
  const authHeaders = await buildAgentAuthHeaders({
    method,
    path: endpointPath,
    configPath: input?.configPath,
    requireBoundIdentity: true,
  });

  const response = await fetch(`${platformPhxBaseUrl()}${endpointPath}`, {
    method,
    headers: {
      accept: "application/json",
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
      ...authHeaders,
    },
    ...(method === "POST" ? { body: JSON.stringify(input?.body ?? {}) } : {}),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(parsePlatformError(text, response.status));
  }

  return JSON.parse(text) as TResponse;
};

const requireSavedIdentityReceipt = () => {
  const receipt = readIdentityReceipt();

  if (!receipt) {
    throw new Error("This machine does not have a saved Regent identity yet. Run `regents identity ensure` first.");
  }

  if (!receipt.agent_registry || !Number.isFinite(receipt.agent_id)) {
    throw new Error("This command needs a saved Regent identity. Run `regents identity ensure` again.");
  }

  return receipt;
};

const syncWorldTrustFromSession = (session: AgentbookSessionPayload): void => {
  if (
    session.trust.connected !== true ||
    typeof session.trust.world_human_id !== "string" ||
    typeof session.trust.connected_at !== "string" ||
    typeof session.trust.source !== "string"
  ) {
    return;
  }

  const humanId = session.trust.world_human_id;
  const connectedAt = session.trust.connected_at;
  const source = session.trust.source;

  updateIdentityReceipt((receipt) => ({
    ...receipt,
    world: {
      human_id: humanId,
      connected_at: connectedAt,
      source,
      platform_session_id: session.session_id,
    },
  }));
};

const printApprovalHint = (session: AgentbookSessionPayload): void => {
  if (!process.stderr.isTTY) {
    return;
  }

  if (typeof session.approval_url === "string" && session.approval_url !== "") {
    process.stderr.write(
      `${renderPanel("◆ APPROVAL NEEDED", [
        `session ${tone(session.session_id, CLI_PALETTE.primary, true)}`,
        `expires ${tone(session.expires_at, CLI_PALETTE.secondary)}`,
        `open ${tone(session.approval_url, CLI_PALETTE.emphasis, true)}`,
      ], {
        borderColor: CLI_PALETTE.emphasis,
        titleColor: CLI_PALETTE.title,
      })}\n`,
    );
  }
};

export async function runAgentbookRegister(args: ParsedCliArgs, configPath?: string): Promise<void> {
  requireSavedIdentityReceipt();
  requireAgentAuthState(configPath, { requireBoundIdentity: true });

  const payload: CreateAgentbookTrustSessionRequest = {
    source: "regents-cli",
  };

  const created = await requestPlatformJson<AgentbookSessionResponse>("POST", "/api/agentbook/sessions", {
    body: payload,
    configPath,
  });

  const createdSession = created.session;

  if (createdSession) {
    syncWorldTrustFromSession(createdSession);
    printApprovalHint(createdSession);
  }

  if (!shouldWatch(args)) {
    printJson(created);
    return;
  }

  if (!createdSession || typeof createdSession.session_id !== "string") {
    printJson(created);
    return;
  }

  const watched = await watchAgentbookSession(createdSession.session_id, args, configPath);
  const watchedSession = watched.session;

  if (watchedSession) {
    syncWorldTrustFromSession(watchedSession);
  }

  printJson(watched);
}

const watchAgentbookSession = async (
  sessionId: string,
  args: ParsedCliArgs,
  configPath?: string,
): Promise<AgentbookSessionResponse> => {
  const intervalSeconds = parsePollingIntervalSeconds(args);

  for (;;) {
    const payload = await requestPlatformJson<AgentbookSessionResponse>(
      "GET",
      `/api/agentbook/sessions/${encodeURIComponent(sessionId)}`,
      { configPath },
    );

    const session = payload.session;

    if (session) {
      syncWorldTrustFromSession(session);
      const status = typeof session.status === "string" ? session.status : "";
      if (TERMINAL_SESSION_STATUSES.has(status)) {
        return payload;
      }
    }

    await watchInterval(intervalSeconds);
  }
};

export async function runAgentbookSessionsWatch(args: ParsedCliArgs, configPath?: string): Promise<void> {
  requireSavedIdentityReceipt();
  requireAgentAuthState(configPath, { requireBoundIdentity: true });

  const sessionId = requirePositional(args, 3, "session-id");
  printJson(await watchAgentbookSession(sessionId, args, configPath));
}

export async function runAgentbookLookup(_args: ParsedCliArgs, configPath?: string): Promise<void> {
  requireAgentAuthState(configPath, { requireBoundIdentity: true });

  const payload = await requestPlatformJson<AgentbookLookupResponse>("GET", "/api/agentbook/lookup", {
    configPath,
  });

  printJson(payload);
}
