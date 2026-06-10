import { withNextSteps } from "../command-payload.js";
import { daemonCall } from "../daemon-client.js";
import type { TechtreeWorkItem, TechtreeWorkListResponse } from "../internal-types/index.js";
import { getBooleanFlag, getFlag, parseIntegerFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { isHumanTerminal, printJson, printText } from "../printer.js";
import { renderTablePanel } from "../terminal/table.js";
import { parseWorkKind } from "../internal-runtime/workloads/work.js";

const WORK_SUMMARY_PAGE_SIZE = 10;

const renderWorkSummary = (
  items: readonly TechtreeWorkItem[],
  page: number,
  pageSize: number,
): string => {
  if (items.length === 0) {
    return "No work is available right now. Run `regents techtree work next --json` to check again.";
  }

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(Math.max(page, 1), totalPages);
  const start = (clampedPage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return [
    renderTablePanel(
      "AVAILABLE WORK",
      [{ header: "id" }, { header: "kind" }, { header: "title" }],
      pageItems.map((item) => ({ cells: [item.id, item.kind, item.title] })),
    ),
    `Page ${clampedPage} of ${totalPages} (${items.length} item${items.length === 1 ? "" : "s"}).`,
    totalPages > 1 && clampedPage < totalPages
      ? `Next: regents techtree work --page ${clampedPage + 1}`
      : "Next: regents techtree work accept --work-unit <id> --workspace-path ./work/<slug>",
  ].join("\n\n");
};

export async function runTechtreeWorkSummary(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const response = (await daemonCall(
    "techtree.work.list",
    {
      kind: parseWorkKind(getFlag(args, "kind")),
      limit: parseIntegerFlag(args, "limit"),
    },
    configPath,
  )) as TechtreeWorkListResponse;

  if (isHumanTerminal() && !getBooleanFlag(args, "json")) {
    const page = parseIntegerFlag(args, "page") ?? 1;
    printText(renderWorkSummary(response.data ?? [], page, WORK_SUMMARY_PAGE_SIZE));
    return;
  }

  printJson(withNextSteps(response, ["regents techtree work next --json"]));
}

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
