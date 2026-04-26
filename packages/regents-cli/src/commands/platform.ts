import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { expandHome } from "../internal-runtime/index.js";
import { getFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";

const DEFAULT_ORIGIN = "https://regents.sh";
const DEFAULT_IDENTITY_TOKEN_ENV = "REGENT_PLATFORM_IDENTITY_TOKEN";
const DEFAULT_SESSION_FILE = path.join(os.homedir(), ".regent", "platform", "session.json");

type HttpMethod = "GET" | "POST" | "DELETE";
type JsonObject = Record<string, unknown>;

interface PlatformSessionState {
  readonly version: 1;
  readonly origin: string;
  readonly cookie: string;
  readonly csrfToken: string;
  readonly savedAt: string;
}

interface RequestOptions {
  readonly origin: string;
  readonly path: string;
  readonly method: HttpMethod;
  readonly session: PlatformSessionState;
  readonly body?: JsonObject;
  readonly authorization?: string;
}

export async function runPlatformAuthLogin(args: ParsedCliArgs): Promise<void> {
  const origin = resolveOrigin(args);
  const sessionFile = resolveSessionFile(args);
  const identityToken = resolveIdentityToken(args);
  const displayName = getFlag(args, "display-name");
  const bootstrap = await bootstrapCsrf(origin);
  const { data, session } = await requestJson({
    origin,
    path: "/api/auth/privy/session",
    method: "POST",
    session: bootstrap,
    authorization: `Bearer ${identityToken}`,
    body: displayName ? { display_name: displayName } : {},
  });

  await saveSession(sessionFile, session);

  printJson({
    ok: true,
    command: "regents platform auth login",
    origin,
    sessionFile,
    profile: data,
  });
}

export async function runPlatformAuthStatus(args: ParsedCliArgs): Promise<void> {
  const { origin, session, sessionFile } = await loadResolvedSession(args);
  const { data } = await requestJson({
    origin,
    path: "/api/auth/privy/profile",
    method: "GET",
    session,
  });

  printJson({
    ok: true,
    command: "regents platform auth status",
    origin,
    sessionFile,
    profile: data,
  });
}

export async function runPlatformAuthLogout(args: ParsedCliArgs): Promise<void> {
  const { origin, session, sessionFile } = await loadResolvedSession(args);
  await requestJson({
    origin,
    path: "/api/auth/privy/session",
    method: "DELETE",
    session,
  });
  await rm(sessionFile, { force: true });

  printJson({
    ok: true,
    command: "regents platform auth logout",
    origin,
    sessionFile,
  });
}

export async function runPlatformFormationStatus(args: ParsedCliArgs): Promise<void> {
  const { origin, session } = await loadResolvedSession(args);
  const { data } = await requestJson({
    origin,
    path: "/api/agent-platform/formation",
    method: "GET",
    session,
  });

  printJson({
    ok: true,
    command: "regents platform formation status",
    origin,
    formation: data,
  });
}

export async function runPlatformBillingAccount(args: ParsedCliArgs): Promise<void> {
  const { origin, session } = await loadResolvedSession(args);
  const { data } = await requestJson({
    origin,
    path: "/api/agent-platform/billing/account",
    method: "GET",
    session,
  });

  printJson({
    ok: true,
    command: "regents platform billing account",
    origin,
    billing: data,
  });
}

export async function runPlatformBillingUsage(args: ParsedCliArgs): Promise<void> {
  const { origin, session } = await loadResolvedSession(args);
  const { data } = await requestJson({
    origin,
    path: "/api/agent-platform/billing/usage",
    method: "GET",
    session,
  });

  printJson({
    ok: true,
    command: "regents platform billing usage",
    origin,
    usage: data,
  });
}

export async function runPlatformCompanyRuntime(args: ParsedCliArgs): Promise<void> {
  const slug = requireArg(getFlag(args, "slug"), "slug");
  const { origin, session } = await loadResolvedSession(args);
  const { data } = await requestJson({
    origin,
    path: `/api/agent-platform/agents/${encodeURIComponent(slug)}/runtime`,
    method: "GET",
    session,
  });

  printJson({
    ok: true,
    command: "regents platform company runtime",
    origin,
    runtime: data,
  });
}

export function printPlatformUnavailable(command: string): void {
  printJson({
    ok: false,
    command,
    status: "unavailable",
    statusMessage:
      "This action is not open during the public beta. Regent staking is live now, and hosted company controls will reopen after the beta checks pass.",
  });
}

const resolveOrigin = (args: ParsedCliArgs): string =>
  normalizeOrigin(getFlag(args, "origin") ?? process.env.REGENT_PLATFORM_ORIGIN ?? DEFAULT_ORIGIN);

const resolveOptionalOrigin = (args: ParsedCliArgs): string | null => {
  const raw = getFlag(args, "origin") ?? process.env.REGENT_PLATFORM_ORIGIN;
  return raw ? normalizeOrigin(raw) : null;
};

const resolveSessionFile = (args: ParsedCliArgs): string =>
  path.resolve(expandHome(getFlag(args, "session-file") ?? DEFAULT_SESSION_FILE));

const resolveIdentityToken = (args: ParsedCliArgs): string => {
  const explicit = getFlag(args, "identity-token");
  if (explicit) {
    return explicit;
  }

  const envName = getFlag(args, "identity-token-env") ?? DEFAULT_IDENTITY_TOKEN_ENV;
  const fromEnv = process.env[envName];
  if (!fromEnv) {
    throw new Error(`Provide --identity-token, --identity-token-env, or set ${DEFAULT_IDENTITY_TOKEN_ENV}.`);
  }

  return fromEnv;
};

const bootstrapCsrf = async (origin: string): Promise<PlatformSessionState> => {
  const response = await fetch(`${origin}/api/auth/privy/csrf`, {
    headers: { accept: "application/json" },
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(data, response.status));
  }

  const csrfToken = typeof data.csrf_token === "string" ? data.csrf_token : null;
  const cookie = readCookieHeader(response);
  if (!csrfToken || !cookie) {
    throw new Error("Platform sign-in did not return a usable session.");
  }

  return {
    version: 1,
    origin,
    cookie,
    csrfToken,
    savedAt: new Date().toISOString(),
  };
};

const requestJson = async (options: RequestOptions): Promise<{ data: JsonObject; session: PlatformSessionState }> => {
  const headers = new Headers({
    accept: "application/json",
    cookie: options.session.cookie,
  });

  if (options.authorization) {
    headers.set("authorization", options.authorization);
  }

  if (options.method !== "GET") {
    headers.set("content-type", "application/json");
    headers.set("x-csrf-token", options.session.csrfToken);
  }

  const response = await fetch(`${options.origin}${options.path}`, {
    method: options.method,
    headers,
    body: options.method === "GET" ? undefined : JSON.stringify(options.body ?? {}),
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(data, response.status));
  }

  return {
    data,
    session: {
      ...options.session,
      cookie: readCookieHeader(response) ?? options.session.cookie,
      savedAt: new Date().toISOString(),
    },
  };
};

const loadResolvedSession = async (
  args: ParsedCliArgs,
): Promise<{ origin: string; session: PlatformSessionState; sessionFile: string }> => {
  const sessionFile = resolveSessionFile(args);
  const session = await loadSession(sessionFile);
  const explicitOrigin = resolveOptionalOrigin(args);
  if (explicitOrigin && explicitOrigin !== session.origin) {
    throw new Error(`Saved platform session belongs to ${session.origin}. Use a matching --origin or sign in again.`);
  }

  const origin = explicitOrigin ?? session.origin;
  return { origin, session, sessionFile };
};

const loadSession = async (sessionFile: string): Promise<PlatformSessionState> => {
  let raw: string;
  try {
    raw = await readFile(sessionFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`No saved platform session found at ${sessionFile}. Run regents platform auth login first.`);
    }
    throw error;
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!isPlatformSessionState(parsed)) {
    throw new Error(`Saved platform session at ${sessionFile} is not usable.`);
  }

  return parsed;
};

const saveSession = async (sessionFile: string, session: PlatformSessionState): Promise<void> => {
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await writeFile(sessionFile, `${JSON.stringify(session, null, 2)}\n`, "utf8");
};

const isPlatformSessionState = (value: unknown): value is PlatformSessionState => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as Record<string, unknown>;
  return (
    session.version === 1 &&
    typeof session.origin === "string" &&
    typeof session.cookie === "string" &&
    typeof session.csrfToken === "string" &&
    typeof session.savedAt === "string"
  );
};

const parseJsonResponse = async (response: Response): Promise<JsonObject> => {
  const text = await response.text();
  if (text === "") {
    return {};
  }

  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Platform returned a non-object response with status ${response.status}.`);
  }

  return parsed as JsonObject;
};

const extractErrorMessage = (data: JsonObject, status: number): string => {
  for (const key of ["statusMessage", "message", "error"]) {
    const value = data[key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }

  return `Platform request failed with status ${status}.`;
};

const readCookieHeader = (response: Response): string | null => {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = [
    ...(typeof headers.getSetCookie === "function" ? headers.getSetCookie() : []),
    response.headers.get("set-cookie"),
  ];

  const cookies = Array.from(new Set(setCookies
    .filter((cookie): cookie is string => typeof cookie === "string" && cookie !== "")
    .map((cookie) => cookie.split(";", 1)[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie))));

  return cookies.length > 0 ? cookies.join("; ") : null;
};

const normalizeOrigin = (origin: string): string => origin.replace(/\/+$/u, "");
