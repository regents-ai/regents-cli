import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

import { loadConfig } from "../../internal-runtime/config.js";
import { ensureSecureDir, writeJsonFileAtomicSync } from "../../internal-runtime/paths.js";
import {
  FileWalletSecretSource,
  EnvWalletSecretSource,
} from "../../internal-runtime/agent/key-store.js";
import {
  deriveWalletAddress,
  signPersonalMessage,
} from "../../internal-runtime/agent/wallet.js";
import { SiwaClient } from "../../internal-runtime/siwa/siwa.js";
import {
  getFlag,
  getBooleanFlag,
  requireArg,
  type ParsedCliArgs,
} from "../../parse.js";
import {
  CLI_PALETTE,
  isHumanTerminal,
  printJson,
  printText,
  renderPanel,
  tone,
} from "../../printer.js";
import { requireAgentAuthState } from "../agent-auth.js";
import {
  extractPreparedTxRequest,
  parsePollingIntervalSeconds,
  requestJson,
  submitPreparedTxRequest,
} from "./shared.js";

interface LocalPlanRecord {
  readonly plan_id: string;
  readonly saved_at: string;
  readonly remote_plan: Record<string, unknown>;
}

const PRELAUNCH_DIR = "autolaunch-plans";
const AUTOLAUNCH_CHAIN_ID = 84_532;

const normalizeText = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const stateDir = (configPath?: string): string =>
  loadConfig(configPath).runtime.stateDir;

const planDir = (configPath?: string): string => {
  const resolved = path.join(stateDir(configPath), PRELAUNCH_DIR);
  ensureSecureDir(resolved);
  return resolved;
};

const planPath = (planId: string, configPath?: string): string =>
  path.join(planDir(configPath), `${planId}.json`);

const saveLocalPlan = (
  plan: Record<string, unknown>,
  configPath?: string,
): LocalPlanRecord => {
  const planId = String(plan.plan_id ?? "");
  if (!planId) {
    throw new Error("remote plan payload is missing plan_id");
  }

  const record: LocalPlanRecord = {
    plan_id: planId,
    saved_at: new Date().toISOString(),
    remote_plan: plan,
  };

  writeJsonFileAtomicSync(planPath(planId, configPath), record);
  return record;
};

const loadLocalPlan = (
  planId: string,
  configPath?: string,
): LocalPlanRecord => {
  const raw = fs.readFileSync(planPath(planId, configPath), "utf8");
  return JSON.parse(raw) as LocalPlanRecord;
};

const latestLocalPlan = (configPath?: string): LocalPlanRecord | null => {
  const dir = planDir(configPath);
  const files = fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dir, entry))
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

  if (files.length === 0) {
    return null;
  }

  return JSON.parse(
    fs.readFileSync(files[0]!.filePath, "utf8"),
  ) as LocalPlanRecord;
};

const resolvePlanId = (args: ParsedCliArgs, configPath?: string): string => {
  const explicit = getFlag(args, "plan");
  if (explicit) {
    return explicit;
  }

  const latest = latestLocalPlan(configPath);
  if (!latest) {
    throw new Error(
      "no local autolaunch plan found; run `regents autolaunch prelaunch wizard` first",
    );
  }

  return latest.plan_id;
};

const prompt = async (label: string, fallback?: string): Promise<string> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const suffix = fallback ? ` [${fallback}]` : "";
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    return answer || fallback || "";
  } finally {
    rl.close();
  }
};

const configuredPrivateKey = async (
  configPath?: string,
): Promise<`0x${string}`> => {
  const config = loadConfig(configPath);
  const secretSource = process.env[config.wallet.privateKeyEnv]
    ? new EnvWalletSecretSource(config.wallet.privateKeyEnv)
    : new FileWalletSecretSource(config.wallet.keystorePath);

  return await secretSource.getPrivateKeyHex();
};

const resolveWalletAddress = async (
  args: ParsedCliArgs,
  plan: Record<string, unknown>,
  configPath?: string,
): Promise<`0x${string}`> => {
  const explicit = normalizeText(getFlag(args, "wallet-address"));
  if (explicit) {
    return explicit as `0x${string}`;
  }

  const fallbackWallet = normalizeText(
    plan.fallback_operator_wallet as string | undefined,
  );
  if (fallbackWallet) {
    return fallbackWallet as `0x${string}`;
  }

  return await deriveWalletAddress(await configuredPrivateKey(configPath));
};

const readImageInput = async (
  args: ParsedCliArgs,
): Promise<{
  image_url?: string;
  image_file_name?: string;
  image_file_base64?: string;
  image_media_type?: string;
}> => {
  const imageUrl = normalizeText(getFlag(args, "image-url"));
  if (imageUrl) {
    return { image_url: imageUrl };
  }

  const imageFile = normalizeText(getFlag(args, "image-file"));
  if (!imageFile) {
    return {};
  }

  const filePath = path.resolve(imageFile);
  const bytes = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const mediaType = filePath.endsWith(".png")
    ? "image/png"
    : filePath.endsWith(".webp")
      ? "image/webp"
      : filePath.endsWith(".gif")
        ? "image/gif"
        : "image/jpeg";

  return {
    image_file_name: fileName,
    image_file_base64: bytes.toString("base64"),
    image_media_type: mediaType,
  };
};

const uploadImageIfNeeded = async (
  args: ParsedCliArgs,
  configPath?: string,
): Promise<{ image_url?: string; image_asset_id?: string }> => {
  const image = await readImageInput(args);
  if (image.image_url) {
    const payload = await requestJson("POST", "/v1/agent/prelaunch/assets", {
      body: { source_url: image.image_url },
      requireAgentAuth: true,
    });

    const asset = payload.asset as Record<string, unknown> | undefined;
    return {
      image_url: String(asset?.public_url ?? image.image_url),
      image_asset_id:
        typeof asset?.asset_id === "string" ? asset.asset_id : undefined,
    };
  }

  if (
    image.image_file_base64 &&
    image.image_file_name &&
    image.image_media_type
  ) {
    const payload = await requestJson("POST", "/v1/agent/prelaunch/assets", {
      body: {
        file_name: image.image_file_name,
        media_type: image.image_media_type,
        content_base64: image.image_file_base64,
      },
      requireAgentAuth: true,
    });

    const asset = payload.asset as Record<string, unknown> | undefined;
    return {
      image_url:
        typeof asset?.public_url === "string" ? asset.public_url : undefined,
      image_asset_id:
        typeof asset?.asset_id === "string" ? asset.asset_id : undefined,
    };
  }

  return {};
};

const createOrUpdateRemotePlan = async (
  args: ParsedCliArgs,
  configPath?: string,
): Promise<Record<string, unknown>> => {
  const agentId =
    normalizeText(getFlag(args, "agent")) ||
    (isHumanTerminal() ? await prompt("Agent id") : undefined);
  const tokenName =
    normalizeText(getFlag(args, "name")) ||
    (isHumanTerminal() ? await prompt("Token name") : undefined);
  const tokenSymbol =
    normalizeText(getFlag(args, "symbol")) ||
    (isHumanTerminal() ? await prompt("Token symbol") : undefined);
  const minimumRaiseUsdc =
    normalizeText(getFlag(args, "minimum-raise-usdc")) ||
    (isHumanTerminal() ? await prompt("Minimum USDC raise") : undefined);
  const agentSafe =
    normalizeText(getFlag(args, "agent-safe-address")) ||
    (isHumanTerminal()
      ? await prompt("Agent Safe (leave blank if you still need to create it)")
      : undefined);
  const fallbackWallet =
    normalizeText(getFlag(args, "fallback-operator-wallet")) ||
    (isHumanTerminal()
      ? await prompt("Fallback operator wallet (optional)")
      : undefined);
  const launchNotes =
    normalizeText(getFlag(args, "launch-notes")) ||
    (isHumanTerminal() ? await prompt("Launch notes (optional)") : undefined);
  const title =
    normalizeText(getFlag(args, "title")) ||
    (isHumanTerminal()
      ? await prompt("Hosted page title", tokenName)
      : tokenName);
  const subtitle =
    normalizeText(getFlag(args, "subtitle")) ||
    (isHumanTerminal()
      ? await prompt("Hosted page subtitle", "CCA launch draft")
      : undefined);
  const description =
    normalizeText(getFlag(args, "description")) ||
    (isHumanTerminal() ? await prompt("Hosted page description") : undefined);
  const websiteUrl =
    normalizeText(getFlag(args, "website-url")) ||
    (isHumanTerminal() ? await prompt("Website URL (optional)") : undefined);

  const payload = {
    agent_id: requireArg(agentId, "agent"),
    token_name: requireArg(tokenName, "name"),
    token_symbol: requireArg(tokenSymbol, "symbol"),
    minimum_raise_usdc: requireArg(minimumRaiseUsdc, "minimum-raise-usdc"),
    agent_safe_address:
      agentSafe ||
      (() => {
        throw new Error(
          "Agent Safe is required. Run `regents autolaunch safe wizard` first, then rerun with --agent-safe-address <safe>.",
        );
      })(),
    fallback_operator_wallet: fallbackWallet,
    launch_notes: launchNotes,
    metadata_draft: {
      title,
      subtitle,
      description,
      website_url: websiteUrl,
    },
  };

  const planId = normalizeText(getFlag(args, "plan"));
  const response = planId
    ? await requestJson(
        "PATCH",
        `/v1/agent/prelaunch/plans/${encodeURIComponent(planId)}`,
        {
          body: payload,
          requireAgentAuth: true,
          configPath,
        },
      )
    : await requestJson("POST", "/v1/agent/prelaunch/plans", {
        body: payload,
        requireAgentAuth: true,
        configPath,
      });

  let plan = response.plan as Record<string, unknown>;
  const uploaded = await uploadImageIfNeeded(args, configPath);
  if (uploaded.image_url || uploaded.image_asset_id) {
    const metadataResponse = await requestJson(
      "POST",
      `/v1/agent/prelaunch/plans/${encodeURIComponent(String(plan.plan_id))}/metadata`,
      {
        body: {
          metadata: {
            ...(plan.metadata_draft as Record<string, unknown> | undefined),
            title,
            subtitle,
            description,
            website_url: websiteUrl,
            image_url: uploaded.image_url,
            image_asset_id: uploaded.image_asset_id,
          },
        },
        requireAgentAuth: true,
        configPath,
      },
    );

    plan = metadataResponse.plan as Record<string, unknown>;
  }

  saveLocalPlan(plan, configPath);
  return plan;
};

const requestSiwaLaunchBundle = async (
  walletAddress: `0x${string}`,
  configPath?: string,
) => {
  const { identity } = requireAgentAuthState(configPath, {
    audience: "autolaunch",
  });
  const config = loadConfig(configPath);
  const privateKey = await configuredPrivateKey(configPath);
  const derivedAddress = await deriveWalletAddress(privateKey);
  if (derivedAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error(
      `wallet mismatch: config signer ${derivedAddress} does not match ${walletAddress}`,
    );
  }

  if (identity.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error(
      `wallet mismatch: saved Regent identity ${identity.walletAddress} does not match ${walletAddress}`,
    );
  }

  if (!identity.registryAddress || !identity.tokenId) {
    throw new Error("This launch needs a bound Regent identity. Run `regents identity ensure` again.");
  }

  const siwaClient = new SiwaClient(config.services.siwa.baseUrl, config.services.siwa.requestTimeoutMs, config);
  const noncePayload = await siwaClient.requestNonce({
    wallet_address: walletAddress,
    chain_id: AUTOLAUNCH_CHAIN_ID,
    registry_address: identity.registryAddress,
    token_id: identity.tokenId,
    audience: "autolaunch",
  });
  const nonce = noncePayload.data.nonce;
  const issuedAt = new Date().toISOString();
  const message = SiwaClient.defaultMessageInput({
    walletAddress,
    chainId: AUTOLAUNCH_CHAIN_ID,
    registryAddress: identity.registryAddress,
    tokenId: identity.tokenId,
    nonce,
    issuedAt,
    statement: "Authorize an Autolaunch launch.",
  });
  const signature = await signPersonalMessage(privateKey, message);

  return {
    wallet_address: walletAddress,
    registry_address: identity.registryAddress,
    token_id: identity.tokenId,
    nonce,
    message,
    signature,
    issued_at: issuedAt,
  };
};

const watchJobOnce = async (
  jobId: string,
  configPath?: string,
): Promise<Record<string, unknown>> =>
  requestJson("GET", `/v1/agent/launch/jobs/${encodeURIComponent(jobId)}`, {
    requireAgentAuth: true,
    configPath,
  });

const renderWorkflowPanel = (title: string, lines: string[]): void => {
  if (!isHumanTerminal()) {
    return;
  }

  printText(
    renderPanel(title, lines, {
      borderColor: CLI_PALETTE.chrome,
      titleColor: CLI_PALETTE.title,
    }),
  );
};

export async function runAutolaunchPrelaunchWizard(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const plan = await createOrUpdateRemotePlan(args, configPath);
  const validation = await requestJson(
    "POST",
    `/v1/agent/prelaunch/plans/${encodeURIComponent(String(plan.plan_id))}/validate`,
    { body: {}, requireAgentAuth: true, configPath },
  );

  saveLocalPlan(validation.plan as Record<string, unknown>, configPath);

  renderWorkflowPanel("◆ AUTOLAUNCH PRELAUNCH", [
    tone("saved locally", CLI_PALETTE.secondary),
    `${tone("plan", CLI_PALETTE.accent, true)} ${String(plan.plan_id)}`,
    `${tone("agent", CLI_PALETTE.secondary)} ${String((plan.identity_snapshot as Record<string, unknown> | undefined)?.agent_id ?? plan.agent_id)}`,
    `${tone("launchable", CLI_PALETTE.secondary)} ${String((validation.validation as Record<string, unknown> | undefined)?.launchable ?? false)}`,
  ]);

  printJson(validation);
}

export async function runAutolaunchPrelaunchShow(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const planId = resolvePlanId(args, configPath);
  const payload = await requestJson(
    "GET",
    `/v1/agent/prelaunch/plans/${encodeURIComponent(planId)}`,
    {
      requireAgentAuth: true,
      configPath,
    },
  );
  saveLocalPlan(payload.plan as Record<string, unknown>, configPath);
  printJson(payload);
}

export async function runAutolaunchPrelaunchValidate(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const planId = resolvePlanId(args, configPath);
  const payload = await requestJson(
    "POST",
    `/v1/agent/prelaunch/plans/${encodeURIComponent(planId)}/validate`,
    { body: {}, requireAgentAuth: true, configPath },
  );
  saveLocalPlan(payload.plan as Record<string, unknown>, configPath);
  printJson(payload);
}

export async function runAutolaunchPrelaunchPublish(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const planId = resolvePlanId(args, configPath);
  const payload = await requestJson(
    "POST",
    `/v1/agent/prelaunch/plans/${encodeURIComponent(planId)}/publish`,
    { body: {}, requireAgentAuth: true, configPath },
  );
  saveLocalPlan(payload.plan as Record<string, unknown>, configPath);
  printJson(payload);
}

export async function runAutolaunchLaunchRun(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const planId = resolvePlanId(args, configPath);
  const planPayload = await requestJson(
    "GET",
    `/v1/agent/prelaunch/plans/${encodeURIComponent(planId)}`,
    { requireAgentAuth: true, configPath },
  );
  const plan = planPayload.plan as Record<string, unknown>;
  const validationPayload = await requestJson(
    "POST",
    `/v1/agent/prelaunch/plans/${encodeURIComponent(planId)}/validate`,
    { body: {}, requireAgentAuth: true, configPath },
  );

  const validation = validationPayload.validation as
    | Record<string, unknown>
    | undefined;
  if (!validation?.launchable) {
    saveLocalPlan(
      validationPayload.plan as Record<string, unknown>,
      configPath,
    );
    printJson(validationPayload);
    return;
  }

  const walletAddress = await resolveWalletAddress(args, plan, configPath);
  const siwaBundle = await requestSiwaLaunchBundle(walletAddress, configPath);

  const payload = await requestJson(
    "POST",
    `/v1/agent/prelaunch/plans/${encodeURIComponent(planId)}/launch`,
    { body: siwaBundle, requireAgentAuth: true, configPath },
  );

  saveLocalPlan(payload.plan as Record<string, unknown>, configPath);

  const jobId = String(
    (payload.launch as Record<string, unknown>).job_id ?? "",
  );
  if (!jobId) {
    printJson(payload);
    return;
  }

  let current = await watchJobOnce(jobId, configPath);
  printJson(current);

  const shouldWatch = isHumanTerminal() || getBooleanFlag(args, "watch");
  if (!shouldWatch) {
    return;
  }

  const intervalSeconds = parsePollingIntervalSeconds(args);
  for (;;) {
    const job = current.job as Record<string, unknown> | undefined;
    const status = typeof job?.status === "string" ? job.status : "";
    if (["ready", "failed", "blocked"].includes(status)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
    current = await watchJobOnce(jobId, configPath);
    printJson(current);
  }
}

export async function runAutolaunchLaunchMonitor(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const jobId = requireArg(getFlag(args, "job"), "job");
  const watch = getBooleanFlag(args, "watch");
  const intervalSeconds = parsePollingIntervalSeconds(args);

  for (;;) {
    const payload = await requestJson(
      "GET",
      `/v1/agent/lifecycle/jobs/${encodeURIComponent(jobId)}`,
      {
        requireAgentAuth: true,
        configPath,
      },
    );
    printJson(payload);

    if (!watch) {
      return;
    }

    const recommended = String(payload.recommended_action ?? "wait");
    if (recommended !== "wait") {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
}

export async function runAutolaunchLaunchFinalize(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const jobId = requireArg(getFlag(args, "job"), "job");
  const prepared = await requestJson(
    "POST",
    `/v1/agent/lifecycle/jobs/${encodeURIComponent(jobId)}/finalize/prepare`,
    { body: {}, requireAgentAuth: true, configPath },
  );

  if (!getBooleanFlag(args, "submit")) {
    printJson(prepared);
    return;
  }

  const preparedAction = prepared.prepared as Record<string, unknown> | undefined;
  const txRequest = extractPreparedTxRequest(
    preparedAction?.tx_request,
    preparedAction?.expected_signer,
  );
  if (!txRequest) {
    printJson(prepared);
    return;
  }

  const txHash = await submitPreparedTxRequest(txRequest, configPath);

  const registered = await requestJson(
    "POST",
    `/v1/agent/lifecycle/jobs/${encodeURIComponent(jobId)}/finalize/register`,
    { body: { tx_hash: txHash }, requireAgentAuth: true, configPath },
  );

  printJson(registered);
}

export async function runAutolaunchVestingStatus(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const jobId = requireArg(getFlag(args, "job"), "job");
  printJson(
    await requestJson(
      "GET",
      `/v1/agent/lifecycle/jobs/${encodeURIComponent(jobId)}/vesting`,
      {
        requireAgentAuth: true,
        configPath,
      },
    ),
  );
}

export async function runAutolaunchVestingRelease(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const jobId = requireArg(getFlag(args, "job"), "job");

  if (!getBooleanFlag(args, "submit")) {
    printJson(
      await requestJson(
        "POST",
        `/v1/agent/contracts/jobs/${encodeURIComponent(jobId)}/vesting/release/prepare`,
        { body: {}, requireAgentAuth: true, configPath },
      ),
    );
    return;
  }

  const prepared = await requestJson(
    "POST",
    `/v1/agent/contracts/jobs/${encodeURIComponent(jobId)}/vesting/release/prepare`,
    { body: {}, requireAgentAuth: true, configPath },
  );
  const preparedAction = prepared.prepared as Record<string, unknown> | undefined;
  const txRequest = extractPreparedTxRequest(
    preparedAction?.tx_request,
    preparedAction?.expected_signer,
  );

  if (!txRequest) {
    printJson(prepared);
    return;
  }

  const txHash = await submitPreparedTxRequest(txRequest, configPath);

  printJson({ ok: true, tx_hash: txHash, mode: "submitted" });
}
