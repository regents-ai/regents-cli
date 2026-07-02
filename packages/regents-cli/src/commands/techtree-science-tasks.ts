import { parseOptionalNonNegativeIntegerFlag } from "../command-input.js";
import { daemonCall } from "../daemon-client.js";
import { getFlag, parseIntegerFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";

const parseNodeId = (value: string | undefined, name = "node id"): number => {
  const parsed = Number.parseInt(requireArg(value, name), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid ${name}`);
  }

  return parsed;
};

export async function runTechtreeScienceTasksList(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.list",
      {
        limit: parseIntegerFlag(args, "limit"),
        stage: getFlag(args, "stage"),
        science_domain: getFlag(args, "science-domain"),
        science_field: getFlag(args, "science-field"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceTasksGet(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.get",
      {
        id: parseNodeId(args.positionals[3], "science task id"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceTasksInit(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.init",
      {
        workspace_path: requireArg(getFlag(args, "workspace-path"), "--workspace-path"),
        title: getFlag(args, "title"),
        summary: getFlag(args, "summary"),
        science_domain: getFlag(args, "science-domain"),
        science_field: getFlag(args, "science-field"),
        task_slug: getFlag(args, "task-slug"),
        claimed_expert_time: getFlag(args, "claimed-expert-time"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceTasksChecklist(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.checklist",
      {
        workspace_path: requireArg(getFlag(args, "workspace-path"), "--workspace-path"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceTasksEvidence(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.evidence",
      {
        workspace_path: requireArg(getFlag(args, "workspace-path"), "--workspace-path"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceTasksExport(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.export",
      {
        workspace_path: requireArg(getFlag(args, "workspace-path"), "--workspace-path"),
        output_path: getFlag(args, "output-path"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceTasksSubmit(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.submit",
      {
        workspace_path: requireArg(getFlag(args, "workspace-path"), "--workspace-path"),
        harbor_pr_url: getFlag(args, "pr-url"),
        latest_review_follow_up_note: getFlag(args, "follow-up-note"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceTasksReviewUpdate(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.reviewUpdate",
      {
        workspace_path: requireArg(getFlag(args, "workspace-path"), "--workspace-path"),
        harbor_pr_url: getFlag(args, "pr-url"),
        latest_review_follow_up_note: getFlag(args, "follow-up-note"),
        open_reviewer_concerns_count: parseOptionalNonNegativeIntegerFlag(args, "open-reviewer-concerns-count"),
        any_concern_unanswered:
          getFlag(args, "any-concern-unanswered") === undefined
            ? undefined
            : getFlag(args, "any-concern-unanswered") === "true",
        latest_rerun_after_latest_fix:
          getFlag(args, "latest-rerun-after-latest-fix") === undefined
            ? undefined
            : getFlag(args, "latest-rerun-after-latest-fix") === "true",
        latest_fix_at: getFlag(args, "latest-fix-at"),
        last_rerun_at: getFlag(args, "last-rerun-at"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceTasksReviewLoop(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.reviewLoop",
      {
        workspace_path: requireArg(getFlag(args, "workspace-path"), "--workspace-path"),
        harbor_pr_url: requireArg(getFlag(args, "pr-url"), "--pr-url"),
        timeout_seconds: parseIntegerFlag(args, "timeout-seconds"),
      },
      configPath,
    ),
  );
}
