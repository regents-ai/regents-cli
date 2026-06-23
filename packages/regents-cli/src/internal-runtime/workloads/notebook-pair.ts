import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  AutoskillNotebookPairResponse,
  BbhNotebookPairResponse,
  NotebookPairInstructions,
  NotebookPairSkillStatus,
} from "../../internal-types/index.js";
import { buildSafeSubprocessEnv } from "../safe-subprocess-env.js";

const execFileAsync = promisify(execFile);

const MARIMO_PAIR_SKILL = "marimo-pair";

interface InstalledSkillEntry {
  name?: string;
  scope?: string;
  agents?: string[];
}

interface NotebookPairDeps {
  listInstalledSkills?: (workspacePath: string) => Promise<InstalledSkillEntry[]>;
}

const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const requireFile = async (workspacePath: string, relativePath: string): Promise<void> => {
  if (!(await fileExists(path.join(workspacePath, relativePath)))) {
    throw new Error(`missing required workspace file: ${relativePath}`);
  }
};

const installCommands = [
  "npx skills add marimo-team/marimo-pair",
  "npx skills upgrade marimo-team/marimo-pair",
  "uvx deno -A npm:skills add marimo-team/marimo-pair",
];

const listInstalledSkills = async (workspacePath: string): Promise<InstalledSkillEntry[]> => {
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const commands: Array<{ command: string; args: string[]; scope: "project" | "global" }> = [
    { command: "npx", args: ["-y", "skills", "ls", "--json"], scope: "project" },
    { command: "npx", args: ["-y", "skills", "ls", "-g", "--json"], scope: "global" },
    { command: "uvx", args: ["deno", "-A", "npm:skills", "ls", "--json"], scope: "project" },
    { command: "uvx", args: ["deno", "-A", "npm:skills", "ls", "-g", "--json"], scope: "global" },
  ];

  const collected: InstalledSkillEntry[] = [];
  let succeeded = false;
  let lastFailureReason: string | undefined;

  for (const command of commands) {
    try {
      const { stdout } = await execFileAsync(command.command, command.args, {
        cwd: resolvedWorkspacePath,
        env: buildSafeSubprocessEnv(),
        maxBuffer: 1024 * 1024,
      });
      succeeded = true;
      const parsed = JSON.parse(stdout) as InstalledSkillEntry[];
      for (const entry of parsed) {
        collected.push({
          ...entry,
          scope: entry.scope === "global" ? "global" : command.scope,
        });
      }
    } catch (error) {
      lastFailureReason =
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : String(error);
      continue;
    }
  }

  if (!succeeded) {
    throw new Error(
      lastFailureReason
        ? `unable to inspect installed Agent Skills: ${lastFailureReason}; install \`npx\` or \`uv\` and rerun this command`
        : "unable to inspect installed Agent Skills; install `npx` or `uv` and rerun this command",
    );
  }

  return collected;
};

const marimoPairStatusFromEntries = (entries: InstalledSkillEntry[]): NotebookPairSkillStatus => {
  const matches = entries.filter((entry) => entry.name === MARIMO_PAIR_SKILL);
  const scopes = Array.from(
    new Set(
      matches
        .map((entry) => entry.scope)
        .filter((value): value is "project" | "global" => value === "project" || value === "global"),
    ),
  );
  const agents = Array.from(
    new Set(
      matches
        .flatMap((entry) => (Array.isArray(entry.agents) ? entry.agents : []))
        .filter((value): value is string => typeof value === "string" && value.trim() !== ""),
    ),
  ).sort();

  return {
    skill_name: MARIMO_PAIR_SKILL,
    installed: matches.length > 0,
    scopes,
    agents,
    install_commands: installCommands,
  };
};

const assertMarimoPairInstalled = (status: NotebookPairSkillStatus): void => {
  if (!status.installed) {
    throw new Error(
      `marimo-pair is not installed; run \`${status.install_commands[0]}\` before pairing this notebook`,
    );
  }
};

const bbhInstructions = (workspacePath: string): NotebookPairInstructions => ({
  recommended_default: "Use the Techtree CLI skill with an OpenAI plan on GPT-5.4 high effort.",
  techtree_skill: "techtree-bbh-workspace",
  hermes_prompt: [
    "Use the installed skills `techtree-bbh-workspace` and `marimo-pair`.",
    `Work only inside the BBH workspace at ${workspacePath}.`,
    "Open and edit `analysis.py` in marimo, keep all changes inside `analysis.py`, `final_answer.md`, and `outputs/**`, then stop.",
  ].join(" "),
  openclaw_prompt: [
    "Use the installed skills `techtree-bbh-workspace` and `marimo-pair`.",
    `Work only inside the BBH workspace at ${workspacePath}.`,
    "Open and edit `analysis.py` in marimo, keep all changes inside `analysis.py`, `final_answer.md`, and `outputs/**`, then stop.",
  ].join(" "),
  next_regent_commands: [
    `regents techtree bbh submit ${workspacePath}`,
    `regents techtree bbh validate ${workspacePath}`,
  ],
});

const autoskillInstructions = (
  workspacePath: string,
  workspaceKind: "skill" | "eval",
): NotebookPairInstructions => ({
  recommended_default: "Use the Techtree CLI skill with an OpenAI plan on GPT-5.4 high effort.",
  techtree_skill: "techtree-autoskill-workspace",
  hermes_prompt: [
    "Use the installed skills `techtree-autoskill-workspace` and `marimo-pair`.",
    `Work only inside the ${workspaceKind} workspace at ${workspacePath}.`,
    "Open and edit `session.marimo.py`, keep changes inside the allowed workspace files, then stop with a clear file summary.",
  ].join(" "),
  openclaw_prompt: [
    "Use the installed skills `techtree-autoskill-workspace` and `marimo-pair`.",
    `Work only inside the ${workspaceKind} workspace at ${workspacePath}.`,
    "Open and edit `session.marimo.py`, keep changes inside the allowed workspace files, then stop with a clear file summary.",
  ].join(" "),
  next_regent_commands:
    workspaceKind === "skill"
      ? [
          `regents techtree autoskill publish skill ${workspacePath}`,
          "regents techtree autoskill review --kind community --skill-node-id <node-id>",
        ]
      : [
          `regents techtree autoskill publish eval ${workspacePath}`,
          "regents techtree autoskill publish result <workspace> --skill-node-id <node-id> --eval-node-id <node-id>",
        ],
});

export const prepareBbhNotebookPair = async (
  workspacePath: string,
  deps?: NotebookPairDeps,
): Promise<BbhNotebookPairResponse> => {
  const resolved = path.resolve(workspacePath);
  for (const required of [
    "genome.source.yaml",
    "run.source.yaml",
    "search.config.yaml",
    "task.json",
    "protocol.md",
    "rubric.json",
    "analysis.py",
    "final_answer.md",
    "outputs/verdict.json",
  ]) {
    await requireFile(resolved, required);
  }

  const status = marimoPairStatusFromEntries(
    await (deps?.listInstalledSkills ?? listInstalledSkills)(resolved),
  );
  assertMarimoPairInstalled(status);

  return {
    ok: true,
    entrypoint: "bbh.notebook.pair",
    workspace_path: resolved,
    notebook_path: path.join(resolved, "analysis.py"),
    launch_argv: ["uvx", "marimo", "edit", "analysis.py"],
    marimo_pair: status,
    instructions: bbhInstructions(resolved),
  };
};

export const prepareAutoskillNotebookPair = async (
  workspacePath: string,
  deps?: NotebookPairDeps,
): Promise<AutoskillNotebookPairResponse> => {
  const resolved = path.resolve(workspacePath);
  await requireFile(resolved, "session.marimo.py");

  const hasSkillManifest = await fileExists(path.join(resolved, "manifest.yaml"));
  const hasEvalManifest = await fileExists(path.join(resolved, "scenario.yaml"));

  if (hasSkillManifest === hasEvalManifest) {
    throw new Error("autoskill workspace must contain exactly one of `manifest.yaml` or `scenario.yaml`");
  }

  const workspaceKind = hasSkillManifest ? "skill" : "eval";
  if (workspaceKind === "skill") {
    await requireFile(resolved, "SKILL.md");
  } else {
    await requireFile(resolved, "README.md");
  }

  const status = marimoPairStatusFromEntries(
    await (deps?.listInstalledSkills ?? listInstalledSkills)(resolved),
  );
  assertMarimoPairInstalled(status);

  return {
    ok: true,
    entrypoint: "autoskill.notebook.pair",
    workspace_path: resolved,
    workspace_kind: workspaceKind,
    notebook_path: path.join(resolved, "session.marimo.py"),
    launch_argv: ["uvx", "marimo", "edit", "session.marimo.py"],
    marimo_pair: status,
    instructions: autoskillInstructions(resolved, workspaceKind),
  };
};
