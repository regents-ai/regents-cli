import { daemonCall } from "../daemon-client.js";
import { getFlag, parseIntegerFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";
import { parseWorkKind } from "../internal-runtime/workloads/work.js";

const withNextSteps = <T>(payload: T, nextSteps: readonly string[]): T & { next_steps: readonly string[] } => ({
  ...(payload as Record<string, unknown>),
  next_steps: nextSteps,
}) as T & { next_steps: readonly string[] };

export async function runTechtreeWorkList(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    withNextSteps(await daemonCall(
      "techtree.work.list",
      {
        kind: parseWorkKind(getFlag(args, "kind")),
        limit: parseIntegerFlag(args, "limit"),
      },
      configPath,
    ), ["regents techtree work next --json"]),
  );
}

export async function runTechtreeWorkNext(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    withNextSteps(await daemonCall(
      "techtree.work.next",
      {
        kind: parseWorkKind(getFlag(args, "kind")),
      },
      configPath,
    ), ["regents techtree work accept --work-unit <id> --workspace-path ./work/<slug>"]),
  );
}

export async function runTechtreeWorkAccept(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const workspacePath = getFlag(args, "workspace-path");
  printJson(
    withNextSteps(await daemonCall(
      "techtree.work.accept",
      {
        work_unit: requireArg(getFlag(args, "work-unit"), "--work-unit"),
        workspace_path: workspacePath,
      },
      configPath,
    ), [workspacePath ? `regents techtree work publish --workspace-path ${workspacePath}` : "regents techtree work accept --work-unit <id> --workspace-path ./work/<slug>"]),
  );
}

export async function runTechtreeWorkPublish(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const workspacePath = requireArg(getFlag(args, "workspace-path"), "--workspace-path");
  printJson(
    withNextSteps(await daemonCall(
      "techtree.work.publish",
      {
        workspace_path: workspacePath,
      },
      configPath,
    ), ["regents receipt create --from-notebook <node-id> --json"]),
  );
}
