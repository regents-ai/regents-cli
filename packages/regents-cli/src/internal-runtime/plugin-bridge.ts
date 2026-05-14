import fs from "node:fs";
import path from "node:path";

import { expandHome } from "./paths.js";

export type RegentAgentRuntime = "hermes" | "openclaw";
export type RegentAgentRuntimeSelector = RegentAgentRuntime | "auto";

export interface PluginRuntimeStatus {
  runtime: RegentAgentRuntime;
  installed: boolean;
  pluginPath: string;
  skillsPath: string;
}

export interface PluginStatusReport {
  ok: true;
  runtimes: PluginRuntimeStatus[];
  selectedRuntime: RegentAgentRuntimeSelector;
}

export interface PluginInstallReport {
  ok: true;
  runtime: RegentAgentRuntime;
  pluginPath: string;
  skillsPath: string;
  files: string[];
}

export const REGENT_PLUGIN_TOOL_NAMES = [
  "regent_status",
  "regent_setup_status",
  "regent_runtime_start",
  "regent_runtime_stop",
  "regent_identity_ensure",
  "regent_agent_graph",
  "regent_work_next",
  "regent_work_accept",
  "regent_workspace_pair",
  "regent_benchmark_run",
  "regent_science_task_review_loop",
  "regent_notebook_publish",
  "regent_fold_status",
  "regent_fold_proof",
  "regent_budget_status",
  "regent_x402_pay_guarded",
  "regent_receipt_create",
  "regent_receipt_share_draft",
] as const;

const homePath = (...parts: string[]): string =>
  path.join(process.env.HOME ?? process.env.USERPROFILE ?? "~", ...parts);

const runtimePaths = (runtime: RegentAgentRuntime): { pluginPath: string; skillsPath: string } => {
  if (runtime === "hermes") {
    return {
      pluginPath: homePath(".hermes", "plugins", "regent"),
      skillsPath: homePath(".hermes", "plugins", "regent", "skills"),
    };
  }

  return {
    pluginPath: homePath(".openclaw", "plugins", "regent"),
    skillsPath: homePath(".openclaw", "plugins", "regent", "skills"),
  };
};

export const selectedRuntimes = (runtime: RegentAgentRuntimeSelector): RegentAgentRuntime[] =>
  runtime === "auto" ? ["hermes", "openclaw"] : [runtime];

export const pluginStatus = (runtime: RegentAgentRuntimeSelector = "auto"): PluginStatusReport => ({
  ok: true,
  selectedRuntime: runtime,
  runtimes: selectedRuntimes(runtime).map((entry) => {
    const paths = runtimePaths(entry);
    const pluginPath = path.resolve(expandHome(paths.pluginPath));
    const skillsPath = path.resolve(expandHome(paths.skillsPath));

    return {
      runtime: entry,
      installed: fs.existsSync(path.join(pluginPath, entry === "hermes" ? "plugin.yaml" : "openclaw.plugin.json")),
      pluginPath,
      skillsPath,
    };
  }),
});

export const installPlugin = (runtime: RegentAgentRuntime): PluginInstallReport => {
  const paths = runtimePaths(runtime);
  const pluginPath = path.resolve(expandHome(paths.pluginPath));
  const skillsPath = path.resolve(expandHome(paths.skillsPath));
  const files: string[] = [];

  fs.mkdirSync(skillsPath, { recursive: true });

  if (runtime === "hermes") {
    writeFile(path.join(pluginPath, "plugin.yaml"), hermesPluginYaml(), files);
    writeFile(path.join(pluginPath, "__init__.py"), hermesInitPy(), files);
    writeFile(path.join(pluginPath, "tools.py"), hermesToolsPy(), files);
  } else {
    writeFile(path.join(pluginPath, "openclaw.plugin.json"), openclawPluginJson(), files);
    writeFile(path.join(pluginPath, "index.js"), openclawIndexJs(), files);
  }

  for (const skill of regentSkills()) {
    writeFile(path.join(skillsPath, skill.name, "SKILL.md"), skill.body, files);
  }

  return { ok: true, runtime, pluginPath, skillsPath, files };
};

const writeFile = (filePath: string, body: string, files: string[]): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
  files.push(filePath);
};

const hermesPluginYaml = (): string => `name: regent
version: 0.3.0
description: Typed Regent bridge for Hermes
provides_tools:
  - regent_status
  - regent_setup_status
  - regent_runtime_start
  - regent_runtime_stop
  - regent_identity_ensure
  - regent_agent_graph
  - regent_work_next
  - regent_work_accept
  - regent_workspace_pair
  - regent_benchmark_run
  - regent_science_task_review_loop
  - regent_notebook_publish
  - regent_fold_status
  - regent_fold_proof
  - regent_budget_status
  - regent_x402_pay_guarded
  - regent_receipt_create
  - regent_receipt_share_draft
`;

const hermesInitPy = (): string => `from .tools import *  # noqa: F401,F403
`;

const hermesToolsPy = (): string => `"""Typed Regent bridge for Hermes.

This bridge exposes specific Regent actions. It does not accept raw shell,
raw regents command strings, raw awal, raw curl, or raw npx input.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any, Dict, List

REGENTS_BIN = "regents"

ALLOWED: Dict[str, List[str]] = {
    "regent_status": ["status", "--json"],
    "regent_setup_status": ["plugin", "status", "--runtime", "auto", "--json"],
    "regent_runtime_start": ["run", "--json"],
    "regent_runtime_stop": ["runtime", "status", "--json"],
    "regent_identity_ensure": ["identity", "ensure", "--json"],
    "regent_agent_graph": ["identity", "graph", "--json"],
    "regent_work_next": ["techtree", "work", "next", "--json"],
    "regent_work_accept": ["techtree", "work", "accept", "--json"],
    "regent_workspace_pair": ["techtree", "notebooks", "pair", "--json"],
    "regent_benchmark_run": ["techtree", "benchmarks", "run", "materialize", "--json"],
    "regent_science_task_review_loop": ["techtree", "science-tasks", "review-loop", "--json"],
    "regent_notebook_publish": ["techtree", "notebooks", "publish", "--json"],
    "regent_fold_status": ["techtree", "fold", "status", "--json"],
    "regent_fold_proof": ["techtree", "fold", "proof", "--json"],
    "regent_budget_status": ["budget", "status", "--json"],
    "regent_x402_pay_guarded": ["x402", "pay"],
    "regent_receipt_create": ["receipt", "create", "--json"],
    "regent_receipt_share_draft": ["receipt", "share-draft", "--json"],
}


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: Dict[str, Any] = {}
        for key, entry in value.items():
            lowered = str(key).lower()
            if any(part in lowered for part in ["secret", "private", "token", "otp", "payment", "header"]):
                redacted[key] = "[redacted]"
            else:
                redacted[key] = _redact(entry)
        return redacted
    if isinstance(value, list):
        return [_redact(entry) for entry in value]
    return value


def _run(argv: List[str]) -> Dict[str, Any]:
    if shutil.which(REGENTS_BIN) is None:
        return {"ok": False, "error": "Regents CLI is not installed. Run npm install -g @regentslabs/cli."}
    proc = subprocess.run([REGENTS_BIN, *argv], capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        return {"ok": False, "error": proc.stderr.strip() or proc.stdout.strip()}
    return _redact(json.loads(proc.stdout))


def _start(argv: List[str]) -> Dict[str, Any]:
    if shutil.which(REGENTS_BIN) is None:
        return {"ok": False, "error": "Regents CLI is not installed. Run npm install -g @regentslabs/cli."}
    proc = subprocess.Popen(
        [REGENTS_BIN, *argv],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return {"ok": True, "pid": proc.pid, "command": [REGENTS_BIN, *argv]}


def regent_status(_: Dict[str, Any] | None = None) -> Dict[str, Any]:
    return _run(ALLOWED["regent_status"])


def regent_setup_status(_: Dict[str, Any] | None = None) -> Dict[str, Any]:
    return _run(ALLOWED["regent_setup_status"])


def regent_runtime_start(params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    params = params or {}
    argv = list(ALLOWED["regent_runtime_start"])
    if params.get("mode") == "techtree_fold":
        argv.extend(["--fold", str(params.get("preset") or "autoresearch")])
    return _start(argv)


def regent_runtime_stop(_: Dict[str, Any] | None = None) -> Dict[str, Any]:
    return {"ok": False, "error": "Stop Regent from the terminal where regents run is active."}


def regent_identity_ensure(_: Dict[str, Any] | None = None) -> Dict[str, Any]:
    return _run(ALLOWED["regent_identity_ensure"])


def regent_agent_graph(_: Dict[str, Any] | None = None) -> Dict[str, Any]:
    return _run(ALLOWED["regent_agent_graph"])


def regent_work_next(params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    argv = list(ALLOWED["regent_work_next"])
    kind = (params or {}).get("kind")
    if kind:
        argv.extend(["--kind", str(kind)])
    return _run(argv)


def regent_work_accept(params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    params = params or {}
    argv = list(ALLOWED["regent_work_accept"])
    argv.extend(["--work-unit", str(params["work_unit"])])
    if params.get("workspace_path"):
        argv.extend(["--workspace-path", str(params["workspace_path"])])
    return _run(argv)


def regent_workspace_pair(params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    params = params or {}
    return _run([*ALLOWED["regent_workspace_pair"], "--workspace-path", str(params["workspace_path"])])


def regent_benchmark_run(params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    params = params or {}
    return _run([
        *ALLOWED["regent_benchmark_run"],
        "--capsule-id", str(params["capsule_id"]),
        "--workspace-path", str(params["workspace_path"]),
    ])


def regent_science_task_review_loop(params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    params = params or {}
    argv = [*ALLOWED["regent_science_task_review_loop"], "--workspace-path", str(params["workspace_path"])]
    if params.get("pr_url"):
        argv.extend(["--pr-url", str(params["pr_url"])])
    return _run(argv)


def regent_notebook_publish(params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    params = params or {}
    argv = [*ALLOWED["regent_notebook_publish"], "--workspace-path", str(params["workspace_path"])]
    if params.get("parent_id"):
        argv.extend(["--parent-id", str(params["parent_id"])])
    return _run(argv)


def regent_fold_status(_: Dict[str, Any] | None = None) -> Dict[str, Any]:
    return _run(ALLOWED["regent_fold_status"])


def regent_fold_proof(params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    params = params or {}
    return _run([*ALLOWED["regent_fold_proof"], "--attempt", str(params["attempt_id"])])


def regent_budget_status(params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    params = params or {}
    argv = list(ALLOWED["regent_budget_status"])
    if params.get("budget_id"):
        argv.extend(["--budget", str(params["budget_id"])])
    if params.get("agent_id"):
        argv.extend(["--agent", str(params["agent_id"])])
    return _run(argv)


def regent_x402_pay_guarded(params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    params = params or {}
    argv = [
        *ALLOWED["regent_x402_pay_guarded"],
        str(params["url"]),
        "--budget", str(params["budget_id"]),
        "--max-usdc", str(params["max_usdc"]),
        "--rail", str(params.get("rail") or "agentic-wallet"),
        "--json",
    ]
    if params.get("approve"):
        argv.append("--approve")
    if params.get("receipt"):
        argv.append("--receipt")
    return _run(argv)


def regent_receipt_create(params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    params = params or {}
    argv = list(ALLOWED["regent_receipt_create"])
    if params.get("attempt_id"):
        argv.extend(["--from-attempt", str(params["attempt_id"])])
    elif params.get("notebook_id"):
        argv.extend(["--from-notebook", str(params["notebook_id"])])
    elif params.get("x402_payment_id"):
        argv.extend(["--from-x402-payment", str(params["x402_payment_id"])])
    return _run(argv)


def regent_receipt_share_draft(params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    params = params or {}
    return _run([*ALLOWED["regent_receipt_share_draft"], "--receipt", str(params["receipt_id"])])
`;

const openclawPluginJson = (): string => `${JSON.stringify({
  name: "regent",
  version: "0.3.0",
  description: "Typed Regent bridge for OpenClaw",
  tools: [
    "regent_status",
    "regent_setup_status",
    "regent_runtime_start",
    "regent_runtime_stop",
    "regent_identity_ensure",
    "regent_agent_graph",
    "regent_work_next",
    "regent_work_accept",
    "regent_workspace_pair",
    "regent_benchmark_run",
    "regent_science_task_review_loop",
    "regent_notebook_publish",
    "regent_fold_status",
    "regent_fold_proof",
    "regent_budget_status",
    "regent_x402_pay_guarded",
    "regent_receipt_create",
    "regent_receipt_share_draft",
  ],
}, null, 2)}
`;

const openclawIndexJs = (): string => `export const tools = {
  regent_status: ["status", "--json"],
  regent_setup_status: ["plugin", "status", "--runtime", "auto", "--json"],
  regent_runtime_start: ["run", "--json"],
  regent_runtime_stop: ["runtime", "status", "--json"],
  regent_identity_ensure: ["identity", "ensure", "--json"],
  regent_agent_graph: ["identity", "graph", "--json"],
  regent_work_next: ["techtree", "work", "next", "--json"],
  regent_work_accept: ["techtree", "work", "accept", "--json"],
  regent_workspace_pair: ["techtree", "notebooks", "pair", "--json"],
  regent_benchmark_run: ["techtree", "benchmarks", "run", "materialize", "--json"],
  regent_science_task_review_loop: ["techtree", "science-tasks", "review-loop", "--json"],
  regent_notebook_publish: ["techtree", "notebooks", "publish", "--json"],
  regent_fold_status: ["techtree", "fold", "status", "--json"],
  regent_fold_proof: ["techtree", "fold", "proof", "--json"],
  regent_budget_status: ["budget", "status", "--json"],
  regent_x402_pay_guarded: ["x402", "pay"],
  regent_receipt_create: ["receipt", "create", "--json"],
  regent_receipt_share_draft: ["receipt", "share-draft", "--json"],
};
`;

const regentSkills = (): Array<{ name: string; body: string }> => [
  {
    name: "regent-runtime",
    body: `# Regent Runtime

Use Regent plugin tools. Do not run raw shell, raw regents, raw awal, raw curl, or raw npx.
Start with regent_setup_status, then regent_runtime_start, then regent_work_next.
`,
  },
  {
    name: "regent-techtree-fold",
    body: `# Regent Techtree Fold

Use regent_fold_status and regent_fold_proof. Fold reports on existing Techtree attempts, notebooks, receipts, and verifier evidence.
Do not claim a new certificate unless Techtree returns that evidence.
`,
  },
  {
    name: "regent-techtree-work",
    body: `# Regent Techtree Work

Use regent_work_next, regent_work_accept, regent_workspace_pair, regent_benchmark_run, regent_science_task_review_loop, and regent_notebook_publish.
Do not create work claims without a Regent receipt or Techtree evidence reference.
`,
  },
  {
    name: "regent-notebooks",
    body: `# Regent Notebooks

Use Regent notebook tools to create, pair, and publish marimo notebooks.
Keep paper notebooks tied to their arXiv or alphaXiv source when available.
`,
  },
  {
    name: "regent-wallet-budget",
    body: `# Regent Wallet Budget

Use Regent budget tools for spend checks. Do not call raw AWAL, raw wallet commands, or payment commands.
Budgets are Regent policy for this runtime, not a place to keep funds.
`,
  },
  {
    name: "regent-x402",
    body: `# Regent x402

Use regent_x402_pay_guarded for paid calls. Every payment needs a budget id and max USDC amount.
Do not bypass Regent budgets with raw curl, raw npx, raw AWAL, or raw shell.
`,
  },
  {
    name: "regent-receipts",
    body: `# Regent Receipts

Use regent_receipt_create and regent_receipt_share_draft after Techtree or x402 work.
Share copy is a draft. Do not claim revenue unless the receipt proves recognized revenue.
`,
  },
];
