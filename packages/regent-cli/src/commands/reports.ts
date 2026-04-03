import path from "node:path";

import type { paths as RegentServicePaths } from "../generated/regent-services-openapi.js";

import type {
  JsonRequestBodyFor,
  JsonSuccessResponseFor,
} from "../contracts/openapi-helpers.js";
import { loadConfig, StateStore } from "../internal-runtime/index.js";
import { getFlag, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";

type BugReportRequest = JsonRequestBodyFor<
  RegentServicePaths,
  "/api/bug-report",
  "post"
>;
type BugReportResponse = JsonSuccessResponseFor<
  RegentServicePaths,
  "/api/bug-report",
  "post"
>;
type SecurityReportRequest = JsonRequestBodyFor<
  RegentServicePaths,
  "/api/security-report",
  "post"
>;
type SecurityReportResponse = JsonSuccessResponseFor<
  RegentServicePaths,
  "/api/security-report",
  "post"
>;

const DEFAULT_PLATFORM_PHX_BASE_URL = "http://127.0.0.1:4000";
const PLATFORM_PHX_BASE_URL_ENV = "PLATFORM_PHX_BASE_URL";

const platformPhxBaseUrl = (): string =>
  (process.env[PLATFORM_PHX_BASE_URL_ENV] ?? DEFAULT_PLATFORM_PHX_BASE_URL).replace(/\/+$/, "");

const readLocalAgentIdentity = (configPath?: string): NonNullable<BugReportRequest["reporting_agent"]> => {
  const config = loadConfig(configPath);
  const stateFilePath = path.join(config.runtime.stateDir, "runtime-state.json");
  const identity = new StateStore(stateFilePath).read().agent;

  if (
    !identity?.walletAddress ||
    typeof identity.chainId !== "number" ||
    !identity.registryAddress ||
    !identity.tokenId
  ) {
    throw new Error(
      "This machine does not have a saved Regent agent identity yet. Run `regent techtree start` or sign in with `regent auth siwa login --registry-address ... --token-id ...` first.",
    );
  }

  return {
    wallet_address: identity.walletAddress,
    chain_id: identity.chainId,
    registry_address: identity.registryAddress,
    token_id: identity.tokenId,
    ...(identity.label ? { label: identity.label } : {}),
  };
};

const requireTextFlag = (
  args: ParsedCliArgs,
  flag: string,
  errorMessage: string,
): string => {
  const value = getFlag(args, flag);
  if (value === undefined || value.trim() === "") {
    throw new Error(errorMessage);
  }

  return value;
};

const parsePlatformError = (text: string, status: number): string => {
  if (!text.trim()) {
    return `Platform server request failed (${status}).`;
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

    return statusMessage ?? errorMessage ?? `Platform server request failed (${status}).`;
  } catch {
    return text;
  }
};

const requestPlatformJson = async <TResponse>(
  endpointPath: string,
  body: unknown,
): Promise<TResponse> => {
  const response = await fetch(`${platformPhxBaseUrl()}${endpointPath}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(parsePlatformError(text, response.status));
  }

  return JSON.parse(text) as TResponse;
};

export async function runBugReport(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const summary = requireTextFlag(
    args,
    "summary",
    'Bug reports need a non-empty --summary. Example: regent bug --summary "can\'t do xyz" --details "any more details here".',
  );
  const details = requireTextFlag(
    args,
    "details",
    'Bug reports need a non-empty --details. Example: regent bug --summary "can\'t do xyz" --details "any more details here".',
  );

  const payload: BugReportRequest = {
    summary,
    details,
    reporting_agent: readLocalAgentIdentity(configPath),
  };

  printJson(await requestPlatformJson<BugReportResponse>("/api/bug-report", payload));
}

export async function runSecurityReport(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const summary = requireTextFlag(
    args,
    "summary",
    'Security reports need a non-empty --summary. Example: regent security-report --summary "private vuln" --details "steps and impact" --contact "@xyz on telegram".',
  );
  const details = requireTextFlag(
    args,
    "details",
    'Security reports need a non-empty --details. Example: regent security-report --summary "private vuln" --details "steps and impact" --contact "@xyz on telegram".',
  );
  const contact = requireTextFlag(
    args,
    "contact",
    'Security reports need a non-empty --contact. Example: regent security-report --summary "private vuln" --details "steps and impact" --contact "@xyz on telegram".',
  );

  const payload: SecurityReportRequest = {
    summary,
    details,
    contact,
    reporting_agent: readLocalAgentIdentity(configPath),
  };

  printJson(await requestPlatformJson<SecurityReportResponse>("/api/security-report", payload));
}
