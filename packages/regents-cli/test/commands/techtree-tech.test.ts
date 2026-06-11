import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureOutput, parsePrintedJson } from "../helpers/output.js";

const { daemonCallMock } = vi.hoisted(() => ({
  daemonCallMock: vi.fn(),
}));

vi.mock("../../src/daemon-client.js", () => ({
  daemonCall: daemonCallMock,
}));

const preparedWalletActionResponse = () => ({
  data: {
    wallet_action: {
      action_id: "tech_action_1",
      owner_product: "techtree",
      resource: "tech_rewards",
      resource_id: "3:science:42",
      action: "claim_reward",
      chain_id: 8453,
      to: "0x1111111111111111111111111111111111111111",
      value: "0x0",
      data: "0x1234",
      expected_signer: "0x2222222222222222222222222222222222222222",
      expires_at: "2026-05-07T12:00:00Z",
      idempotency_key: "tech_action_1",
      simulation: { required: false, status: "not_required", block_number: null },
      risk_copy: "Review this wallet action before signing.",
    },
  },
});

describe("techtree TECH command runners", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("prepares reward claims from canonical string-key flags", async () => {
    daemonCallMock.mockResolvedValue(preparedWalletActionResponse());

    const { runTechtreeTechRewardsClaim } = await import("../../src/commands/techtree-tech.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    const output = await captureOutput(() =>
      runTechtreeTechRewardsClaim(
        parseCliArgs([
          "techtree",
          "tech",
          "rewards",
          "claim",
          "--epoch",
          "3",
          "--lane",
          "science",
          "--agent-id",
          "42",
        ]),
      ),
    );

    expect(daemonCallMock).toHaveBeenCalledWith(
      "techtree.tech.rewards.claim",
      {
        epoch: 3,
        lane: "science",
        agent_id: "42",
      },
      undefined,
    );
    expect(parsePrintedJson(output.stdout).data.wallet_action.chain_id).toBe(8453);
  });

  it("prepares withdrawals with the vault arguments", async () => {
    daemonCallMock.mockResolvedValue(preparedWalletActionResponse());

    const { runTechtreeTechWithdraw } = await import("../../src/commands/techtree-tech.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    await captureOutput(() =>
      runTechtreeTechWithdraw(
        parseCliArgs([
          "techtree",
          "tech",
          "withdraw",
          "--agent-id",
          "42",
          "--amount",
          "1000000000000000000",
          "--tech-recipient",
          "0x1111111111111111111111111111111111111111",
        ]),
      ),
    );

    expect(daemonCallMock).toHaveBeenCalledWith(
      "techtree.tech.withdraw",
      {
        agent_id: "42",
        amount: "1000000000000000000",
        tech_recipient: "0x1111111111111111111111111111111111111111",
      },
      undefined,
    );
  });

  it("accepts zero-valued TECH contract fields", async () => {
    daemonCallMock.mockResolvedValue(preparedWalletActionResponse());

    const {
      runTechtreeTechLeaderboardsRegister,
      runTechtreeTechRewardsClaim,
      runTechtreeTechRewardsList,
      runTechtreeTechRewardsProof,
    } = await import("../../src/commands/techtree-tech.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    await captureOutput(() =>
      runTechtreeTechRewardsList(
        parseCliArgs([
          "techtree",
          "tech",
          "rewards",
          "list",
          "--epoch",
          "0",
        ]),
      ),
    );
    await captureOutput(() =>
      runTechtreeTechRewardsProof(
        parseCliArgs([
          "techtree",
          "tech",
          "rewards",
          "proof",
          "--epoch",
          "0",
          "--lane",
          "science",
          "--agent-id",
          "42",
        ]),
      ),
    );
    await captureOutput(() =>
      runTechtreeTechRewardsClaim(
        parseCliArgs([
          "techtree",
          "tech",
          "rewards",
          "claim",
          "--epoch",
          "0",
          "--lane",
          "science",
          "--agent-id",
          "42",
        ]),
      ),
    );
    await captureOutput(() =>
      runTechtreeTechLeaderboardsRegister(
        parseCliArgs([
          "techtree",
          "tech",
          "leaderboards",
          "register",
          "--leaderboard-id",
          "bbh",
          "--kind",
          "bbh",
          "--title",
          "BBH",
          "--weight-bps",
          "0",
          "--starts-epoch",
          "0",
          "--ends-epoch",
          "0",
          "--config-hash",
          "0x1111111111111111111111111111111111111111111111111111111111111111",
          "--uri",
          "ipfs://leaderboard",
        ]),
      ),
    );

    expect(daemonCallMock).toHaveBeenNthCalledWith(
      1,
      "techtree.tech.rewards.list",
      {
        epoch: 0,
        lane: undefined,
        limit: undefined,
      },
      undefined,
    );
    expect(daemonCallMock).toHaveBeenNthCalledWith(
      2,
      "techtree.tech.rewards.proof",
      {
        epoch: 0,
        lane: "science",
        agent_id: "42",
      },
      undefined,
    );
    expect(daemonCallMock).toHaveBeenNthCalledWith(
      3,
      "techtree.tech.rewards.claim",
      {
        epoch: 0,
        lane: "science",
        agent_id: "42",
      },
      undefined,
    );
    expect(daemonCallMock).toHaveBeenNthCalledWith(
      4,
      "techtree.tech.leaderboards.register",
      {
        leaderboard_id: "bbh",
        kind: "bbh",
        title: "BBH",
        weight_bps: 0,
        starts_epoch: 0,
        ends_epoch: 0,
        config_hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        uri: "ipfs://leaderboard",
        active: undefined,
      },
      undefined,
    );
  });

  it("prepares and confirms manager-only TECH records", async () => {
    daemonCallMock.mockResolvedValue(preparedWalletActionResponse());

    const {
      runTechtreeTechLeaderboardsConfirm,
      runTechtreeTechRewardsRootConfirm,
      runTechtreeTechRewardsRootPrepare,
    } = await import("../../src/commands/techtree-tech.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    await captureOutput(() =>
      runTechtreeTechRewardsRootPrepare(
        parseCliArgs([
          "techtree",
          "tech",
          "rewards",
          "root",
          "prepare",
          "--input",
          JSON.stringify({
            epoch: 3,
            lane: "science",
            total_budget_amount: "25",
            allocations: [{ agent_id: "42", score: "1" }],
          }),
        ]),
      ),
    );
    await captureOutput(() =>
      runTechtreeTechRewardsRootConfirm(
        parseCliArgs([
          "techtree",
          "tech",
          "rewards",
          "root",
          "confirm",
          "--manifest-id",
          "techm_123",
          "--tx-hash",
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        ]),
      ),
    );
    await captureOutput(() =>
      runTechtreeTechLeaderboardsConfirm(
        parseCliArgs([
          "techtree",
          "tech",
          "leaderboards",
          "confirm",
          "--leaderboard-id",
          "bbh",
          "--tx-hash",
          "0x2222222222222222222222222222222222222222222222222222222222222222",
        ]),
      ),
    );

    expect(daemonCallMock).toHaveBeenNthCalledWith(
      1,
      "techtree.tech.rewards.root.prepare",
      {
        epoch: 3,
        lane: "science",
        total_budget_amount: "25",
        allocations: [{ agent_id: "42", score: "1" }],
      },
      undefined,
    );
    expect(daemonCallMock).toHaveBeenNthCalledWith(
      2,
      "techtree.tech.rewards.root.confirm",
      {
        manifest_id: "techm_123",
        tx_hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
      undefined,
    );
    expect(daemonCallMock).toHaveBeenNthCalledWith(
      3,
      "techtree.tech.leaderboards.confirm",
      {
        leaderboard_id: "bbh",
        tx_hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
      },
      undefined,
    );
  });

  it("rejects unsupported reward lanes before preparing a claim", async () => {
    const { runTechtreeTechRewardsClaim } = await import("../../src/commands/techtree-tech.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    await expect(
      runTechtreeTechRewardsClaim(
        parseCliArgs([
          "techtree",
          "tech",
          "rewards",
          "claim",
          "--epoch",
          "3",
          "--lane",
          "legacy",
          "--agent-id",
          "42",
        ]),
      ),
    ).rejects.toThrow("--lane must be science or usdc_input.");
    expect(daemonCallMock).not.toHaveBeenCalled();
  });
});
