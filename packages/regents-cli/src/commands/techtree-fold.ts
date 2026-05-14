import { CliUsageError } from "../cli-usage-error.js";
import { daemonCall } from "../daemon-client.js";
import type { BenchmarkProofLevel, FoldPolicyInput } from "../internal-types/index.js";
import { getBooleanFlag, getFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";

const proofLevels = new Set(["self_reported", "external_eval", "reproducible", "tee_attested", "cross_provider"]);
const privacyClasses = new Set(["public", "blinded", "hidden_scorer"]);
type FoldPrivacyClass = FoldPolicyInput["privacy_classes"][number];

export async function runTechtreeFoldPolicyInit(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.fold.policy.init",
      {
        enabled: getBooleanFlag(args, "enabled"),
        monthly_budget_usd_micros: parseUsdMicros(getFlag(args, "monthly-budget-usd"), "--monthly-budget-usd"),
        daily_budget_usd_micros: parseUsdMicros(getFlag(args, "daily-budget-usd"), "--daily-budget-usd"),
        max_work_unit_usd_micros: parseUsdMicros(getFlag(args, "max-work-unit-usd"), "--max-work-unit-usd"),
        min_proof_for_rewards: parseProofLevel(getFlag(args, "min-proof-for-rewards") ?? "tee_attested"),
        allowed_tools: parseCsv(getFlag(args, "allowed-tools")),
        allowed_models: parseCsv(getFlag(args, "allowed-models")),
        privacy_classes: parsePrivacyClasses(getFlag(args, "privacy-classes") ?? "public"),
        reward_wallet_address: getFlag(args, "reward-wallet-address") ?? null,
        reporting: { weekly_summary: getBooleanFlag(args, "weekly-summary") },
      },
      configPath,
    ),
  );
}

export async function runTechtreeFoldStatus(_args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.fold.status", undefined, configPath));
}

export async function runTechtreeFoldProof(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.fold.proof",
      { attempt_id: requireArg(getFlag(args, "attempt"), "--attempt") },
      configPath,
    ),
  );
}

export async function runTechtreeFoldReport(args: ParsedCliArgs, configPath?: string): Promise<void> {
  requireArg(getFlag(args, "agent"), "--agent");
  printJson(await daemonCall("techtree.fold.evidencePacket", undefined, configPath));
}

const parseUsdMicros = (value: string | undefined, flagName: string): number => {
  if (value === undefined) {
    return 0;
  }

  const normalized = value.trim();
  const match = normalized.match(/^([0-9]+)(?:\.([0-9]{1,6}))?$/);
  if (!match) {
    throw new CliUsageError({
      code: "invalid_flag_value",
      message: `${flagName} must be a non-negative USD amount with up to 6 decimal places.`,
    });
  }

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(6, "0"));
  const micros = whole * 1_000_000 + fraction;

  if (!Number.isSafeInteger(micros)) {
    throw new CliUsageError({
      code: "invalid_flag_value",
      message: `${flagName} is too large.`,
    });
  }

  return micros;
};

const parseCsv = (value: string | undefined): string[] =>
  value === undefined
    ? []
    : value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

const parseProofLevel = (value: string): BenchmarkProofLevel => {
  if (!proofLevels.has(value)) {
    throw new CliUsageError({
      code: "invalid_flag_value",
      message: "--min-proof-for-rewards is invalid.",
    });
  }

  return value as BenchmarkProofLevel;
};

const parsePrivacyClasses = (value: string): FoldPrivacyClass[] => {
  const classes = parseCsv(value);

  if (classes.length === 0 || classes.some((entry) => !privacyClasses.has(entry))) {
    throw new CliUsageError({
      code: "invalid_flag_value",
      message: "--privacy-classes is invalid.",
    });
  }

  return classes as FoldPrivacyClass[];
};
