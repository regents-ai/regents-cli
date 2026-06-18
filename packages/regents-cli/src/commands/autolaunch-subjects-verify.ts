import { createPublicClient, http } from "viem";

import { getBooleanFlag, getFlag, parseCliArgs, type ParsedCliArgs } from "../parse.js";
import {
  CLI_PALETTE,
  printJson,
  printText,
  renderKeyValuePanel,
  renderPanel,
  renderTablePanel,
} from "../printer.js";
import { requestProductJson } from "./product-http.js";

type CheckStatus = "MATCH" | "MISMATCH" | "UNVERIFIABLE";

interface VerifyCheck {
  readonly item: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly reason?: string;
  readonly next?: string;
}

// Minimal ERC-20 read ABI carried by the CLI. The subject payload does not
// publish ABI fragments, so the CLI owns the symbol()/totalSupply() signatures.
const ERC20_READ_ABI = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const INGRESS_GAP_REASON =
  "The subject ingress endpoint does not publish the expected unswept USDC amount, so the chain balance cannot be split from already-recognized revenue.";

const PENDING_BUYBACK_GAP_REASON =
  "Pending buyback and splitter accounting are internal balances; no published read ABI exposes them onchain to diff against the API.";

const LAUNCH_GAP_REASON =
  "The subject payload does not expose a launch job or auction id, so live-auction state cannot be located onchain.";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const addressPattern = /^0x[0-9a-fA-F]{40}$/u;

const isAddress = (value: unknown): value is `0x${string}` =>
  typeof value === "string" && addressPattern.test(value);

const rpcUrl = (args: ParsedCliArgs): string | undefined =>
  getFlag(args, "rpc-url") ?? process.env.BASE_MAINNET_RPC_URL ?? process.env.BASE_RPC_URL;

interface SubjectFacts {
  readonly tokenAddress: string | null;
  readonly splitterAddress: string | null;
  readonly ingressAddress: string | null;
  readonly subjectKind: string | null;
  readonly teamSharedStatus: string | null;
}

const requireSubjectId = (args: ParsedCliArgs): string => {
  const value = args.positionals[3];
  if (!value) {
    throw new Error("missing required positional argument: subject_id");
  }
  return value;
};

const fetchSubject = async (
  subjectId: string,
  configPath?: string,
): Promise<{ readonly payload: Record<string, unknown> | null; readonly error: string | null }> => {
  try {
    const payload = await requestProductJson<Record<string, unknown>>(
      "GET",
      `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}`,
      {
        requireAgentAuth: true,
        authAudience: "autolaunch",
        service: "autolaunch",
        commandName: "regents autolaunch subjects verify",
        configPath,
      },
    );
    return { payload, error: null };
  } catch (error) {
    return { payload: null, error: errorText(error) };
  }
};

const fetchOptional = async (
  path: string,
  configPath?: string,
): Promise<Record<string, unknown> | null> => {
  try {
    return await requestProductJson<Record<string, unknown>>("GET", path, {
      requireAgentAuth: true,
      authAudience: "autolaunch",
      service: "autolaunch",
      commandName: "regents autolaunch subjects verify",
      configPath,
    });
  } catch {
    return null;
  }
};

const deployedCodeCheck = async (
  publicClient: ReturnType<typeof createPublicClient>,
  item: string,
  address: string,
): Promise<VerifyCheck> => {
  try {
    const bytecode = await publicClient.getBytecode({ address: address as `0x${string}` });
    const hasCode = typeof bytecode === "string" && bytecode !== "0x" && bytecode.length > 2;
    if (!hasCode) {
      return {
        item,
        status: "MISMATCH",
        detail: `the subject's ${item} address ${address} has no deployed code onchain`,
        next: "Chain wins. The published address is not a deployed contract; report it to Autolaunch (incident class billing/launch_deployment).",
      };
    }
    return { item, status: "MATCH", detail: `${address} is a deployed contract` };
  } catch (error) {
    return { item, status: "UNVERIFIABLE", detail: address, reason: errorText(error) };
  }
};

const buildVerification = async (args: ParsedCliArgs, configPath?: string) => {
  const subjectId = requireSubjectId(args);
  const checks: VerifyCheck[] = [];
  const chainView: Record<string, unknown> = {};

  const { payload: subjectEnvelope, error: subjectError } = await fetchSubject(subjectId, configPath);

  if (subjectError !== null || !subjectEnvelope) {
    checks.push({
      item: "subject record",
      status: "UNVERIFIABLE",
      detail: `subject ${subjectId}`,
      reason:
        subjectError ??
        "Autolaunch did not return a subject record. Run `regents auth login --audience autolaunch` first.",
    });

    return {
      ok: true,
      command: "autolaunch subjects verify",
      status: "ready",
      subject_id: subjectId,
      checks,
      api_view: { subject: subjectEnvelope },
      chain_view: chainView,
    };
  }

  const subject = asRecord(subjectEnvelope.subject) ?? subjectEnvelope;
  const facts: SubjectFacts = {
    tokenAddress: asText(subject.token_address),
    splitterAddress: asText(subject.splitter_address),
    ingressAddress: asText(subject.default_ingress_address),
    subjectKind: asText(subject.subject_kind),
    teamSharedStatus: asText(subject.team_shared_status),
  };

  const staking = await fetchOptional(
    `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/staking`,
    configPath,
  );
  const ingress = await fetchOptional(
    `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/ingress`,
    configPath,
  );
  const buybacks = await fetchOptional(
    `/api/autolaunch/v1/agent/subjects/${encodeURIComponent(subjectId)}/buybacks`,
    configPath,
  );

  const rpc = rpcUrl(args);

  if (!rpc) {
    const reason =
      "Set BASE_MAINNET_RPC_URL or BASE_RPC_URL, or pass --rpc-url, to verify deployed code onchain.";
    if (facts.tokenAddress) {
      checks.push({ item: "token deployed", status: "UNVERIFIABLE", detail: facts.tokenAddress, reason });
    }
    if (facts.splitterAddress) {
      checks.push({ item: "splitter deployed", status: "UNVERIFIABLE", detail: facts.splitterAddress, reason });
    }
    if (facts.ingressAddress) {
      checks.push({ item: "ingress deployed", status: "UNVERIFIABLE", detail: facts.ingressAddress, reason });
    }
    checks.push({ item: "token symbol / supply", status: "UNVERIFIABLE", detail: "ERC-20 reads", reason });
  } else {
    const publicClient = createPublicClient({ transport: http(rpc) });

    if (facts.tokenAddress) {
      checks.push(await deployedCodeCheck(publicClient, "token deployed", facts.tokenAddress));
    }
    if (facts.splitterAddress) {
      checks.push(await deployedCodeCheck(publicClient, "splitter deployed", facts.splitterAddress));
    }
    if (facts.ingressAddress) {
      checks.push(await deployedCodeCheck(publicClient, "ingress deployed", facts.ingressAddress));
    }

    if (facts.tokenAddress && isAddress(facts.tokenAddress)) {
      try {
        const symbol = (await publicClient.readContract({
          address: facts.tokenAddress,
          abi: ERC20_READ_ABI,
          functionName: "symbol",
        })) as string;
        const totalSupply = (await publicClient.readContract({
          address: facts.tokenAddress,
          abi: ERC20_READ_ABI,
          functionName: "totalSupply",
        })) as bigint;
        chainView.token = { symbol, total_supply: totalSupply.toString() };
        checks.push({
          item: "token symbol / supply",
          status: "MATCH",
          detail: `token reads as ${symbol} with total supply ${totalSupply.toString()}`,
        });
      } catch (error) {
        checks.push({
          item: "token symbol / supply",
          status: "UNVERIFIABLE",
          detail: facts.tokenAddress,
          reason: errorText(error),
        });
      }
    }
  }

  // Money rows: chain wins. The ingress balance cannot be reconciled because the
  // ingress endpoint does not publish the expected unswept USDC amount.
  if (facts.ingressAddress) {
    checks.push({
      item: "ingress balance vs unswept",
      status: "UNVERIFIABLE",
      detail: `ingress ${facts.ingressAddress}`,
      reason: INGRESS_GAP_REASON,
    });
  }

  // Pending buyback / splitter accounting has no published read ABI to diff.
  if (buybacks) {
    checks.push({
      item: "pending buyback vs chain",
      status: "UNVERIFIABLE",
      detail: "subject buybacks",
      reason: PENDING_BUYBACK_GAP_REASON,
    });
  }

  // Workflow rows: product wins. These come straight from the subject record.
  if (facts.subjectKind) {
    checks.push({
      item: "subject kind",
      status: "MATCH",
      detail: `Autolaunch records this subject as ${facts.subjectKind}`,
    });
  }
  if (facts.teamSharedStatus) {
    checks.push({
      item: "team shared status",
      status: "MATCH",
      detail: `Autolaunch records the team-shared status as ${facts.teamSharedStatus}`,
    });
  }

  // Live-auction state can only be checked when the subject points at a launch.
  checks.push({
    item: "live auction state",
    status: "UNVERIFIABLE",
    detail: "auction state",
    reason: LAUNCH_GAP_REASON,
  });

  const mismatched = checks.some((check) => check.status === "MISMATCH");

  return {
    ok: !mismatched,
    command: "autolaunch subjects verify",
    status: mismatched ? "mismatch" : "ready",
    subject_id: subjectId,
    checks,
    api_view: {
      subject: subjectEnvelope,
      staking,
      ingress,
      buybacks,
    },
    chain_view: chainView,
  };
};

const statusColor = (status: CheckStatus): string => {
  if (status === "MATCH") {
    return CLI_PALETTE.emphasis;
  }
  if (status === "MISMATCH") {
    return CLI_PALETTE.error;
  }
  return CLI_PALETTE.secondary;
};

const checkRow = (check: VerifyCheck) => ({
  cells: [
    check.item,
    check.status === "UNVERIFIABLE" ? `UNVERIFIABLE(${check.reason ?? "unknown"})` : check.status,
    check.detail,
  ],
  colors: [undefined, statusColor(check.status), undefined],
});

const renderHuman = (result: Awaited<ReturnType<typeof buildVerification>>): string => {
  const nextLines = result.checks
    .filter((check) => check.next !== undefined)
    .map((check) => `Next: ${check.next}`);

  return [
    renderKeyValuePanel("◆ SUBJECT VERIFY", [
      {
        label: "status",
        value: result.status,
        valueColor: result.ok ? CLI_PALETTE.emphasis : CLI_PALETTE.error,
      },
      { label: "subject", value: result.subject_id },
    ], {
      borderColor: CLI_PALETTE.chrome,
      titleColor: CLI_PALETTE.title,
    }),
    renderTablePanel(
      "◆ CHECKS",
      [{ header: "item" }, { header: "status" }, { header: "detail" }],
      result.checks.map(checkRow),
    ),
    ...(nextLines.length > 0 ? [renderPanel("◆ NEXT", nextLines)] : []),
  ].join("\n\n");
};

export async function runAutolaunchSubjectsVerify(
  args: readonly string[] | ParsedCliArgs,
  configPath?: string,
): Promise<number> {
  const parsedArgs = Array.isArray(args) ? parseCliArgs(args) : (args as ParsedCliArgs);
  const json = getBooleanFlag(parsedArgs, "json");
  const result = await buildVerification(parsedArgs, configPath);

  if (json) {
    printJson(result);
  } else {
    printText(renderHuman(result));
  }

  return result.ok ? 0 : 1;
}
