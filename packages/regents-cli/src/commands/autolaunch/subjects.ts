import {
  getBooleanFlag,
  getFlag,
  parseIntegerFlag,
  requireArg,
  type ParsedCliArgs,
} from "../../parse.js";
import { printJson } from "../../printer.js";
import { stakeBody, stakeReceiverFlag } from "../stake-receiver.js";
import {
  type JsonObject,
  requestJson,
  requirePositional,
  submitPreparedTxRequest,
  txRequestFromWalletAction,
} from "./shared.js";

const preparedActionFromEnvelope = (envelope: JsonObject): JsonObject => {
  const preparedAction = envelope.prepared;
  if (!preparedAction || typeof preparedAction !== "object" || Array.isArray(preparedAction)) {
    throw new Error("This Autolaunch action did not include a transaction to submit.");
  }

  return preparedAction;
};

const prepareOrSubmitWrite = async (
  method: "POST",
  path: string,
  body: Record<string, unknown>,
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> => {
  const prepared = await requestJson(method, path, {
    body,
    requireAgentAuth: true,
    configPath,
  });

  if (!getBooleanFlag(args, "submit")) {
    printJson(prepared);
    return;
  }

  const preparedAction = preparedActionFromEnvelope(prepared);
  const txRequest = txRequestFromWalletAction(preparedAction.wallet_action);

  if (!txRequest) {
    throw new Error("This Autolaunch action did not include a transaction to submit.");
  }

  const txHash = await submitPreparedTxRequest(txRequest, configPath);
  printJson(
    await requestJson(method, path, {
      body: { ...body, tx_hash: txHash },
      requireAgentAuth: true,
      configPath,
    }),
  );
};

const prepareOrSubmitTransactionOnly = async (
  method: "POST",
  path: string,
  body: Record<string, unknown>,
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> => {
  const prepared = await requestJson(method, path, {
    body,
    requireAgentAuth: true,
    configPath,
  });

  if (!getBooleanFlag(args, "submit")) {
    printJson(prepared);
    return;
  }

  const preparedAction = preparedActionFromEnvelope(prepared);
  const txRequest = txRequestFromWalletAction(preparedAction.wallet_action);

  if (!txRequest) {
    throw new Error("This Autolaunch action did not include a transaction to submit.");
  }

  const txHash = await submitPreparedTxRequest(txRequest, configPath);
  printJson({ ok: true, tx_hash: txHash, prepared: preparedAction });
};

const parseNonNegativeIntegerFlag = (
  args: ParsedCliArgs,
  name: string,
): number => {
  const value = requireArg(getFlag(args, name), name);
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new Error(`invalid integer for --${name}`);
  }

  return parsed;
};

const putOptionalStringFlag = (
  body: Record<string, unknown>,
  key: string,
  args: ParsedCliArgs,
  flagName: string,
): void => {
  const value = getFlag(args, flagName);
  if (value !== undefined) {
    body[key] = value;
  }
};

const putOptionalIntegerFlag = (
  body: Record<string, unknown>,
  key: string,
  args: ParsedCliArgs,
  flagName: string,
): void => {
  const value = parseIntegerFlag(args, flagName);
  if (value !== undefined) {
    body[key] = value;
  }
};

const prepareOrSubmitSubjectCreation = async (
  preparePath: string,
  confirmPath: string,
  body: Record<string, unknown>,
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> => {
  const prepared = await requestJson("POST", preparePath, {
    body,
    requireAgentAuth: true,
    configPath,
  });

  if (!getBooleanFlag(args, "submit")) {
    printJson(prepared);
    return;
  }

  const preparedAction = preparedActionFromEnvelope(prepared);
  const txRequest = txRequestFromWalletAction(preparedAction.wallet_action);

  if (!txRequest) {
    throw new Error("This Autolaunch action did not include a transaction to submit.");
  }

  const txHash = await submitPreparedTxRequest(txRequest, configPath);
  printJson(
    await requestJson("POST", confirmPath, {
      body: { tx_hash: txHash },
      requireAgentAuth: true,
      configPath,
    }),
  );
};

export async function runAutolaunchSubjectCreateExistingToken(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const body: Record<string, unknown> = {
    stake_token: requireArg(getFlag(args, "stake-token"), "stake-token"),
    treasury: requireArg(getFlag(args, "treasury"), "treasury"),
    staker_pool_bps: parseNonNegativeIntegerFlag(args, "staker-pool-bps"),
    label: requireArg(getFlag(args, "label"), "label"),
  };

  putOptionalStringFlag(body, "salt", args, "salt");

  await prepareOrSubmitSubjectCreation(
    "/v1/agent/subjects/existing-token/prepare",
    "/v1/agent/subjects/existing-token/confirm",
    body,
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectCreateDeferredAutolaunch(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const body: Record<string, unknown> = {
    token_name: requireArg(getFlag(args, "token-name"), "token-name"),
    token_symbol: requireArg(getFlag(args, "token-symbol"), "token-symbol"),
    total_supply: requireArg(getFlag(args, "total-supply"), "total-supply"),
    treasury: requireArg(getFlag(args, "treasury"), "treasury"),
    subject_label: requireArg(getFlag(args, "subject-label"), "subject-label"),
  };

  putOptionalStringFlag(body, "token_factory_data", args, "token-factory-data");
  putOptionalStringFlag(body, "token_factory_salt", args, "token-factory-salt");
  putOptionalIntegerFlag(body, "identity_chain_id", args, "identity-chain-id");
  putOptionalStringFlag(body, "identity_registry", args, "identity-registry");
  putOptionalIntegerFlag(body, "identity_agent_id", args, "identity-agent-id");

  await prepareOrSubmitSubjectCreation(
    "/v1/agent/subjects/deferred-autolaunch/prepare",
    "/v1/agent/subjects/deferred-autolaunch/confirm",
    body,
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectByToken(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const token = requireArg(getFlag(args, "token"), "token");
  printJson(
    await requestJson(
      "GET",
      `/v1/agent/subjects/by-token/${encodeURIComponent(token)}`,
      { requireAgentAuth: true, configPath },
    ),
  );
}

export async function runAutolaunchSubjectGet(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  printJson(
    await requestJson("GET", `/v1/agent/subjects/${encodeURIComponent(subjectId)}`, {
      requireAgentAuth: true,
      configPath,
    }),
  );
}

export async function runAutolaunchSubjectIngress(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  printJson(
    await requestJson(
      "GET",
      `/v1/agent/subjects/${encodeURIComponent(subjectId)}/ingress`,
      { requireAgentAuth: true, configPath },
    ),
  );
}

export async function runAutolaunchSubjectStaking(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  printJson(
    await requestJson(
      "GET",
      `/v1/agent/subjects/${encodeURIComponent(subjectId)}/staking`,
      { requireAgentAuth: true, configPath },
    ),
  );
}

export async function runAutolaunchSubjectStake(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  const amount = requireArg(getFlag(args, "amount"), "amount");
  const receiver = stakeReceiverFlag(args);

  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/stake`,
    stakeBody(amount, receiver),
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectUnstake(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/unstake`,
    { amount: requireArg(getFlag(args, "amount"), "amount") },
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectClaimUsdc(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/claim-usdc`,
    {},
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectBuybacks(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  printJson(
    await requestJson(
      "GET",
      `/v1/agent/subjects/${encodeURIComponent(subjectId)}/buybacks`,
      { requireAgentAuth: true, configPath },
    ),
  );
}

export async function runAutolaunchSubjectSettleBuyback(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");

  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/buybacks/settle`,
    {
      amount_usdc: requireArg(getFlag(args, "amount-usdc"), "amount-usdc"),
      min_regent_out: requireArg(getFlag(args, "min-regent-out"), "min-regent-out"),
    },
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectPaymentLinks(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  printJson(
    await requestJson(
      "GET",
      `/v1/agent/subjects/${encodeURIComponent(subjectId)}/payment-links`,
      { requireAgentAuth: true, configPath },
    ),
  );
}

export async function runAutolaunchPaymentLinkCreate(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireArg(getFlag(args, "subject"), "subject");
  const body: Record<string, unknown> = {
    label: requireArg(getFlag(args, "label"), "label"),
    canonical: getBooleanFlag(args, "canonical"),
  };
  putOptionalStringFlag(body, "salt", args, "salt");

  await prepareOrSubmitTransactionOnly(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/payment-links`,
    body,
    args,
    configPath,
  );
}

export async function runAutolaunchPaymentLinkSetCanonical(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireArg(getFlag(args, "subject"), "subject");
  const address = requireArg(getFlag(args, "address"), "address");

  await prepareOrSubmitTransactionOnly(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/payment-links/${encodeURIComponent(address)}/canonical`,
    { canonical: requireArg(getFlag(args, "canonical"), "canonical") },
    args,
    configPath,
  );
}

export async function runAutolaunchPaymentLinkSetState(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireArg(getFlag(args, "subject"), "subject");
  const address = requireArg(getFlag(args, "address"), "address");
  const body: Record<string, unknown> = {
    active: requireArg(getFlag(args, "active"), "active"),
  };
  putOptionalStringFlag(body, "replacement", args, "replacement");

  await prepareOrSubmitTransactionOnly(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/payment-links/${encodeURIComponent(address)}/state`,
    body,
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectRegentEmissions(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  printJson(
    await requestJson(
      "GET",
      `/v1/agent/subjects/${encodeURIComponent(subjectId)}/regent-emissions`,
      { requireAgentAuth: true, configPath },
    ),
  );
}

export async function runAutolaunchSubjectSweepIngress(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  const address = requireArg(getFlag(args, "address"), "address");

  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/ingress/${encodeURIComponent(address)}/sweep`,
    {},
    args,
    configPath,
  );
}
