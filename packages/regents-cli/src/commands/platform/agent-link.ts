import { writeHermesRegentsWorkConnector } from "../../agents/hermes/connect.js";
import { writeOpenClawRegentsWorkSkill } from "../../agents/openclaw/connect.js";
import { loadConfig } from "../../internal-runtime/index.js";
import { productBaseUrl } from "../../internal-runtime/product-http-client.js";
import { getFlag, requireArg, type ParsedCliArgs } from "../../parse.js";
import {
  printAgentConnectHermesResult,
  printAgentConnectOpenClawResult,
  printAgentExecutionPoolResult,
  printAgentLinkResult,
} from "../rwr-presenters.js";
import {
  loadResolvedPlatformSession,
  requestPlatformSessionJson,
} from "../platform.js";
import { requestProductJson } from "../product-http.js";

type JsonObject = Record<string, unknown>;

const companyId = (args: ParsedCliArgs): string => requireArg(getFlag(args, "company-id"), "company-id");

const relationshipMember = (
  args: ParsedCliArgs,
  input: { agentFlag: string; workerFlag: string; label: string },
): { agentId?: string; workerId?: string; routeId: string } => {
  const agentId = getFlag(args, input.agentFlag);
  const workerId = getFlag(args, input.workerFlag);

  if (agentId && workerId) {
    throw new Error(`use either --${input.agentFlag} or --${input.workerFlag} for the ${input.label}, not both`);
  }

  if (!agentId && !workerId) {
    throw new Error(`missing ${input.label}: pass --${input.agentFlag} or --${input.workerFlag}`);
  }

  return {
    ...(agentId ? { agentId } : {}),
    ...(workerId ? { workerId } : {}),
    routeId: agentId ?? workerId ?? "",
  };
};

const writeSkillEnabled = (args: ParsedCliArgs): boolean => {
  const value = getFlag(args, "write-skill");
  return value === undefined || value === "true" || value === "1" || value === "yes";
};

const writeConnectorEnabled = (args: ParsedCliArgs): boolean => {
  const value = getFlag(args, "write-connector");
  return value === undefined || value === "true" || value === "1" || value === "yes";
};

const registeredWorkerId = (data: JsonObject): string => {
  const worker = data.worker;

  if (!worker || typeof worker !== "object" || Array.isArray(worker)) {
    throw new Error("Platform did not return a connected worker.");
  }

  const id = (worker as JsonObject).id;

  if (typeof id !== "string" && typeof id !== "number") {
    throw new Error("Platform did not return a worker id.");
  }

  return String(id);
};

const requestAgentPlatformJson = async (
  configPath: string | undefined,
  input: { method: "GET" | "POST"; path: string; body?: JsonObject },
): Promise<{ origin: string; data: JsonObject }> => {
  const data = await requestProductJson<JsonObject>(input.method, input.path, {
    body: input.body,
    configPath,
    requireAgentAuth: true,
    authAudience: "platform",
    service: "platform",
    commandName: "regents agent platform",
  });

  return { origin: productBaseUrl(loadConfig(configPath), "platform"), data };
};

export async function runAgentConnectHermes(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const resolvedCompanyId = companyId(args);
  const role = requireArg(getFlag(args, "role"), "role");
  const displayName = getFlag(args, "name") ?? "Hermes local worker";
  const { origin, data } = await requestAgentPlatformJson(configPath, {
    method: "POST",
    path: `/api/agent-platform/companies/${encodeURIComponent(resolvedCompanyId)}/rwr/workers`,
    body: {
      company_id: resolvedCompanyId,
      agent_kind: "hermes",
      worker_role: role,
      execution_surface: "local_bridge",
      runner_kind: "hermes_local_manager",
      billing_mode: "user_local",
      trust_scope: "local_user_controlled",
      reported_usage_policy: "self_reported",
      display_name: displayName,
      endpoint_url: null,
    },
  });
  const connector = writeConnectorEnabled(args)
    ? await writeHermesRegentsWorkConnector({
        companyId: resolvedCompanyId,
        workerId: registeredWorkerId(data),
        workerName: displayName,
      })
    : null;

  printAgentConnectHermesResult(args, {
    ok: true,
    command: "regents agent connect hermes",
    origin,
    result: data,
    hermes: {
      configFile: connector?.configPath ?? null,
      skillFile: connector?.skillPath ?? null,
    },
  });
}

export async function runAgentConnectOpenClaw(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const resolvedCompanyId = companyId(args);
  const role = requireArg(getFlag(args, "role"), "role");
  const displayName = getFlag(args, "name") ?? "OpenClaw local worker";
  const runnerKind = role === "manager" ? "openclaw_local_manager" : "openclaw_local_executor";
  const { origin, data } = await requestAgentPlatformJson(configPath, {
    method: "POST",
    path: `/api/agent-platform/companies/${encodeURIComponent(resolvedCompanyId)}/rwr/workers`,
    body: {
      company_id: resolvedCompanyId,
      agent_kind: "openclaw",
      worker_role: role,
      execution_surface: "local_bridge",
      runner_kind: runnerKind,
      billing_mode: "user_local",
      trust_scope: "local_user_controlled",
      reported_usage_policy: "self_reported",
      display_name: displayName,
      endpoint_url: null,
    },
  });
  const skill = writeSkillEnabled(args)
    ? await writeOpenClawRegentsWorkSkill({
        companyId: resolvedCompanyId,
        workerId: registeredWorkerId(data),
        workerName: displayName,
      })
    : null;

  printAgentConnectOpenClawResult(args, {
    ok: true,
    command: "regents agent connect openclaw",
    origin,
    result: data,
    openclaw: {
      skillFile: skill?.skillPath ?? null,
    },
  });
}

export async function runAgentLink(args: ParsedCliArgs): Promise<void> {
  const resolvedCompanyId = companyId(args);
  const manager = relationshipMember(args, {
    agentFlag: "manager-agent-id",
    workerFlag: "manager-worker-id",
    label: "manager",
  });
  const executor = relationshipMember(args, {
    agentFlag: "executor-agent-id",
    workerFlag: "executor-worker-id",
    label: "executor",
  });
  const relationship = requireArg(getFlag(args, "relationship"), "relationship");
  const { origin, session } = await loadResolvedPlatformSession(args);
  const { data } = await requestPlatformSessionJson({
    origin,
    session,
    method: "POST",
    path: `/api/agent-platform/companies/${encodeURIComponent(resolvedCompanyId)}/rwr/agents/${encodeURIComponent(manager.routeId)}/relationships`,
    body: {
      company_id: resolvedCompanyId,
      ...(manager.agentId ? { source_agent_profile_id: manager.agentId } : {}),
      ...(manager.workerId ? { source_worker_id: manager.workerId } : {}),
      ...(executor.agentId ? { target_agent_profile_id: executor.agentId } : {}),
      ...(executor.workerId ? { target_worker_id: executor.workerId } : {}),
      relationship_kind: relationship,
      status: "active",
    },
  });

  printAgentLinkResult(args, { ok: true, command: "regents agent link", origin, result: data });
}

export async function runAgentExecutionPool(args: ParsedCliArgs): Promise<void> {
  const resolvedCompanyId = companyId(args);
  const manager = requireArg(getFlag(args, "manager"), "manager");
  const { origin, session } = await loadResolvedPlatformSession(args);
  const { data } = await requestPlatformSessionJson({
    origin,
    session,
    method: "GET",
    path: `/api/agent-platform/companies/${encodeURIComponent(resolvedCompanyId)}/rwr/agents/${encodeURIComponent(manager)}/execution-pool`,
  });

  printAgentExecutionPoolResult(args, { ok: true, command: "regents agent execution-pool", origin, result: data });
}
