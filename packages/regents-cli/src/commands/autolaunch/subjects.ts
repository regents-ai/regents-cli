import {
  getBooleanFlag,
  getFlag,
  requireArg,
  type ParsedCliArgs,
} from "../../parse.js";
import { printJson } from "../../printer.js";
import {
  extractPreparedTxRequest,
  requestJson,
  requirePositional,
  submitPreparedTxRequest,
} from "./shared.js";

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

  const txRequest = extractPreparedTxRequest(prepared.tx_request, prepared.expected_signer);

  if (!txRequest) {
    printJson(prepared);
    return;
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

const requireHoldingSubjectId = (args: ParsedCliArgs): string =>
  requirePositional(args, 3, "subject-id");

export async function runAutolaunchSubjectShow(
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

export async function runAutolaunchSubjectStake(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/stake`,
    { amount: requireArg(getFlag(args, "amount"), "amount") },
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

export async function runAutolaunchSubjectClaimEmissions(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/claim-emissions`,
    {},
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectClaimAndStakeEmissions(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/claim-and-stake-emissions`,
    {},
    args,
    configPath,
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

export async function runAutolaunchHoldingsStake(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireHoldingSubjectId(args);
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/stake`,
    { amount: requireArg(getFlag(args, "amount"), "amount") },
    args,
    configPath,
  );
}

export async function runAutolaunchHoldingsUnstake(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireHoldingSubjectId(args);
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/unstake`,
    { amount: requireArg(getFlag(args, "amount"), "amount") },
    args,
    configPath,
  );
}

export async function runAutolaunchHoldingsClaimUsdc(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireHoldingSubjectId(args);
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/claim-usdc`,
    {},
    args,
    configPath,
  );
}

export async function runAutolaunchHoldingsClaimEmissions(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireHoldingSubjectId(args);
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/claim-emissions`,
    {},
    args,
    configPath,
  );
}

export async function runAutolaunchHoldingsClaimAndStakeEmissions(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireHoldingSubjectId(args);
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/claim-and-stake-emissions`,
    {},
    args,
    configPath,
  );
}

export async function runAutolaunchHoldingsSweepIngress(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireHoldingSubjectId(args);
  const ingressAddress = requireArg(getFlag(args, "address"), "address");
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/ingress/${encodeURIComponent(ingressAddress)}/sweep`,
    {},
    args,
    configPath,
  );
}
