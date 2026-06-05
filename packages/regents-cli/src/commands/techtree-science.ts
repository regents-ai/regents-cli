import { daemonCall } from "../daemon-client.js";
import {
  getBooleanFlag,
  getFlag,
  parseIntegerFlag,
  requireArg,
  requirePositional,
  type ParsedCliArgs,
} from "../parse.js";
import { printJson } from "../printer.js";

export async function runTechtreeScienceSetGoal(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.science.setGoal",
      {
        task: requireArg(getFlag(args, "task"), "--task"),
        agent: getFlag(args, "agent"),
        model: getFlag(args, "model"),
        env: getFlag(args, "env"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceRun(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.science.run",
      {
        task: getFlag(args, "task"),
        agent: getFlag(args, "agent"),
        model: getFlag(args, "model"),
        env: getFlag(args, "env"),
        run_dir: getFlag(args, "run-dir"),
        timeout_seconds: parseIntegerFlag(args, "timeout-seconds"),
        publish_run: getBooleanFlag(args, "publish-run") || undefined,
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceAgentSet(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.science.agent.set",
      {
        agent: requirePositional(args, 4, "agent"),
      },
      configPath,
    ),
  );
}
