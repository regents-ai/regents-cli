import {
  parseRequiredNonNegativeIntegerFlag,
  putOptionalIntegerFlag,
  putOptionalStringFlag,
} from "../../command-input.js";
import {
  getBooleanFlag,
  getFlag,
  requireArg,
  type ParsedCliArgs,
} from "../../parse.js";
import { printJson } from "../../printer.js";
import {
  preparedWalletActionFromEnvelope,
  printWalletActionEnvelope,
} from "../../terminal/wallet-action.js";
import { stakeBody, stakeReceiverFlag } from "../stake-receiver.js";
import {
  type JsonObject,
  requestJson,
  requirePositional,
  submitPreparedTxRequest,
  txRequestFromWalletAction,
} from "./shared.js";

type SubmitFollowup =
  | { kind: "confirm"; path: string }
  | { kind: "same-path"; path: string; body: Record<string, unknown> }
  | { kind: "local-receipt" };

const autolaunchPreparedAction = (envelope: JsonObject): JsonObject =>
  preparedWalletActionFromEnvelope(
    envelope,
    "This Autolaunch action did not include a transaction to submit.",
  ) as JsonObject;

const prepareOrSubmitWalletAction = async (
  preparePath: string,
  body: Record<string, unknown>,
  followup: SubmitFollowup,
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> => {
  const prepared = await requestJson("POST", preparePath, {
    body,
    requireAgentAuth: true,
    configPath,
  });

  if (!getBooleanFlag(args, "submit")) {
    printWalletActionEnvelope(args, prepared, {
      title: "AUTOLAUNCH WALLET ACTION",
      submitHint: "Run the same command with --submit when ready.",
      missingMessage: "This Autolaunch action did not include a transaction to submit.",
    });
    return;
  }

  const preparedAction = autolaunchPreparedAction(prepared);
  const txRequest = txRequestFromWalletAction(preparedAction.wallet_action);

  if (!txRequest) {
    throw new Error("This Autolaunch action did not include a transaction to submit.");
  }

  const txHash = await submitPreparedTxRequest(txRequest, configPath);

  if (followup.kind === "local-receipt") {
    printJson({ ok: true, tx_hash: txHash, prepared: preparedAction });
    return;
  }

  printJson(
    await requestJson("POST", followup.path, {
      body: followup.kind === "same-path"
        ? { ...followup.body, tx_hash: txHash }
        : { tx_hash: txHash },
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
    staker_pool_bps: parseRequiredNonNegativeIntegerFlag(args, "staker-pool-bps"),
    label: requireArg(getFlag(args, "label"), "label"),
  };

  putOptionalStringFlag(body, "salt", args, "salt");

  await prepareOrSubmitWalletAction(
    "/api/autolaunch/v1/agent/subjects/existing-token/prepare",
    body,
    { kind: "confirm", path: "/api/autolaunch/v1/agent/subjects/existing-token/confirm" },
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

  await prepareOrSubmitWalletAction(
    "/api/autolaunch/v1/agent/subjects/deferred-autolaunch/prepare",
    body,
    { kind: "confirm", path: "/api/autolaunch/v1/agent/subjects/deferred-autolaunch/confirm" },
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
      `/api/autolaunch/v1/agent/subjects/by-token/${encodeURIComponent(token)}`,
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
    await requestJson("GET", `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}`, {
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
      `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/ingress`,
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
      `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/staking`,
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
  const body = stakeBody(amount, receiver);

  await prepareOrSubmitWalletAction(
    `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/stake`,
    body,
    {
      kind: "same-path",
      path: `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/stake`,
      body,
    },
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectUnstake(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  const body = { amount: requireArg(getFlag(args, "amount"), "amount") };
  await prepareOrSubmitWalletAction(
    `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/unstake`,
    body,
    {
      kind: "same-path",
      path: `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/unstake`,
      body,
    },
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectClaimUsdc(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  await prepareOrSubmitWalletAction(
    `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/claim-usdc`,
    {},
    {
      kind: "same-path",
      path: `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/claim-usdc`,
      body: {},
    },
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
      `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/buybacks`,
      { requireAgentAuth: true, configPath },
    ),
  );
}

export async function runAutolaunchSubjectSettleBuyback(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");

  const body = {
    amount_usdc: requireArg(getFlag(args, "amount-usdc"), "amount-usdc"),
    min_regent_out: requireArg(getFlag(args, "min-regent-out"), "min-regent-out"),
  };

  await prepareOrSubmitWalletAction(
    `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/buybacks/settle`,
    body,
    {
      kind: "same-path",
      path: `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/buybacks/settle`,
      body,
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
      `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/payment-links`,
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

  await prepareOrSubmitWalletAction(
    `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/payment-links`,
    body,
    { kind: "local-receipt" },
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

  await prepareOrSubmitWalletAction(
    `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/payment-links/${encodeURIComponent(address)}/canonical`,
    { canonical: requireArg(getFlag(args, "canonical"), "canonical") },
    { kind: "local-receipt" },
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

  await prepareOrSubmitWalletAction(
    `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/payment-links/${encodeURIComponent(address)}/state`,
    body,
    { kind: "local-receipt" },
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
      `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/regent-emissions`,
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

  await prepareOrSubmitWalletAction(
    `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/ingress/${encodeURIComponent(address)}/sweep`,
    {},
    {
      kind: "same-path",
      path: `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/ingress/${encodeURIComponent(address)}/sweep`,
      body: {},
    },
    args,
    configPath,
  );
}
