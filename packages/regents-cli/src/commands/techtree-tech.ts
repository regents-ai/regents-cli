import fs from "node:fs";

import { CliUsageError } from "../cli-usage-error.js";
import {
  parseOptionalNonNegativeIntegerFlag,
  parseRequiredNonNegativeIntegerFlag,
} from "../command-input.js";
import { daemonCall } from "../daemon-client.js";
import {
  getBooleanFlag,
  getFlag,
  parseIntegerFlag,
  requireArg,
  type ParsedCliArgs,
} from "../parse.js";
import { printJson } from "../printer.js";
import type { TechRewardLane, TechRewardRootPrepareInput } from "../internal-types/index.js";

const readAtPathValue = (value: string): string => {
  if (!value.startsWith("@")) {
    return value;
  }

  return fs.readFileSync(value.slice(1), "utf8");
};

const readJsonObjectFlag = (args: ParsedCliArgs, name: string): Record<string, unknown> => {
  const raw = readAtPathValue(requireArg(getFlag(args, name), `--${name}`));

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }

    return parsed as Record<string, unknown>;
  } catch {
    throw new CliUsageError({
      code: "invalid_flag_value",
      message: `--${name} must be a JSON object or @path to one.`,
    });
  }
};

const requireBasisPointsFlag = (args: ParsedCliArgs, name: string): number => {
  const value = parseRequiredNonNegativeIntegerFlag(args, name);
  if (value > 10_000) {
    throw new CliUsageError({
      code: "invalid_flag_value",
      message: `--${name} must be between 0 and 10000.`,
    });
  }

  return value;
};

const requireRewardLane = (args: ParsedCliArgs): TechRewardLane => {
  const lane = requireArg(getFlag(args, "lane"), "--lane");
  if (lane === "science" || lane === "usdc_input") {
    return lane;
  }

  throw new CliUsageError({
    code: "invalid_flag_value",
    message: "--lane must be science or usdc_input.",
  });
};

const requireHexAddressFlag = (args: ParsedCliArgs, name: string): `0x${string}` => {
  const value = requireArg(getFlag(args, name), `--${name}`);
  if (/^0x[a-fA-F0-9]{40}$/u.test(value)) {
    return value as `0x${string}`;
  }

  throw new CliUsageError({
    code: "invalid_flag_value",
    message: `--${name} must be a 20-byte hex address.`,
  });
};

const requireBytes32Flag = (args: ParsedCliArgs, name: string): `0x${string}` => {
  const value = requireArg(getFlag(args, name), `--${name}`);
  if (/^0x[a-fA-F0-9]{64}$/u.test(value)) {
    return value as `0x${string}`;
  }

  throw new CliUsageError({
    code: "invalid_flag_value",
    message: `--${name} must be a 32-byte hex value.`,
  });
};

const requireTxHashFlag = (args: ParsedCliArgs, name: string): `0x${string}` => {
  const value = requireArg(getFlag(args, name), `--${name}`);
  if (/^0x[a-fA-F0-9]{64}$/u.test(value)) {
    return value as `0x${string}`;
  }

  throw new CliUsageError({
    code: "invalid_flag_value",
    message: `--${name} must be a transaction hash.`,
  });
};

export async function runTechtreeTechStatus(_args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.tech.status", undefined, configPath));
}

export async function runTechtreeTechEpochCurrent(_args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.tech.epochs.current", undefined, configPath));
}

export async function runTechtreeTechLeaderboardsList(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.tech.leaderboards.list",
      {
        status: getFlag(args, "status"),
        limit: parseIntegerFlag(args, "limit"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeTechLeaderboardsRegister(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.tech.leaderboards.register",
      {
        leaderboard_id: requireArg(getFlag(args, "leaderboard-id"), "--leaderboard-id"),
        kind: requireArg(getFlag(args, "kind"), "--kind"),
        title: requireArg(getFlag(args, "title"), "--title"),
        weight_bps: requireBasisPointsFlag(args, "weight-bps"),
        starts_epoch: parseOptionalNonNegativeIntegerFlag(args, "starts-epoch"),
        ends_epoch: parseOptionalNonNegativeIntegerFlag(args, "ends-epoch"),
        config_hash: requireBytes32Flag(args, "config-hash"),
        uri: requireArg(getFlag(args, "uri"), "--uri"),
        active: getBooleanFlag(args, "inactive") ? false : undefined,
      },
      configPath,
    ),
  );
}

export async function runTechtreeTechLeaderboardsConfirm(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.tech.leaderboards.confirm",
      {
        leaderboard_id: requireArg(getFlag(args, "leaderboard-id"), "--leaderboard-id"),
        tx_hash: requireTxHashFlag(args, "tx-hash"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeTechRewardsList(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.tech.rewards.list",
      {
        epoch: parseOptionalNonNegativeIntegerFlag(args, "epoch"),
        lane: getFlag(args, "lane"),
        limit: parseIntegerFlag(args, "limit"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeTechRewardsProof(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.tech.rewards.proof",
      {
        epoch: parseRequiredNonNegativeIntegerFlag(args, "epoch"),
        lane: requireRewardLane(args),
        agent_id: requireArg(getFlag(args, "agent-id"), "--agent-id"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeTechRewardsClaim(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.tech.rewards.claim",
      {
        epoch: parseRequiredNonNegativeIntegerFlag(args, "epoch"),
        lane: requireRewardLane(args),
        agent_id: requireArg(getFlag(args, "agent-id"), "--agent-id"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeTechRewardsRootPrepare(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.tech.rewards.root.prepare",
      readJsonObjectFlag(args, "input") as unknown as TechRewardRootPrepareInput,
      configPath,
    ),
  );
}

export async function runTechtreeTechRewardsRootConfirm(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.tech.rewards.root.confirm",
      {
        manifest_id: requireArg(getFlag(args, "manifest-id"), "--manifest-id"),
        tx_hash: requireTxHashFlag(args, "tx-hash"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeTechWithdraw(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.tech.withdraw",
      {
        agent_id: requireArg(getFlag(args, "agent-id"), "--agent-id"),
        amount: requireArg(getFlag(args, "amount"), "--amount"),
        tech_recipient: requireHexAddressFlag(args, "tech-recipient"),
      },
      configPath,
    ),
  );
}
