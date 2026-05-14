import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureOutput, parsePrintedJson } from "../helpers/output.js";

const { daemonCallMock } = vi.hoisted(() => ({
  daemonCallMock: vi.fn(),
}));

vi.mock("../../src/daemon-client.js", () => ({
  daemonCall: daemonCallMock,
}));

describe("techtree fold command runners", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("initializes the Fold policy with the current policy shape", async () => {
    daemonCallMock.mockResolvedValue({
      data: {
        enabled: true,
        monthly_budget_usd_micros: 25_000_000,
        daily_budget_usd_micros: 2_000_000,
        max_work_unit_usd_micros: 500_000,
        min_proof_for_rewards: "tee_attested",
        allowed_tools: ["python"],
        allowed_models: ["openai/*"],
        privacy_classes: ["public", "blinded"],
        reward_wallet_address: null,
        reporting: { weekly_summary: true },
      },
    });

    const { runTechtreeFoldPolicyInit } = await import("../../src/commands/techtree-fold.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    const output = await captureOutput(() =>
      runTechtreeFoldPolicyInit(
        parseCliArgs([
          "techtree",
          "fold",
          "policy",
          "init",
          "--enabled",
          "--monthly-budget-usd",
          "25",
          "--daily-budget-usd",
          "2",
          "--max-work-unit-usd",
          "0.5",
          "--allowed-tools",
          "python",
          "--allowed-models",
          "openai/*",
          "--privacy-classes",
          "public,blinded",
          "--weekly-summary",
        ]),
      ),
    );

    expect(output.result).toBeUndefined();
    expect(daemonCallMock).toHaveBeenCalledWith(
      "techtree.fold.policy.init",
      {
        enabled: true,
        monthly_budget_usd_micros: 25_000_000,
        daily_budget_usd_micros: 2_000_000,
        max_work_unit_usd_micros: 500_000,
        min_proof_for_rewards: "tee_attested",
        allowed_tools: ["python"],
        allowed_models: ["openai/*"],
        privacy_classes: ["public", "blinded"],
        reward_wallet_address: null,
        reporting: { weekly_summary: true },
      },
      undefined,
    );
    expect(parsePrintedJson(output.stdout)).toEqual(expect.objectContaining({ data: expect.any(Object) }));
  });

  it("checks proof by attempt id", async () => {
    daemonCallMock.mockResolvedValueOnce({ data: { attempt_id: "attempt_123", proof_level: "tee_attested" } });

    const { runTechtreeFoldProof } = await import("../../src/commands/techtree-fold.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    await captureOutput(() =>
      runTechtreeFoldProof(parseCliArgs(["techtree", "fold", "proof", "--attempt", "attempt_123"])),
    );

    expect(daemonCallMock).toHaveBeenCalledWith(
      "techtree.fold.proof",
      { attempt_id: "attempt_123" },
      undefined,
    );
  });
});
