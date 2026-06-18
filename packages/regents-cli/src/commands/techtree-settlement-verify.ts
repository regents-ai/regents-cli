import { createPublicClient, encodeAbiParameters, http, keccak256 } from "viem";

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

// Minimal read ABI for TechRewardRouter. The TechContractStatus payload does
// not publish the reward-router read ABI, so the CLI vendors it here. The getter
// is the public `allocationRoots(uint64 epoch, RewardLane lane)` mapping, pinned
// to the deployed source techtree/contracts/src/TechRewardRouter.sol; the struct
// fields and the RewardLane enum ordering (Science = 0, UsdcInput = 1) come from
// that same file. Keep these in sync if the contract ABI changes.
const REWARD_ROUTER_READ_ABI = [
  {
    type: "function",
    name: "allocationRoots",
    stateMutability: "view",
    inputs: [
      { name: "epoch", type: "uint64" },
      { name: "lane", type: "uint8" },
    ],
    outputs: [
      { name: "merkleRoot", type: "bytes32" },
      { name: "totalAllocated", type: "uint256" },
      { name: "manifestHash", type: "bytes32" },
      { name: "challengeEndsAt", type: "uint64" },
      { name: "exists", type: "bool" },
    ],
  },
] as const;

// RewardLane enum ordinals from TechRewardRouter.sol. The product `fold` lane is
// not present in the reward router, so its onchain root cannot be read.
const LANE_ORDINAL: Record<string, number> = {
  science: 0,
  usdc_input: 1,
};

const MISSING_RECEIPT_NEXT =
  "chain wins for rewards. The settlement record is not confirmed onchain; this is incident class paid_payload_entitlement (owner: techtree).";

const ROOT_MISMATCH_NEXT =
  "chain wins for rewards. The onchain allocation root does not match the manifest; trust the chain root.";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asRecordArray = (value: unknown): readonly Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        return record ? [record] : [];
      })
    : [];

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const asInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/u.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
};

const sameHex = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

const txHashPattern = /^0x[0-9a-fA-F]{64}$/u;

const rpcUrl = (args: ParsedCliArgs): string | undefined =>
  getFlag(args, "rpc-url") ?? process.env.BASE_MAINNET_RPC_URL ?? process.env.BASE_RPC_URL;

const fetchTechtreeJson = async (
  path: string,
  configPath?: string,
): Promise<{ readonly payload: Record<string, unknown> | null; readonly error: string | null }> => {
  try {
    const payload = await requestProductJson<Record<string, unknown>>("GET", path, {
      requireAgentAuth: true,
      authAudience: "techtree",
      service: "techtree",
      commandName: "regents techtree settlement verify",
      configPath,
    });
    return { payload, error: null };
  } catch (error) {
    return { payload: null, error: errorText(error) };
  }
};

// Standard OpenZeppelin Merkle proof verification (sorted pairs, keccak256), the
// scheme used by MerkleProof.verifyCalldata in TechRewardRouter.claim.
const verifyMerkleProof = (
  proof: readonly `0x${string}`[],
  root: `0x${string}`,
  leaf: `0x${string}`,
): boolean => {
  let computed = leaf;
  for (const node of proof) {
    const [a, b] =
      computed.toLowerCase() <= node.toLowerCase() ? [computed, node] : [node, computed];
    computed = keccak256(`0x${a.slice(2)}${b.slice(2)}` as `0x${string}`);
  }
  return sameHex(computed, root);
};

const buildVerification = async (args: ParsedCliArgs, configPath?: string) => {
  const checks: VerifyCheck[] = [];
  const chainView: Record<string, unknown> = {};

  const { payload: status, error: statusError } = await fetchTechtreeJson(
    "/api/techtree/v1/tech/status",
    configPath,
  );
  const statusData = asRecord(status?.data);
  const contracts = asRecord(statusData?.contracts);
  const rewardRouter = asText(contracts?.reward_router);

  if (statusError !== null || !contracts || !rewardRouter) {
    checks.push({
      item: "techtree status",
      status: "UNVERIFIABLE",
      detail: "TECH contract status",
      reason:
        statusError ??
        "Techtree did not return contract status. Run `regents auth login --audience techtree` first.",
    });
    return {
      ok: true,
      command: "techtree settlement verify",
      status: "waiting",
      checks,
      api_view: { status, manifests: [], proof: null },
      chain_view: chainView,
    };
  }

  // Resolve the epoch from the flag or the current epoch.
  let epoch = asInteger(getFlag(args, "epoch"));
  if (epoch === null) {
    const { payload: current } = await fetchTechtreeJson("/api/techtree/v1/tech/epochs/current", configPath);
    epoch = asInteger(asRecord(current?.data)?.epoch);
  }
  if (epoch === null) {
    checks.push({
      item: "epoch",
      status: "UNVERIFIABLE",
      detail: "no epoch to verify",
      reason: "Pass --epoch, or wait until Techtree publishes a current epoch.",
    });
    return {
      ok: true,
      command: "techtree settlement verify",
      status: "waiting",
      checks,
      api_view: { status, manifests: [], proof: null },
      chain_view: chainView,
    };
  }

  const lane = asText(getFlag(args, "lane"));
  const laneQuery = lane ? `&lane=${encodeURIComponent(lane)}` : "";
  const { payload: rewards } = await fetchTechtreeJson(
    `/api/techtree/v1/tech/rewards?epoch=${epoch}${laneQuery}`,
    configPath,
  );
  const manifests = asRecordArray(rewards?.data);

  if (manifests.length === 0) {
    checks.push({
      item: `epoch ${epoch}${lane ? ` lane ${lane}` : ""} manifests`,
      status: "UNVERIFIABLE",
      detail: "no reward manifests",
      reason: "Techtree published no reward manifests for this epoch/lane.",
    });
  }

  const rpc = rpcUrl(args);
  const publicClient = rpc ? createPublicClient({ transport: http(rpc) }) : null;
  const rpcReason =
    "Set BASE_MAINNET_RPC_URL or BASE_RPC_URL, or pass --rpc-url, to read settlement state onchain.";

  for (const manifest of manifests) {
    const manifestLane = asText(manifest.lane) ?? lane ?? "unknown";
    const manifestStatus = asText(manifest.status) ?? "unknown";
    const merkleRoot = asText(manifest.merkle_root);
    const txHash = asText(manifest.tx_hash);
    const label = `lane ${manifestLane}`;

    if (manifestStatus === "prepared" && !txHash) {
      checks.push({
        item: `settlement ${label}`,
        status: "MATCH",
        detail: "the manifest is prepared and not yet posted onchain; settlement is pending",
      });
      continue;
    }

    if (manifestStatus !== "posted") {
      checks.push({
        item: `settlement ${label}`,
        status: "MATCH",
        detail: `the manifest status is ${manifestStatus}; nothing to reconcile onchain yet`,
      });
      continue;
    }

    // Posted manifest: the receipt must confirm and target the reward router.
    if (!txHash || !txHashPattern.test(txHash)) {
      checks.push({
        item: `settlement receipt ${label}`,
        status: "MISMATCH",
        detail: "the manifest is posted but carries no settlement tx hash",
        next: MISSING_RECEIPT_NEXT,
      });
      continue;
    }

    if (!publicClient) {
      checks.push({
        item: `settlement receipt ${label}`,
        status: "UNVERIFIABLE",
        detail: `tx ${txHash}`,
        reason: rpcReason,
      });
      checks.push({
        item: `onchain root ${label}`,
        status: "UNVERIFIABLE",
        detail: `epoch ${epoch} ${manifestLane}`,
        reason: rpcReason,
      });
      continue;
    }

    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
      const succeeded = receipt.status === "success";
      const targetsRouter =
        typeof receipt.to === "string" && sameHex(receipt.to, rewardRouter);
      chainView[txHash] = { status: receipt.status, to: receipt.to };

      if (!succeeded || !targetsRouter) {
        checks.push({
          item: `settlement receipt ${label}`,
          status: "MISMATCH",
          detail: !succeeded
            ? `the settlement tx ${txHash} did not succeed onchain`
            : `the settlement tx ${txHash} did not target the reward router ${rewardRouter}`,
          next: MISSING_RECEIPT_NEXT,
        });
      } else {
        checks.push({
          item: `settlement receipt ${label}`,
          status: "MATCH",
          detail: `the settlement tx ${txHash} succeeded and targeted the reward router`,
        });
      }
    } catch (error) {
      checks.push({
        item: `settlement receipt ${label}`,
        status: "MISMATCH",
        detail: `the settlement tx ${txHash} has no confirmed receipt onchain`,
        next: MISSING_RECEIPT_NEXT,
        reason: errorText(error),
      });
      continue;
    }

    // Compare the onchain allocation root for (epoch, lane) with the manifest root.
    const ordinal = LANE_ORDINAL[manifestLane];
    if (ordinal === undefined) {
      checks.push({
        item: `onchain root ${label}`,
        status: "UNVERIFIABLE",
        detail: `epoch ${epoch} ${manifestLane}`,
        reason: `The reward router has no allocation root for lane ${manifestLane}; it only tracks science and usdc_input lanes.`,
      });
      continue;
    }

    if (!merkleRoot) {
      checks.push({
        item: `onchain root ${label}`,
        status: "UNVERIFIABLE",
        detail: `epoch ${epoch} ${manifestLane}`,
        reason: "The manifest published no merkle_root to compare.",
      });
      continue;
    }

    try {
      const onchain = (await publicClient.readContract({
        address: rewardRouter as `0x${string}`,
        abi: REWARD_ROUTER_READ_ABI,
        functionName: "allocationRoots",
        args: [BigInt(epoch), ordinal],
      })) as readonly [string, bigint, string, bigint, boolean];
      const onchainRoot = onchain[0];
      chainView[`root_${epoch}_${manifestLane}`] = onchainRoot;

      if (sameHex(onchainRoot, merkleRoot)) {
        checks.push({
          item: `onchain root ${label}`,
          status: "MATCH",
          detail: `the onchain allocation root matches the manifest root ${merkleRoot}`,
        });
      } else {
        checks.push({
          item: `onchain root ${label}`,
          status: "MISMATCH",
          detail: `the manifest root is ${merkleRoot} but the chain root is ${onchainRoot}`,
          next: ROOT_MISMATCH_NEXT,
        });
      }
    } catch (error) {
      checks.push({
        item: `onchain root ${label}`,
        status: "UNVERIFIABLE",
        detail: `epoch ${epoch} ${manifestLane}`,
        reason: errorText(error),
      });
    }
  }

  // Optional: verify one agent's Merkle proof locally against the posted root.
  let proofPayload: Record<string, unknown> | null = null;
  const agent = asText(getFlag(args, "agent"));
  if (agent) {
    const proofLane = lane ?? asText(manifests[0]?.lane);
    if (!proofLane) {
      checks.push({
        item: "allocation proof",
        status: "UNVERIFIABLE",
        detail: `agent ${agent}`,
        reason: "Pass --lane (or query an epoch with manifests) so the agent proof can be fetched.",
      });
    } else {
      const { payload: proof, error: proofError } = await fetchTechtreeJson(
        `/api/techtree/v1/tech/rewards/proof?epoch=${epoch}&lane=${encodeURIComponent(proofLane)}&agent_id=${encodeURIComponent(agent)}`,
        configPath,
      );
      proofPayload = proof;
      const proofData = asRecord(proof?.data);

      if (proofError !== null || !proofData) {
        checks.push({
          item: "allocation proof",
          status: "UNVERIFIABLE",
          detail: `agent ${agent} lane ${proofLane}`,
          reason: proofError ?? "Techtree returned no allocation proof for this agent.",
        });
      } else {
        const proofRoot = asText(proofData.merkle_root);
        const amount = asText(proofData.amount);
        const allocationRef = asText(proofData.allocation_ref);
        const nodes = (Array.isArray(proofData.proof) ? proofData.proof : []).filter(
          (node): node is string => typeof node === "string",
        );
        const ordinal = LANE_ORDINAL[proofLane];

        if (proofRoot === null || amount === null || allocationRef === null || ordinal === undefined) {
          checks.push({
            item: "allocation proof",
            status: "UNVERIFIABLE",
            detail: `agent ${agent} lane ${proofLane}`,
            reason: "The allocation proof is missing fields needed to recompute the leaf.",
          });
        } else {
          const leaf = keccak256(
            encodeAbiParameters(
              [
                { type: "uint64" },
                { type: "uint8" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "bytes32" },
              ],
              [BigInt(epoch), ordinal, BigInt(agent), BigInt(amount), allocationRef as `0x${string}`],
            ),
          );
          const verified = verifyMerkleProof(
            nodes as `0x${string}`[],
            proofRoot as `0x${string}`,
            leaf,
          );
          if (verified) {
            checks.push({
              item: "allocation proof",
              status: "MATCH",
              detail: `agent ${agent}'s allocation proof verifies against the posted root`,
            });
          } else {
            checks.push({
              item: "allocation proof",
              status: "MISMATCH",
              detail: `agent ${agent}'s allocation proof does not verify against the posted root`,
              next: ROOT_MISMATCH_NEXT,
            });
          }
        }
      }
    }
  }

  const mismatched = checks.some((check) => check.status === "MISMATCH");

  return {
    ok: !mismatched,
    command: "techtree settlement verify",
    status: mismatched ? "mismatch" : "ready",
    epoch,
    lane: lane ?? null,
    checks,
    api_view: { status, manifests, proof: proofPayload },
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
    renderKeyValuePanel("◆ SETTLEMENT VERIFY", [
      {
        label: "status",
        value: result.status,
        valueColor: result.ok ? CLI_PALETTE.emphasis : CLI_PALETTE.error,
      },
      { label: "epoch", value: result.status === "waiting" ? "not ready" : String(result.epoch ?? "") },
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

export async function runTechtreeSettlementVerify(
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
