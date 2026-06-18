import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import type { AutoskillSkillPublishRequest, NodeCreateResponse } from "../internal-types/index.js";

import { daemonCall } from "../daemon-client.js";
import { productBaseUrl } from "../internal-runtime/product-http-client.js";
import { buildSignerBackedAgentHeaders } from "../internal-runtime/siwa/signing.js";
import { resolveAuthenticatedAgentSigningContext } from "../internal-runtime/techtree/auth.js";
import { resolveTechtreeCoreDir } from "../internal-runtime/techtree/core.js";
import { getBooleanFlag, getFlag, parsePositiveInteger, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";
import { loadAgentAuthState } from "./agent-auth.js";

const CAPSULE_LIST_LIMIT = 200;
const SKILL_OPT_PATH_PREFIX = "/api/techtree/v1/agent/skill-opt/";

export interface SkillOptCapsuleRef {
  capsule_id: string;
  version_id: string;
}

export interface SkillOptStepVerdict {
  step_id: string;
  run_id: string;
  round: number;
  accepted: boolean;
  val_solve_rate_before: number | null;
  val_solve_rate_after: number | null;
  train_solve_rate: number | null;
}

export interface SkillOptEngineStep {
  round: number;
  accepted: boolean;
  edit_count: number;
  published_node_id: string | null;
  verdict: SkillOptStepVerdict;
}

export interface SkillOptEngineReport {
  run_id: string;
  family_ref: string;
  train_version_ids: string[];
  val_version_ids: string[];
  improved: boolean;
  best_skill_md: string;
  skipped_rounds: number[];
  steps: SkillOptEngineStep[];
  publish_intents: {
    skill_versions: Array<{ verdict: SkillOptStepVerdict; skill_md: string }>;
    null_results: Array<{ verdict: SkillOptStepVerdict }>;
  };
}

export const parseValFraction = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    throw new Error("invalid --val-fraction: expected a number between 0 and 1 (exclusive)");
  }

  return parsed;
};

export const resolveSkillOptCapsuleSet = async (
  familyRef: string,
  configPath?: string,
): Promise<SkillOptCapsuleRef[]> => {
  const response = await daemonCall(
    "techtree.benchmarks.capsules.list",
    { limit: CAPSULE_LIST_LIMIT },
    configPath,
  );
  const matching = response.data.filter((capsule) => capsule.family_ref === familyRef);
  if (matching.length === 0) {
    throw new Error(`no benchmark capsules found for capsule set ${familyRef}`);
  }

  const withoutVersion = matching.filter((capsule) => !capsule.current_version_id);
  if (withoutVersion.length > 0) {
    throw new Error(
      `capsule set ${familyRef} has capsules without a published version: ` +
        withoutVersion.map((capsule) => capsule.capsule_id).join(", "),
    );
  }

  const capsules = matching.map((capsule) => ({
    capsule_id: capsule.capsule_id,
    version_id: capsule.current_version_id as string,
  }));
  if (capsules.length < 2) {
    throw new Error(
      `capsule set ${familyRef} needs at least 2 capsules with published versions to commit a train/val split`,
    );
  }

  return capsules;
};

export type SkillOptHeaderSigner = (input: {
  method: string;
  path: string;
  body: string;
}) => Promise<Record<string, string>>;

export const createSkillOptRequestSigner = async (
  configPath?: string,
): Promise<{ techtreeBaseUrl: string; signHeaders: SkillOptHeaderSigner }> => {
  const { config, stateStore, sessionStore } = loadAgentAuthState(configPath);
  const { session, identity, signer } = await resolveAuthenticatedAgentSigningContext(
    config,
    sessionStore,
    stateStore,
  );
  const registryAddress = identity.registryAddress;
  const tokenId = identity.tokenId;
  if (!registryAddress || !tokenId) {
    throw new Error("This command needs a saved Agent account. Run `regents identity ensure` first.");
  }

  return {
    techtreeBaseUrl: productBaseUrl(config, "techtree"),
    signHeaders: ({ method, path: requestPath, body }) =>
      buildSignerBackedAgentHeaders({
        method,
        path: requestPath,
        body,
        walletAddress: identity.walletAddress,
        chainId: identity.chainId,
        registryAddress,
        tokenId,
        receipt: session.receipt,
        signMessage: signer.signMessage,
      }),
  };
};

export interface SkillOptSigningProxy {
  baseUrl: string;
  close(): Promise<void>;
}

/**
 * Local forwarder for the optimization engine's skill-opt requests.
 *
 * SIWA agent headers are signed per request over the method, path, and body
 * digest, and expire after a couple of minutes, so a long-running engine
 * subprocess cannot reuse one static header set. The engine targets this
 * loopback address via REGENT_TECHTREE_BASE_URL; each request is re-signed
 * here and forwarded to the Techtree API.
 */
export const startSkillOptSigningProxy = async (options: {
  upstreamBaseUrl: string;
  signHeaders: SkillOptHeaderSigner;
  fetchImpl?: typeof fetch;
}): Promise<SkillOptSigningProxy> => {
  const fetchImpl = options.fetchImpl ?? fetch;

  const handleRequest = async (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> => {
    const method = (request.method ?? "GET").toUpperCase();
    const requestPath = request.url ?? "/";
    if (method !== "POST" || !requestPath.startsWith(SKILL_OPT_PATH_PREFIX)) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error: { message: "only skill-opt agent requests are supported" } }),
      );
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    const body = Buffer.concat(chunks).toString("utf8");

    const signedHeaders = await options.signHeaders({ method, path: requestPath, body });
    const upstream = await fetchImpl(`${options.upstreamBaseUrl}${requestPath}`, {
      method,
      headers: {
        ...signedHeaders,
        "content-type": "application/json",
      },
      body,
    });
    const upstreamBody = await upstream.text();
    response.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    });
    response.end(upstreamBody);
  };

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "request forwarding failed";
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message } }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

export const runSkillOptEngine = async (input: {
  coreDir: string;
  engineConfig: Record<string, unknown>;
  env: Record<string, string>;
}): Promise<SkillOptEngineReport> =>
  new Promise<SkillOptEngineReport>((resolvePromise, rejectPromise) => {
    const child = spawn(
      "uv",
      ["run", "--directory", input.coreDir, "python", "-m", "techtree_core.skillopt", "--config", "-"],
      {
        env: { ...process.env, ...input.env },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      process.stderr.write(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`skill optimization engine exited with code ${code ?? -1}`));
        return;
      }

      try {
        resolvePromise(JSON.parse(stdout) as SkillOptEngineReport);
      } catch {
        rejectPromise(
          new Error(`skill optimization engine returned invalid JSON output: ${stdout.trim().slice(0, 500)}`),
        );
      }
    });

    child.stdin.write(JSON.stringify(input.engineConfig));
    child.stdin.end();
  });

const PUBLISH_MARIMO_ENTRYPOINT = "session.marimo.py";
const PUBLISH_STAGING_EXCLUDES = new Set([".skillopt", ".git", "node_modules", "dist", "SKILL.optimized.md"]);

const formatSolveRate = (value: number | null): string =>
  value === null ? "unknown" : value.toFixed(3);

/**
 * Copies the skill workspace into a staging folder under `.skillopt/publish/`
 * and replaces SKILL.md with the gate-accepted markdown, so the existing
 * autoskill publish flow can bundle it without mutating the user's workspace.
 */
export const stageSkillOptPublishWorkspace = (input: {
  workspacePath: string;
  runId: string;
  skillMd: string;
}): string => {
  const stagingDir = path.join(input.workspacePath, ".skillopt", "publish", input.runId);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  for (const entry of fs.readdirSync(input.workspacePath)) {
    if (PUBLISH_STAGING_EXCLUDES.has(entry)) {
      continue;
    }

    fs.cpSync(path.join(input.workspacePath, entry), path.join(stagingDir, entry), {
      recursive: true,
      filter: (source) => !PUBLISH_STAGING_EXCLUDES.has(path.basename(source)),
    });
  }

  fs.writeFileSync(path.join(stagingDir, "SKILL.md"), input.skillMd);
  return stagingDir;
};

/**
 * Marimo notebook source for a published null_result node. The cells render
 * only facts the engine actually produced: the run/step identity and the
 * server-computed held-out verdict that rejected the candidate.
 */
export const buildNullResultNotebookSource = (input: {
  skillSlug: string;
  capsuleSet: string;
  verdict: SkillOptStepVerdict;
}): string => {
  const verdictJson = JSON.stringify(
    {
      run_id: input.verdict.run_id,
      step_id: input.verdict.step_id,
      round: input.verdict.round,
      accepted: input.verdict.accepted,
      val_solve_rate_before: input.verdict.val_solve_rate_before,
      val_solve_rate_after: input.verdict.val_solve_rate_after,
      train_solve_rate: input.verdict.train_solve_rate,
    },
    null,
    2,
  );

  return `import marimo as mo

app = mo.App()


@app.cell
def _():
    import json

    verdict = json.loads(
        r"""
${verdictJson}
"""
    )
    return (verdict,)


@app.cell
def _(verdict):
    import marimo as mo

    mo.md(
        f"""
# Null result: ${input.skillSlug} (round {verdict["round"]})

A candidate edit of the **${input.skillSlug}** skill against the
**${input.capsuleSet}** benchmark capsule set was rejected by the server's
held-out validation gate.

- Optimization run: {verdict["run_id"]}
- Step: {verdict["step_id"]}
- Held-out solve rate before: {verdict["val_solve_rate_before"]}
- Held-out solve rate after: {verdict["val_solve_rate_after"]}
- Train solve rate: {verdict["train_solve_rate"]}
"""
    )
    return


if __name__ == "__main__":
    app.run()
`;
};

export async function runTechtreeSkillsOptimize(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const familyRef = requireArg(getFlag(args, "capsule-set"), "--capsule-set");
  const workspacePath = path.resolve(getFlag(args, "workspace") ?? process.cwd());
  const skillSlug = requireArg(getFlag(args, "skill-slug"), "--skill-slug");
  const valFraction = parseValFraction(requireArg(getFlag(args, "val-fraction"), "--val-fraction"));
  const rounds = parsePositiveInteger(requireArg(getFlag(args, "rounds"), "--rounds"), "invalid --rounds");
  const frozenHarnessBase = requireArg(getFlag(args, "frozen-harness-base"), "--frozen-harness-base");
  const budgetTokens = parsePositiveInteger(
    requireArg(getFlag(args, "budget-tokens"), "--budget-tokens"),
    "invalid --budget-tokens",
  );
  const publish = getBooleanFlag(args, "publish");
  const publishNullResults = getBooleanFlag(args, "publish-null-results");
  const seed = getFlag(args, "seed");
  const skillVersion = getFlag(args, "skill-version") ?? "0.1.0";
  if (publishNullResults && !seed) {
    throw new Error(
      "missing required argument: --seed (seed tree for published null-result nodes; needed with --publish-null-results)",
    );
  }

  const skillPath = path.join(workspacePath, "SKILL.md");
  if (!fs.existsSync(skillPath)) {
    throw new Error(
      `no SKILL.md found in ${workspacePath}; run \`regents techtree autoskill init skill\` first`,
    );
  }

  if (publish && !fs.existsSync(path.join(workspacePath, PUBLISH_MARIMO_ENTRYPOINT))) {
    throw new Error(
      `no ${PUBLISH_MARIMO_ENTRYPOINT} found in ${workspacePath}; --publish bundles the full workspace ` +
        "through the autoskill publish flow — run `regents techtree autoskill init skill` first",
    );
  }

  const capsules = await resolveSkillOptCapsuleSet(familyRef, configPath);
  const { techtreeBaseUrl, signHeaders } = await createSkillOptRequestSigner(configPath);
  const proxy = await startSkillOptSigningProxy({ upstreamBaseUrl: techtreeBaseUrl, signHeaders });

  try {
    const coreDir = await resolveTechtreeCoreDir();
    const runsRoot = path.join(workspacePath, ".skillopt", "runs");
    fs.mkdirSync(runsRoot, { recursive: true });

    const report = await runSkillOptEngine({
      coreDir,
      engineConfig: {
        family_ref: familyRef,
        capsules,
        val_fraction: valFraction,
        rounds,
        budget_tokens: budgetTokens,
        frozen_harness_base: { harness_id: frozenHarnessBase },
        skill_slug: skillSlug,
        skill_path: skillPath,
        workspace_root: runsRoot,
      },
      env: {
        REGENT_TECHTREE_BASE_URL: proxy.baseUrl,
        REGENT_TECHTREE_AGENT_HEADERS: "{}",
      },
    });

    const optimizedSkillPath = path.join(workspacePath, "SKILL.optimized.md");
    if (report.improved) {
      fs.writeFileSync(optimizedSkillPath, report.best_skill_md);
    }

    let publishedSkillVersion: {
      node_id: number;
      skill_slug: string;
      skill_version: string;
      bundle_hash: string;
      staged_workspace_path: string;
      step_id?: string;
      round?: number;
    } | null = null;
    if (publish && report.improved) {
      const acceptedIntent = report.publish_intents.skill_versions.at(-1);
      const verdict = acceptedIntent?.verdict;
      const stagingDir = stageSkillOptPublishWorkspace({
        workspacePath,
        runId: report.run_id,
        skillMd: acceptedIntent?.skill_md ?? report.best_skill_md,
      });
      const publishInput: AutoskillSkillPublishRequest = {
        title: skillSlug,
        skill_slug: skillSlug,
        skill_version: skillVersion,
        access_mode: "public_free",
        marimo_entrypoint: PUBLISH_MARIMO_ENTRYPOINT,
        primary_file: "SKILL.md",
        ...(verdict
          ? {
              summary:
                `Accepted by skill-opt run ${verdict.run_id} (round ${verdict.round}) on capsule set ` +
                `${familyRef}: held-out solve rate ${formatSolveRate(verdict.val_solve_rate_before)} -> ` +
                `${formatSolveRate(verdict.val_solve_rate_after)}.`,
            }
          : {}),
      };
      const publishResponse = await daemonCall(
        "techtree.autoskill.publishSkill",
        { workspace_path: stagingDir, input: publishInput },
        configPath,
      );
      publishedSkillVersion = {
        node_id: publishResponse.data.node_id,
        skill_slug: skillSlug,
        skill_version: skillVersion,
        bundle_hash: publishResponse.bundle_hash,
        staged_workspace_path: stagingDir,
        ...(verdict ? { step_id: verdict.step_id, round: verdict.round } : {}),
      };
    }

    const publishedNullResults: Array<{ node_id: number; step_id: string; round: number }> = [];
    if (publishNullResults) {
      for (const intent of report.publish_intents.null_results) {
        const verdict = intent.verdict;
        const created: NodeCreateResponse = await daemonCall(
          "techtree.nodes.create",
          {
            seed: seed as string,
            kind: "null_result",
            title: `Skill-opt null result: ${skillSlug} round ${verdict.round}`,
            summary:
              `Candidate rejected by the held-out validation gate in skill-opt run ${verdict.run_id} on ` +
              `capsule set ${familyRef}: held-out solve rate ${formatSolveRate(verdict.val_solve_rate_before)} -> ` +
              `${formatSolveRate(verdict.val_solve_rate_after)}.`,
            notebook_source: buildNullResultNotebookSource({
              skillSlug,
              capsuleSet: familyRef,
              verdict,
            }),
            idempotency_key: verdict.step_id,
          },
          configPath,
        );
        publishedNullResults.push({
          node_id: created.data.node_id,
          step_id: verdict.step_id,
          round: verdict.round,
        });
      }
    }

    printJson({
      data: {
        run_id: report.run_id,
        capsule_set: familyRef,
        skill_slug: skillSlug,
        train_version_ids: report.train_version_ids,
        val_version_ids: report.val_version_ids,
        improved: report.improved,
        steps: report.steps,
        skipped_rounds: report.skipped_rounds,
        publish_intents: {
          skill_versions: report.publish_intents.skill_versions.map((intent) => ({
            verdict: intent.verdict,
          })),
          null_results: report.publish_intents.null_results,
        },
        ...(report.improved ? { optimized_skill_path: optimizedSkillPath } : {}),
        ...(publish || publishNullResults
          ? {
              published: {
                skill_version: publishedSkillVersion,
                null_results: publishedNullResults,
              },
            }
          : {}),
        next_steps: report.improved
          ? publishedSkillVersion
            ? [
                `Published the optimized skill as skill version ${publishedSkillVersion.skill_version} ` +
                  `(node ${publishedSkillVersion.node_id}). Review it with \`regents techtree node get ` +
                  `${publishedSkillVersion.node_id}\`; the accepted markdown is also at ${optimizedSkillPath}.`,
              ]
            : [
                `Review ${optimizedSkillPath}, copy it over ${skillPath}, then run \`regents techtree autoskill publish skill --workspace ${workspacePath} --skill-slug ${skillSlug}\` to publish the accepted skill version.`,
              ]
          : [
              "No candidate beat the held-out validation gate, so the skill document is unchanged.",
            ],
      },
    });
  } finally {
    await proxy.close();
  }
}
