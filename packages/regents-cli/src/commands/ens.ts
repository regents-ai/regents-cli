import { loadConfig } from "../internal-runtime/config.js";
import { getFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";
import { buildAgentAuthHeaders } from "./agent-auth.js";
import {
  extractPreparedTxRequest,
  submitPreparedTxRequest,
  type JsonObject,
} from "./autolaunch/shared.js";

const requestPlatformJson = async (
  method: string,
  path: string,
  body: Record<string, unknown>,
  configPath?: string,
): Promise<JsonObject> => {
  const config = loadConfig(configPath);
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
  });

  const authHeaders = await buildAgentAuthHeaders({
    method,
    path,
    configPath,
  });

  for (const [key, value] of Object.entries(authHeaders)) {
    headers.set(key, value);
  }

  const response = await fetch(`${config.auth.baseUrl.replace(/\/+$/u, "")}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as JsonObject) : {};

  if (!response.ok) {
    throw new Error(JSON.stringify(parsed, null, 2));
  }

  return parsed;
};
export async function runEnsSetPrimary(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const ensName = requireArg(getFlag(args, "ens"), "ens");
  const payload = await requestPlatformJson(
    "POST",
    "/api/agent-platform/ens/prepare-primary",
    { ens_name: ensName },
    configPath,
  );

  const prepared =
    payload.prepared && typeof payload.prepared === "object"
      ? (payload.prepared as JsonObject)
      : null;
  const txRequest = extractPreparedTxRequest(prepared?.tx_request);

  if (!txRequest) {
    printJson(payload);
    return;
  }

  const txHash = await submitPreparedTxRequest(txRequest, configPath);
  printJson({ ...payload, submitted: true, tx_hash: txHash });
}
