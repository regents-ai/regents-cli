import path from "node:path";

import { describe, expect, it } from "vitest";

import { captureOutput } from "../../../test-support/test-helpers.js";
import {
  CommandCase,
  TEST_REGISTRY,
  TEST_WALLET,
  daemonCallMock,
  ensureIdentityMock,
  runDoctorMock,
  runFullDoctorMock,
  runScopedDoctorMock,
  setupCliEntrypointHarness,
} from "./helpers/cli-entrypoint-support.js";

const harness = setupCliEntrypointHarness();

const commandCases: CommandCase[] = [
  {
    name: "auth login",
    args: ["auth", "login", "--wallet-address", TEST_WALLET, "--chain-id", "8453", "--audience", "techtree"],
    expected: {
      method: "auth.siwa.login",
      params: {
        walletAddress: TEST_WALLET,
        chainId: 8453,
        audience: "techtree",
      },
    },
  },
  {
    name: "auth status",
    args: ["auth", "status"],
    expected: {
      method: "auth.siwa.status",
    },
  },
  {
    name: "auth logout",
    args: ["auth", "logout"],
    expected: {
      method: "auth.siwa.logout",
    },
  },
  {
    name: "identity ensure",
    args: [
      "identity",
      "ensure",
      "--network",
      "base",
      "--wallet",
      "main",
      "--force-refresh",
      "--timeout",
      "45",
      "--json",
    ],
    expected: {
      status: "ok",
      provider: "coinbase-cdp",
      network: "base",
      address: TEST_WALLET,
      agent_id: `eip155:8453:${TEST_REGISTRY}:99`,
      token_id: "99",
      agent_registry: TEST_REGISTRY,
      verified: "onchain",
      receipt_expires_at: "2999-01-01T00:00:00.000Z",
      cache_path: expect.stringContaining("receipt-v1.json"),
      next_steps: [
        "regents auth login --audience techtree",
        "regents run --fold autoresearch",
      ],
    },
  },
  {
    name: "identity status",
    args: ["identity", "status", "--network", "base", "--wallet", "main", "--json"],
    expected: expect.objectContaining({
      ok: true,
      provider: "coinbase-cdp",
      network: "base",
      wallet_ready: true,
      identity_ready: true,
      address: TEST_WALLET,
    }),
  },
  {
    name: "wallet status",
    args: ["wallet", "status", "--json"],
    expected: expect.objectContaining({
      ok: true,
      provider: "coinbase-cdp",
      account: expect.objectContaining({
        name: "main",
        address: TEST_WALLET,
      }),
    }),
  },
  {
    name: "wallet setup",
    args: ["wallet", "setup", "--json"],
    expected: expect.objectContaining({
      ok: true,
      provider: "coinbase-cdp",
      wallet: expect.objectContaining({
        name: "main",
        address: TEST_WALLET,
      }),
    }),
  },
  {
    name: "agent init",
    args: ["agent", "init"],
    expected: expect.objectContaining({
      initialized: true,
      state: expect.objectContaining({
        executor_harness: expect.objectContaining({
          kind: "custom",
          profile: "owner",
        }),
        origin: expect.objectContaining({
          kind: "local",
        }),
        executor_harness_kind: "custom",
        executor_harness_profile: "owner",
      }),
      currentProfile: expect.objectContaining({
        name: "owner",
        executor_harness_profile: "owner",
      }),
      currentHarness: expect.objectContaining({
        kind: "custom",
      }),
      resolvedMetadata: expect.objectContaining({
        executor_harness: expect.objectContaining({
          kind: "custom",
          profile: "owner",
        }),
        origin: expect.objectContaining({
          kind: "local",
        }),
        executor_harness_kind: "custom",
        executor_harness_profile: "owner",
      }),
    }),
  },
  {
    name: "agent status",
    args: ["agent", "status"],
    expected: expect.objectContaining({
      initialized: true,
      profiles: expect.arrayContaining([
        expect.objectContaining({ name: "owner" }),
        expect.objectContaining({ name: "public" }),
        expect.objectContaining({ name: "group" }),
        expect.objectContaining({ name: "custom" }),
      ]),
      harnesses: expect.arrayContaining([
        expect.objectContaining({ name: "openclaw" }),
        expect.objectContaining({ name: "hermes" }),
        expect.objectContaining({ name: "claude_code" }),
        expect.objectContaining({ name: "custom" }),
      ]),
    }),
  },
  {
    name: "agent profile list",
    args: ["agent", "profile", "list"],
    expected: {
      data: expect.arrayContaining([
        expect.objectContaining({ name: "owner", executor_harness_profile: "owner" }),
        expect.objectContaining({ name: "public" }),
        expect.objectContaining({ name: "group" }),
        expect.objectContaining({ name: "custom" }),
      ]),
    },
  },
  {
    name: "agent profile get",
    args: ["agent", "profile", "get", "--profile", "public"],
    expected: {
      data: expect.objectContaining({
        name: "public",
        kind: "public",
        active: true,
        executor_harness_profile: "public",
      }),
    },
  },
  {
    name: "agent harness list",
    args: ["agent", "harness", "list"],
    expected: {
      data: expect.arrayContaining([
        expect.objectContaining({ name: "openclaw" }),
        expect.objectContaining({ name: "hermes" }),
        expect.objectContaining({ name: "claude_code" }),
        expect.objectContaining({ name: "custom", active: true }),
      ]),
    },
  },
  { name: "techtree status", args: ["techtree", "status"], expected: { method: "techtree.status" } },
  {
    name: "techtree nodes list",
    args: ["techtree", "nodes", "list", "--limit", "5", "--seed", "ml"],
    expected: { method: "techtree.nodes.list", params: { limit: 5, seed: "ml" } },
  },
  { name: "techtree node get", args: ["techtree", "node", "get", "42"], expected: { method: "techtree.nodes.get", params: { id: 42 } } },
  {
    name: "techtree node children",
    args: ["techtree", "node", "children", "42", "--limit", "3"],
    expected: { method: "techtree.nodes.children", params: { id: 42, limit: 3 } },
  },
  {
    name: "techtree node comments",
    args: ["techtree", "node", "comments", "42", "--limit", "4"],
    expected: { method: "techtree.nodes.comments", params: { id: 42, limit: 4 } },
  },
  {
    name: "techtree node lineage list",
    args: ["techtree", "node", "lineage", "list", "42"],
    expected: { method: "techtree.nodes.lineage.list", params: { id: 42 } },
  },
  {
    name: "techtree node lineage claim",
    args: [
      "techtree",
      "node",
      "lineage",
      "claim",
      "42",
      "--input",
      "{\"claim\":\"this node descends from a Base-side artifact\"}",
    ],
    expected: {
      method: "techtree.nodes.lineage.claim",
      params: {
        id: 42,
        input: { claim: "this node descends from a Base-side artifact" },
      },
    },
  },
  {
    name: "techtree node lineage withdraw",
    args: ["techtree", "node", "lineage", "withdraw", "42", "--claim-id", "claim_123"],
    expected: {
      method: "techtree.nodes.lineage.withdraw",
      params: {
        id: 42,
        claimId: "claim_123",
      },
    },
  },
  {
    name: "techtree node cross-chain-links list",
    args: ["techtree", "node", "cross-chain-links", "list", "42"],
    expected: { method: "techtree.nodes.crossChainLinks.list", params: { id: 42 } },
  },
  {
    name: "techtree node cross-chain-links create",
    args: [
      "techtree",
      "node",
      "cross-chain-links",
      "create",
      "42",
      "--input",
      "{\"chain\":\"base\",\"target\":\"0xabc\",\"relation\":\"references\"}",
    ],
    expected: {
      method: "techtree.nodes.crossChainLinks.create",
      params: {
        id: 42,
        input: {
          chain: "base",
          target: "0xabc",
          relation: "references",
        },
      },
    },
  },
  {
    name: "techtree node cross-chain-links clear",
    args: ["techtree", "node", "cross-chain-links", "clear", "42"],
    expected: { method: "techtree.nodes.crossChainLinks.clear", params: { id: 42 } },
  },
  {
    name: "techtree node create with cross-chain link",
    args: [
      "techtree",
      "node",
      "create",
      "--seed",
      "ml",
      "--kind",
      "hypothesis",
      "--title",
      "Cross-chain node",
      "--notebook-source",
      "print('hello')",
      "--cross-chain-link",
      "{\"chain\":\"base\",\"target\":\"0xabc\",\"relation\":\"references\"}",
    ],
    expected: {
      method: "techtree.nodes.create",
      params: {
        seed: "ml",
        kind: "hypothesis",
        title: "Cross-chain node",
        notebook_source: "print('hello')",
        cross_chain_link: {
          chain: "base",
          target: "0xabc",
          relation: "references",
        },
      },
    },
  },
  {
    name: "techtree node create with paid payload payee override",
    args: [
      "techtree",
      "node",
      "create",
      "--seed",
      "ml",
      "--kind",
      "hypothesis",
      "--title",
      "Paid node",
      "--notebook-source",
      "print('hello')",
      "--paid-payload",
      `{"encrypted_payload_uri":"ipfs://bafy-paid","x402_pay_to_address":"${TEST_REGISTRY}"}`,
    ],
    expected: {
      method: "techtree.nodes.create",
      params: {
        seed: "ml",
        kind: "hypothesis",
        title: "Paid node",
        notebook_source: "print('hello')",
        paid_payload: {
          encrypted_payload_uri: "ipfs://bafy-paid",
          x402_pay_to_address: TEST_REGISTRY,
        },
      },
    },
  },
  {
    name: "techtree comment add",
    args: ["techtree", "comment", "add", "--node-id", "42", "--body-markdown", "Useful note"],
    expected: {
      method: "techtree.comments.create",
      params: {
        node_id: 42,
        body_markdown: "Useful note",
        body_plaintext: undefined,
        idempotency_key: undefined,
      },
    },
  },
  {
    name: "techtree activity",
    args: ["techtree", "activity", "--limit", "4"],
    expected: { method: "techtree.activity.list", params: { limit: 4 } },
  },
  {
    name: "techtree search",
    args: ["techtree", "search", "--query", "root", "--limit", "2"],
    expected: { method: "techtree.search.query", params: { q: "root", limit: 2 } },
  },
  {
    name: "techtree node work-packet",
    args: ["techtree", "node", "work-packet", "42"],
    expected: { method: "techtree.nodes.workPacket", params: { id: 42 } },
  },
  {
    name: "techtree work summary",
    args: ["techtree", "work", "--kind", "benchmark", "--limit", "5"],
    expected: {
      method: "techtree.work.list",
      params: { kind: "benchmark", limit: 5 },
      next_steps: ["regents techtree work next --json"],
    },
  },
  {
    name: "techtree heartbeats schedule",
    args: ["techtree", "heartbeats", "schedule"],
    expected: {
      method: "techtree.heartbeats.schedule",
      next_steps: ["regents techtree heartbeats start --heartbeat work_pickup --json"],
    },
  },
  {
    name: "techtree heartbeats list",
    args: ["techtree", "heartbeats", "list", "--cursor", "10", "--limit", "5"],
    expected: {
      method: "techtree.heartbeats.list",
      params: { cursor: 10, limit: 5 },
    },
  },
  {
    name: "techtree heartbeats start",
    args: [
      "techtree",
      "heartbeats",
      "start",
      "--heartbeat",
      "work_pickup",
      "--runtime",
      "hermes",
      "--refs",
      "{\"hrefs\":[\"/activity\"],\"node_id\":42}",
      "--metadata",
      "{\"source\":\"test\"}",
    ],
    expected: {
      method: "techtree.heartbeats.start",
      params: {
        heartbeat_name: "work_pickup",
        runtime: "hermes",
        techtree_refs: { hrefs: ["/activity"], node_id: 42 },
        metadata: { source: "test" },
      },
      next_steps: [
        "regents techtree heartbeats complete <wakeup_id> --input-tokens 0 --output-tokens 0 --total-tokens 0 --summary \"Checked for work\" --json",
      ],
    },
  },
  {
    name: "techtree heartbeats complete",
    args: [
      "techtree",
      "heartbeats",
      "complete",
      "42",
      "--status",
      "completed",
      "--input-tokens",
      "100",
      "--output-tokens",
      "50",
      "--total-tokens",
      "150",
      "--summary",
      "Published a node",
      "--refs",
      "{\"hrefs\":[\"/nodes/42\"]}",
      "--metadata",
      "{\"source\":\"test\"}",
    ],
    expected: {
      method: "techtree.heartbeats.complete",
      params: {
        wakeup_id: 42,
        status: "completed",
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        summary: "Published a node",
        techtree_refs: { hrefs: ["/nodes/42"] },
        metadata: { source: "test" },
      },
      next_steps: ["Open the Techtree heartbeat link to review the tracked work."],
    },
  },
  { name: "techtree watch list", args: ["techtree", "watch", "list"], expected: { method: "techtree.watch.list" } },
  {
    name: "techtree watch",
    args: ["techtree", "watch", "42"],
    expected: { method: "techtree.watch.create", params: { nodeId: 42 } },
  },
  {
    name: "techtree unwatch",
    args: ["techtree", "unwatch", "42"],
    expected: { method: "techtree.watch.delete", params: { nodeId: 42 } },
  },
  {
    name: "techtree star",
    args: ["techtree", "star", "42"],
    expected: { method: "techtree.stars.create", params: { nodeId: 42 } },
  },
  {
    name: "techtree unstar",
    args: ["techtree", "unstar", "42"],
    expected: { method: "techtree.stars.delete", params: { nodeId: 42 } },
  },
  {
    name: "techtree inbox",
    args: ["techtree", "inbox", "--cursor", "10", "--limit", "20", "--seed", "ml", "--kind", "comment,mention"],
    expected: { method: "techtree.inbox.get", params: { cursor: 10, limit: 20, seed: "ml", kind: ["comment", "mention"] } },
  },
  {
    name: "techtree opportunities",
    args: ["techtree", "opportunities", "--limit", "6", "--seed", "ml", "--kind", "review,build"],
    expected: { method: "techtree.opportunities.list", params: { limit: 6, seed: "ml", kind: ["review", "build"] } },
  },
  {
    name: "techtree science-tasks list",
    args: [
      "techtree",
      "science-tasks",
      "list",
      "--limit",
      "7",
      "--stage",
      "review_fix",
      "--science-domain",
      "life-sciences",
      "--science-field",
      "biology",
    ],
    expected: {
      method: "techtree.scienceTasks.list",
      params: {
        limit: 7,
        stage: "review_fix",
        science_domain: "life-sciences",
        science_field: "biology",
      },
    },
  },
  {
    name: "techtree science-tasks get",
    args: ["techtree", "science-tasks", "get", "301"],
    expected: { method: "techtree.scienceTasks.get", params: { id: 301 } },
  },
  {
    name: "techtree science-tasks init",
    args: [
      "techtree",
      "science-tasks",
      "init",
      "--workspace-path",
      "science-workspace",
      "--title",
      "Cell atlas benchmark",
      "--summary",
      "Prepare the task packet",
      "--science-domain",
      "life-sciences",
      "--science-field",
      "biology",
      "--task-slug",
      "cell-atlas-benchmark",
      "--claimed-expert-time",
      "2 hours",
    ],
    expected: {
      method: "techtree.scienceTasks.init",
      params: {
        workspace_path: "science-workspace",
        title: "Cell atlas benchmark",
        summary: "Prepare the task packet",
        science_domain: "life-sciences",
        science_field: "biology",
        task_slug: "cell-atlas-benchmark",
        claimed_expert_time: "2 hours",
      },
    },
  },
  {
    name: "techtree science-tasks checklist",
    args: ["techtree", "science-tasks", "checklist", "--workspace-path", "science-workspace"],
    expected: {
      method: "techtree.scienceTasks.checklist",
      params: { workspace_path: "science-workspace" },
    },
  },
  {
    name: "techtree science-tasks evidence",
    args: ["techtree", "science-tasks", "evidence", "--workspace-path", "science-workspace"],
    expected: {
      method: "techtree.scienceTasks.evidence",
      params: { workspace_path: "science-workspace" },
    },
  },
  {
    name: "techtree science-tasks export",
    args: [
      "techtree",
      "science-tasks",
      "export",
      "--workspace-path",
      "science-workspace",
      "--output-path",
      "science-export",
    ],
    expected: {
      method: "techtree.scienceTasks.export",
      params: { workspace_path: "science-workspace", output_path: "science-export" },
    },
  },
  {
    name: "techtree science-tasks submit",
    args: [
      "techtree",
      "science-tasks",
      "submit",
      "--workspace-path",
      "science-workspace",
      "--pr-url",
      "https://harbor.example/pr/301",
      "--follow-up-note",
      "Ready for review",
    ],
    expected: {
      method: "techtree.scienceTasks.submit",
      params: {
        workspace_path: "science-workspace",
        harbor_pr_url: "https://harbor.example/pr/301",
        latest_review_follow_up_note: "Ready for review",
      },
    },
  },
  {
    name: "techtree science-tasks review-update",
    args: [
      "techtree",
      "science-tasks",
      "review-update",
      "--workspace-path",
      "science-workspace",
      "--pr-url",
      "https://harbor.example/pr/301",
      "--follow-up-note",
      "All reviewer notes answered",
      "--open-reviewer-concerns-count",
      "0",
      "--any-concern-unanswered",
      "false",
      "--latest-rerun-after-latest-fix",
      "true",
      "--latest-fix-at",
      "2026-04-20T12:00:00.000Z",
      "--last-rerun-at",
      "2026-04-20T13:00:00.000Z",
    ],
    expected: {
      method: "techtree.scienceTasks.reviewUpdate",
      params: {
        workspace_path: "science-workspace",
        harbor_pr_url: "https://harbor.example/pr/301",
        latest_review_follow_up_note: "All reviewer notes answered",
        open_reviewer_concerns_count: 0,
        any_concern_unanswered: false,
        latest_rerun_after_latest_fix: true,
        latest_fix_at: "2026-04-20T12:00:00.000Z",
        last_rerun_at: "2026-04-20T13:00:00.000Z",
      },
    },
  },
  {
    name: "techtree science-tasks review-loop",
    args: [
      "techtree",
      "science-tasks",
      "review-loop",
      "--workspace-path",
      "science-workspace",
      "--pr-url",
      "https://harbor.example/pr/301",
      "--timeout-seconds",
      "1200",
    ],
    expected: {
      method: "techtree.scienceTasks.reviewLoop",
      params: {
        workspace_path: "science-workspace",
        harbor_pr_url: "https://harbor.example/pr/301",
        timeout_seconds: 1200,
      },
    },
  },
  {
    name: "techtree science set-goal",
    args: [
      "techtree",
      "science",
      "set-goal",
      "--task",
      "harbor-framework/terminal-bench-science:tasks/physical-sciences/chemistry-and-materials/example",
      "--agent",
      "codex",
      "--model",
      "openai/gpt-5.4",
      "--env",
      "docker",
    ],
    expected: {
      method: "techtree.science.setGoal",
      params: {
        task: "harbor-framework/terminal-bench-science:tasks/physical-sciences/chemistry-and-materials/example",
        agent: "codex",
        model: "openai/gpt-5.4",
        env: "docker",
      },
    },
  },
  {
    name: "techtree science agent set",
    args: ["techtree", "science", "agent", "set", "codex"],
    expected: {
      method: "techtree.science.agent.set",
      params: {
        agent: "codex",
      },
    },
  },
  {
    name: "techtree science run active goal",
    args: ["techtree", "science", "run"],
    expected: {
      method: "techtree.science.run",
      params: {},
    },
  },
  {
    name: "techtree science run task",
    args: [
      "techtree",
      "science",
      "run",
      "--task",
      "harbor-framework/terminal-bench-science:tasks/physical-sciences/chemistry-and-materials/example",
      "--run-dir",
      "tsb-run",
      "--publish-run",
      "--timeout-seconds",
      "12",
    ],
    expected: {
      method: "techtree.science.run",
      params: {
        task: "harbor-framework/terminal-bench-science:tasks/physical-sciences/chemistry-and-materials/example",
        run_dir: "tsb-run",
        publish_run: true,
        timeout_seconds: 12,
      },
    },
  },
  {
    name: "techtree autoskill init skill",
    args: ["techtree", "autoskill", "init", "skill", "skill-workspace"],
    expected: { method: "techtree.autoskill.initSkill", params: { workspace_path: path.resolve("skill-workspace") } },
  },
  {
    name: "techtree autoskill init eval",
    args: ["techtree", "autoskill", "init", "eval", "eval-workspace"],
    expected: { method: "techtree.autoskill.initEval", params: { workspace_path: path.resolve("eval-workspace") } },
  },
  {
    name: "techtree autoskill notebook pair",
    args: ["techtree", "autoskill", "notebook", "pair", "skill-workspace"],
    expected: {
      ok: true,
      entrypoint: "autoskill.notebook.pair",
      workspace_path: path.resolve("skill-workspace"),
      workspace_kind: "skill",
      notebook_path: path.resolve("skill-workspace", "session.marimo.py"),
      launch_argv: ["uvx", "marimo", "edit", "session.marimo.py"],
      marimo_pair: expect.objectContaining({
        skill_name: "marimo-pair",
        installed: true,
      }),
      instructions: expect.objectContaining({
        techtree_skill: "techtree-autoskill-workspace",
      }),
    },
  },
  {
    name: "techtree autoskill publish skill",
    args: [
      "techtree",
      "autoskill",
      "publish",
      "skill",
      "skill-workspace",
      "--skill-slug",
      "prompt-router",
      "--skill-version",
      "0.1.0",
      "--title",
      "Prompt router",
      "--access-mode",
      "public_free",
    ],
    expected: {
      method: "techtree.autoskill.publishSkill",
      params: {
        workspace_path: path.resolve("skill-workspace"),
        input: {
          title: "Prompt router",
          skill_slug: "prompt-router",
          skill_version: "0.1.0",
          access_mode: "public_free",
          marimo_entrypoint: "session.marimo.py",
          primary_file: "SKILL.md",
        },
      },
    },
  },
  {
    name: "techtree autoskill publish eval",
    args: [
      "techtree",
      "autoskill",
      "publish",
      "eval",
      "eval-workspace",
      "--slug",
      "routing-benchmark",
      "--version",
      "0.2.0",
      "--title",
      "Routing benchmark",
      "--access-mode",
      "gated_paid",
      "--payment-rail",
      "batch_settlement",
    ],
    expected: {
      method: "techtree.autoskill.publishEval",
      params: {
        workspace_path: path.resolve("eval-workspace"),
        input: {
          title: "Routing benchmark",
          slug: "routing-benchmark",
          access_mode: "gated_paid",
          marimo_entrypoint: "session.marimo.py",
          primary_file: "scenario.yaml",
          payment_rail: "batch_settlement",
          bundle_manifest: {
            metadata: {
              version: "0.2.0",
            },
          },
        },
      },
    },
  },
  {
    name: "techtree autoskill publish result",
    args: [
      "techtree",
      "autoskill",
      "publish",
      "result",
      "run-workspace",
      "--skill-node-id",
      "42",
      "--eval-node-id",
      "99",
      "--runtime-kind",
      "local",
      "--raw-score",
      "0.8",
      "--normalized-score",
      "0.91",
    ],
    expected: {
      method: "techtree.autoskill.publishResult",
      params: {
        workspace_path: path.resolve("run-workspace"),
        input: {
          skill_node_id: 42,
          eval_node_id: 99,
          runtime_kind: "local",
          raw_score: 0.8,
          normalized_score: 0.91,
        },
      },
    },
  },
  {
    name: "techtree autoskill review",
    args: [
      "techtree",
      "autoskill",
      "review",
      "--kind",
      "replicable",
      "--skill-node-id",
      "42",
      "--result-id",
      "77",
      "--runtime-kind",
      "local",
      "--reported-score",
      "0.88",
    ],
    expected: {
      method: "techtree.autoskill.review",
      params: {
        kind: "replicable",
        skill_node_id: 42,
        result_id: 77,
        runtime_kind: "local",
        reported_score: 0.88,
      },
    },
  },
  {
    name: "techtree autoskill listing create",
    args: [
      "techtree",
      "autoskill",
      "listing",
      "create",
      "--skill-node-id",
      "42",
      "--payment-rail",
      "batch_settlement",
      "--chain-id",
      "8453",
      "--x402-asset-address",
      TEST_WALLET,
      "--x402-pay-to-address",
      TEST_WALLET,
      "--price-usdc",
      "25.000000",
    ],
    expected: {
      method: "techtree.autoskill.listing.create",
      params: {
        skill_node_id: 42,
        payment_rail: "batch_settlement",
        chain_id: 8453,
        x402_asset_address: TEST_WALLET,
        x402_pay_to_address: TEST_WALLET,
        price_usdc: "25.000000",
      },
    },
  },
  {
    name: "techtree autoskill buy",
    args: ["techtree", "autoskill", "buy", "42", "--max-deposit-amount", "1000000"],
    expected: {
      method: "techtree.autoskill.buy",
      params: {
        node_id: 42,
        max_deposit_amount: "1000000",
      },
    },
  },
  {
    name: "techtree autoskill refund",
    args: ["techtree", "autoskill", "refund", "42", "--amount", "1000"],
    expected: {
      method: "techtree.autoskill.refund",
      params: {
        node_id: 42,
        amount: "1000",
      },
    },
  },
  {
    name: "techtree autoskill pull",
    args: ["techtree", "autoskill", "pull", "42", "pull-workspace"],
    expected: {
      method: "techtree.autoskill.pull",
      params: {
        node_id: 42,
        workspace_path: path.resolve("pull-workspace"),
      },
    },
  },
  {
    name: "techtree bbh draft init",
    args: ["techtree", "bbh", "draft", "init", "draft-workspace"],
    expected: {
      ok: true,
      tree: "bbh",
      entrypoint: "bbh.draft.init",
      workspace_path: path.resolve("draft-workspace"),
      files: expect.arrayContaining(["notebook.py", "rubric.json"]),
    },
  },
  {
    name: "techtree bbh draft create",
    args: ["techtree", "bbh", "draft", "create", "draft-workspace", "--title", "Capsule draft", "--seed", "BBH", "--parent-id", "42"],
    expected: {
      data: {
        capsule: expect.objectContaining({
          capsule_id: "capsule_draft_test",
          title: "Capsule draft",
          split: "draft",
        }),
        workspace: expect.any(Object),
      },
    },
  },
  {
    name: "techtree bbh genome init",
    args: ["techtree", "bbh", "genome", "init", "draft-workspace", "--lane", "climb", "--sample-size", "3", "--budget", "6"],
    expected: {
      ok: true,
      entrypoint: "bbh.genome.init",
      workspace_path: path.resolve("draft-workspace"),
      files: expect.arrayContaining(["genome/baseline.source.yaml", "genome/scoreboard.json"]),
      baseline_genome_id: "gen_baseline",
      evaluation_scope: {
        split: "climb",
        sample_size: 3,
      },
    },
  },
  {
    name: "techtree bbh genome score",
    args: ["techtree", "bbh", "genome", "score", "draft-workspace"],
    expected: {
      ok: true,
      entrypoint: "bbh.genome.score",
      workspace_path: path.resolve("draft-workspace"),
      scoreboard: expect.objectContaining({
        schema_version: "techtree.bbh.genome-scoreboard.v1",
        best_score: 0.82,
      }),
    },
  },
  {
    name: "techtree bbh genome improve",
    args: ["techtree", "bbh", "genome", "improve", "draft-workspace"],
    expected: {
      ok: true,
      entrypoint: "bbh.genome.improve",
      workspace_path: path.resolve("draft-workspace"),
      scoreboard: expect.objectContaining({
        schema_version: "techtree.bbh.genome-scoreboard.v1",
        best_score: 0.82,
      }),
      next_trial_id: "mutation_trial_test",
      recommended_genome_id: "gen_candidate",
    },
  },
  {
    name: "techtree bbh genome propose",
    args: ["techtree", "bbh", "genome", "propose", "capsule_draft_test", "draft-workspace"],
    expected: {
      data: {
        proposal: expect.objectContaining({
          proposal_id: "proposal_test",
          capsule_id: "capsule_draft_test",
        }),
      },
    },
  },
  {
    name: "techtree bbh run exec",
    args: [
      "techtree",
      "bbh",
      "run",
      "exec",
      "bbh-workspace",
      "--executor-harness-kind",
      "claude_code",
      "--executor-harness-profile",
      "bbh-analyst",
      "--origin-kind",
      "watched_node",
      "--origin-session-id",
      "bbh-session-7",
      "--origin-trigger-ref",
      "node-42",
    ],
    expected: {
      ok: true,
      entrypoint: "bbh.run.exec",
      workspace_path: path.resolve("bbh-workspace"),
      assignment_ref: "asg_test",
      lane: "climb",
      run_id: "run_test",
      capsule_id: "capsule_test",
      genome_id: "gen_test",
      files: expect.any(Array),
      capsule: expect.objectContaining({
        capsule_id: "capsule_test",
        lane: "climb",
      }),
      resolved_metadata: {
        resolved_at: "2026-03-20T00:00:00.000Z",
        executor_harness: {
          kind: "claude_code",
          profile: "bbh-analyst",
          entrypoint: null,
        },
        origin: {
          kind: "watched_node",
          transport: null,
          session_id: "bbh-session-7",
          trigger_ref: "node-42",
        },
        executor_harness_kind: "claude_code",
        executor_harness_profile: "bbh-analyst",
        origin_session_id: "bbh-session-7",
      },
    },
  },
  {
    name: "techtree reviewer apply",
    args: ["techtree", "reviewer", "apply", "--tag", "scrna-seq", "--tag", "bulk-rna", "--payout-wallet", TEST_WALLET],
    expected: {
      data: expect.objectContaining({
        wallet_address: TEST_WALLET,
        domain_tags: ["scrna-seq", "bulk-rna"],
        payout_wallet: TEST_WALLET,
      }),
    },
  },
  {
    name: "techtree review list",
    args: ["techtree", "review", "list", "--kind", "certification"],
    expected: {
      data: expect.arrayContaining([
        expect.objectContaining({
          request_id: "review_req_test",
          review_kind: "certification",
        }),
      ]),
    },
  },
  {
    name: "techtree review claim",
    args: ["techtree", "review", "claim", "review_req_test"],
    expected: {
      data: expect.objectContaining({
        request_id: "review_req_test",
        state: "claimed",
      }),
    },
  },
  {
    name: "techtree certificate verify",
    args: ["techtree", "certificate", "verify", "capsule_draft_test"],
    expected: {
      data: expect.objectContaining({
        capsule_id: "capsule_draft_test",
        status: "active",
      }),
    },
  },
  {
    name: "techtree main fetch",
    args: ["techtree", "main", "fetch", "0x1234000000000000000000000000000000000000000000000000000000000000"],
    expected: {
      ok: true,
      tree: "main",
      node_id: "0x1234000000000000000000000000000000000000000000000000000000000000",
      node_type: "artifact",
      manifest_cid: "bafy-fetch-manifest",
      payload_cid: "bafy-fetch-payload",
      verified: true,
    },
  },
  {
    name: "techtree main verify",
    args: ["techtree", "main", "verify", "0x1234000000000000000000000000000000000000000000000000000000000000"],
    expected: expect.objectContaining({
      ok: true,
      tree: "main",
      verified: true,
    }),
  },
  {
    name: "techtree bbh run exec",
    args: ["techtree", "bbh", "run", "exec", "--lane", "climb", "--path", "bbh-workspace"],
    expected: {
      ok: true,
      entrypoint: "bbh.run.exec",
      workspace_path: path.resolve("bbh-workspace"),
      assignment_ref: "asg_test",
      lane: "climb",
      run_id: "run_test",
      capsule_id: "capsule_test",
      genome_id: "gen_test",
      files: expect.any(Array),
      capsule: expect.objectContaining({
        capsule_id: "capsule_test",
        lane: "climb",
      }),
    },
  },
  {
    name: "techtree bbh run exec with capsule",
    args: [
      "techtree",
      "bbh",
      "run",
      "exec",
      "--capsule",
      "capsule_test",
      "--lane",
      "benchmark",
      "--path",
      "bbh-workspace",
    ],
    expected: {
      ok: true,
      entrypoint: "bbh.run.exec",
      workspace_path: path.resolve("bbh-workspace"),
      assignment_ref: "asg_test",
      lane: "benchmark",
      run_id: "run_test",
      capsule_id: "capsule_test",
      genome_id: "gen_test",
      files: expect.any(Array),
      capsule: expect.objectContaining({
        capsule_id: "capsule_test",
        lane: "benchmark",
      }),
    },
  },
  {
    name: "techtree bbh run solve",
    args: ["techtree", "bbh", "run", "solve", "bbh-run", "--solver", "openclaw", "--timeout-seconds", "120"],
    expected: {
      ok: true,
      entrypoint: "bbh.run.solve",
      workspace_path: path.resolve("bbh-run"),
      run_id: "run_test",
      solver: "openclaw",
      produced_files: expect.any(Array),
      verdict_summary: {
        decision: "support",
        raw_score: 0.8,
        normalized_score: 0.9,
      },
    },
  },
  {
    name: "techtree bbh run solve skydiscover",
    args: ["techtree", "bbh", "run", "solve", "bbh-run", "--solver", "skydiscover"],
    expected: {
      ok: true,
      entrypoint: "bbh.run.solve",
      workspace_path: path.resolve("bbh-run"),
      run_id: "run_test",
      solver: "skydiscover",
      produced_files: expect.any(Array),
      verdict_summary: {
        decision: "support",
        raw_score: 0.8,
        normalized_score: 0.9,
      },
    },
  },
  {
    name: "techtree bbh notebook pair",
    args: ["techtree", "bbh", "notebook", "pair", "bbh-run"],
    expected: {
      ok: true,
      entrypoint: "bbh.notebook.pair",
      workspace_path: path.resolve("bbh-run"),
      notebook_path: path.resolve("bbh-run", "analysis.py"),
      launch_argv: ["uvx", "marimo", "edit", "analysis.py"],
      marimo_pair: expect.objectContaining({
        skill_name: "marimo-pair",
        installed: true,
      }),
      instructions: expect.objectContaining({
        techtree_skill: "techtree-bbh-workspace",
      }),
    },
  },
  {
    name: "techtree bbh capsules list",
    args: ["techtree", "bbh", "capsules", "list", "--lane", "benchmark"],
    expected: {
      data: [
        {
          capsule_id: "capsule_test",
          lane: "benchmark",
          title: "Test capsule",
          hypothesis: "Hypothesis",
          provider: "bbh_train",
          provider_ref: "provider/capsule_test",
          assignment_policy: "auto_or_select",
          published_at: "2026-03-20T00:00:00Z",
        },
      ],
    },
  },
  {
    name: "techtree bbh capsules get",
    args: ["techtree", "bbh", "capsules", "get", "capsule_test"],
    expected: {
      data: {
        capsule_id: "capsule_test",
        lane: "benchmark",
        title: "Benchmark capsule",
        hypothesis: "Hypothesis",
        provider: "bbh",
        provider_ref: "provider/capsule_test",
        assignment_policy: "auto_or_select",
        published_at: "2026-03-20T00:00:00Z",
        family_ref: "family_test",
        instance_ref: "instance_test",
        language: "python",
        mode: "family",
        task_summary: { objective: "benchmark" },
        rubric_summary: { criteria: [] },
        data_manifest: [
          {
            path: "data/example.txt",
            sha256: `sha256:${"33".repeat(32)}`,
            bytes: 12,
          },
        ],
        artifact_source: { schema_version: "techtree.bbh.artifact-source.v1" },
        execution_defaults: {
          solver: {
            kind: "skydiscover",
            entrypoint: "uv run techtree-bbh sky-search",
            search_algorithm: "best_of_n",
          },
          evaluator: {
            kind: "hypotest",
            dataset_ref: "provider/capsule_test",
            benchmark_ref: "family_test",
            scorer_version: "hypotest-v0.1",
          },
          workspace: {
            best_program_path: "outputs/skydiscover/best_program.py",
            search_summary_path: "outputs/skydiscover/search_summary.json",
          },
        },
      },
    },
  },
  {
    name: "techtree bbh submit",
    args: ["techtree", "bbh", "submit", "--path", "bbh-workspace"],
    expected: {
      data: {
        run_id: "run_test",
        status: "completed",
        score: {
          raw: 3,
          normalized: 0.75,
        },
        validation_state: "validation_pending",
        public_run_path: "/bbh/runs/run_test",
      },
    },
  },
  {
    name: "techtree bbh validate",
    args: ["techtree", "bbh", "validate", "--path", "bbh-workspace", "--run-id", "run_test"],
    expected: {
      data: {
        validation_id: "val_test",
        run_id: "run_test",
        result: "confirmed",
      },
    },
  },
  {
    name: "techtree bbh leaderboard",
    args: ["techtree", "bbh", "leaderboard", "--lane", "benchmark"],
    expected: {
      data: {
        benchmark: "bbh_py",
        lane: "benchmark",
        generated_at: "2026-03-20T00:00:00Z",
        entries: [],
      },
    },
  },
  {
    name: "techtree bbh sync",
    args: ["techtree", "bbh", "sync", "--workspace-root", "bbh-workspaces"],
    expected: {
      data: {
        runs: [],
      },
    },
  },
  { name: "gossipsub status", args: ["gossipsub", "status"], expected: { method: "gossipsub.status" } },
];

describe("CLI command dispatch", () => {
  for (const testCase of commandCases) {
    it(`dispatches ${testCase.name}`, async () => {
      const output = await captureOutput(async () =>
        harness.runCliEntrypoint([...testCase.args, "--config", harness.configPath]),
      );

      expect(output.result).toBe(0);
      expect(output.stderr).toBe("");
      expect(JSON.parse(output.stdout)).toEqual(testCase.expected);
    });
  }

  it("runs the top-level init command as a guided, re-runnable setup", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["init", "--config", harness.configPath]),
    );

    expect(output.result).toBe(0);
    expect(output.stderr).toBe("");
    expect(JSON.parse(output.stdout)).toMatchObject({
      ok: true,
      command: "init",
      status: "waiting",
      config_path: harness.configPath,
      plugin: {
        selected_runtime: "auto",
        installed_now: [],
        runtimes: [
          { runtime: "hermes", installed: true },
          { runtime: "openclaw", installed: true },
        ],
      },
      daemon: { running: true, started_now: false },
      doctor: { ok: true, fail: 0 },
      wallet: { name: "main", address: TEST_WALLET },
      identity: null,
      next_actions: ["regents identity ensure"],
    });
    expect(runScopedDoctorMock).toHaveBeenCalledWith(
      { scope: "runtime" },
      { configPath: harness.configPath },
    );
  });

  it("prints a readiness summary for bare regents and points to --help", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["--config", harness.configPath]),
    );

    expect(output.result).toBe(0);
    expect(output.stderr).toBe("");
    expect(JSON.parse(output.stdout)).toMatchObject({
      ok: true,
      command: "overview",
      status: "waiting",
      components: expect.arrayContaining([
        expect.objectContaining({ name: "runtime", status: "ready" }),
        expect.objectContaining({ name: "wallet", status: "ready" }),
        expect.objectContaining({ name: "identity", status: "waiting" }),
        expect.objectContaining({ name: "sign-ins", status: "waiting" }),
      ]),
      help: "Run regents --help for all commands.",
    });
  });

  it("runs the top-level status command", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["status", "--config", harness.configPath]),
    );

    expect(output.result).toBe(0);
    expect(output.stderr).toBe("");
    expect(JSON.parse(output.stdout)).toMatchObject({
      ok: true,
      command: "status",
      status: expect.any(String),
      config_path: harness.configPath,
    });
  });

  it("runs the top-level whoami command", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["whoami", "--config", harness.configPath]),
    );

    expect(output.result).toBe(0);
    expect(output.stderr).toBe("");
    expect(JSON.parse(output.stdout)).toMatchObject({
      ok: true,
      command: "whoami",
      wallet: {
        name: "main",
        address: TEST_WALLET,
      },
    });
  });


  it("aliases regents settings to the config get output", async () => {
    const settingsOutput = await captureOutput(async () =>
      harness.runCliEntrypoint(["settings", "--config", harness.configPath]),
    );
    const configGetOutput = await captureOutput(async () =>
      harness.runCliEntrypoint(["config", "get", "--config", harness.configPath]),
    );

    expect(settingsOutput.result).toBe(0);
    expect(settingsOutput.stderr).toBe("");
    expect(JSON.parse(settingsOutput.stdout)).toEqual(JSON.parse(configGetOutput.stdout));
  });

  it("shows a paginated work summary for bare regents techtree work on a terminal", async () => {
    daemonCallMock.mockImplementationOnce(async () => ({
      data: [
        { id: "benchmark:bench_1", kind: "benchmark", title: "First benchmark" },
        { id: "autoresearch:ar_2", kind: "autoresearch", title: "Second study" },
      ],
    }));

    const originalIsTty = process.stdout.isTTY;
    const originalNoColor = process.env.NO_COLOR;
    const originalTerm = process.env.TERM;
    process.stdout.isTTY = true;
    delete process.env.NO_COLOR;
    process.env.TERM = "xterm";
    try {
      const output = await captureOutput(async () =>
        harness.runCliEntrypoint(["techtree", "work", "--config", harness.configPath]),
      );

      expect(output.result).toBe(0);
      expect(output.stderr).toBe("");
      expect(output.stdout).toContain("AVAILABLE WORK");
      expect(output.stdout).toContain("benchmark:bench_1");
      expect(output.stdout).toContain("Page 1 of 1");
    } finally {
      process.stdout.isTTY = originalIsTty;
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }
      if (originalTerm === undefined) {
        delete process.env.TERM;
      } else {
        process.env.TERM = originalTerm;
      }
    }
  });

  it("returns an error for unknown commands", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["definitely-not-real", "--config", harness.configPath]),
    );

    expect(output.result).toBe(2);
    expect(output.stdout).toBe("");
    expect(JSON.parse(output.stderr)).toEqual({
      error: expect.objectContaining({
        code: "unknown_command",
        message: "Unknown command: definitely-not-real",
      }),
    });
  });

  it("returns a structured usage error when a required positional is missing", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["techtree", "node", "get", "--config", harness.configPath]),
    );

    expect(output.result).toBe(2);
    expect(output.stdout).toBe("");
    expect(JSON.parse(output.stderr)).toEqual({
      error: expect.objectContaining({
        code: "missing_required_argument",
        message: "Missing required argument: <id>.",
        command: "regents techtree node get <id>",
        usage: "regents techtree node get <id>",
        missing: ["<id>"],
      }),
    });
  });

  it("suggests the nearest commands for a close misspelling", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["techtree", "node", "gte", "5", "--config", harness.configPath]),
    );

    expect(output.result).toBe(2);
    const payload = JSON.parse(output.stderr) as {
      error: { code: string; valid_values: string[] };
    };
    expect(payload.error.code).toBe("unknown_command");
    expect(payload.error.valid_values).toContain("regents techtree node get <id>");
  });

  it("dispatches techtree science-tasks get when --config comes first", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["--config", harness.configPath, "techtree", "science-tasks", "get", "301"]),
    );

    expect(output.result).toBe(0);
    expect(output.stderr).toBe("");
    expect(JSON.parse(output.stdout)).toEqual({
      method: "techtree.scienceTasks.get",
      params: { id: 301 },
    });
  });

  it("dispatches doctor default through the local runtime doctor engine", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["doctor", "--json", "--config", harness.configPath]),
    );

    expect(output.result).toBe(0);
    expect(output.stderr).toBe("");
    expect(daemonCallMock).not.toHaveBeenCalled();
    expect(runDoctorMock).toHaveBeenCalledWith(
      { json: true, verbose: false, fix: false },
      { configPath: harness.configPath },
    );
  });

  it("passes doctor --fix through the local runtime doctor engine", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["doctor", "--fix", "--json", "--config", harness.configPath]),
    );

    expect(output.result).toBe(0);
    expect(output.stderr).toBe("");
    expect(runDoctorMock).toHaveBeenCalledWith(
      { json: true, verbose: false, fix: true },
      { configPath: harness.configPath },
    );
  });

  it("prints the contract next_step when a command fails", async () => {
    daemonCallMock.mockRejectedValueOnce(new Error("daemon unavailable"));

    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["techtree", "fold", "status", "--json", "--config", harness.configPath]),
    );

    expect(output.result).toBe(1);
    expect(JSON.parse(output.stderr)).toEqual({
      error: {
        code: "command_failed",
        message: "daemon unavailable",
        next_steps: ["regents techtree fold report --agent <agent-id> --json"],
      },
    });
  });

  it("passes modern doctor output flags through the local runtime doctor engine", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["doctor", "--quiet", "--only-failures", "--ci", "--config", harness.configPath]),
    );

    expect(output.result).toBe(0);
    expect(output.stderr).toBe("");
    expect(runDoctorMock).toHaveBeenCalledWith(
      { json: false, verbose: false, fix: false },
      { configPath: harness.configPath },
    );
  });

  it("dispatches doctor scoped through the local runtime doctor engine", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["doctor", "auth", "--json", "--verbose", "--fix", "--config", harness.configPath]),
    );

    expect(output.result).toBe(0);
    expect(output.stderr).toBe("");
    expect(daemonCallMock).not.toHaveBeenCalled();
    expect(runScopedDoctorMock).toHaveBeenCalledWith(
      { scope: "auth", json: true, verbose: true, fix: true },
      { configPath: harness.configPath },
    );
  });

  it("dispatches doctor full through the local runtime doctor engine", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["doctor", "--json", "--full", "--known-parent-id", "7", "--config", harness.configPath]),
    );

    expect(output.result).toBe(0);
    expect(output.stderr).toBe("");
    expect(daemonCallMock).not.toHaveBeenCalled();
    expect(runFullDoctorMock).toHaveBeenCalledWith(
      { json: true, verbose: false, fix: false, knownParentId: 7, cleanupCommentBodyPrefix: undefined },
      { configPath: harness.configPath },
    );
  });

  it("dispatches the Techtree main fetch and verify commands", async () => {
    const fetchOutput = await captureOutput(async () =>
      harness.runCliEntrypoint([
        "techtree",
        "main",
        "fetch",
        "0x1234000000000000000000000000000000000000000000000000000000000000",
        "--config",
        harness.configPath,
      ]),
    );
    expect(fetchOutput.result).toBe(0);
    expect(JSON.parse(fetchOutput.stdout)).toEqual({
      ok: true,
      tree: "main",
      node_id: "0x1234000000000000000000000000000000000000000000000000000000000000",
      node_type: "artifact",
      manifest_cid: "bafy-fetch-manifest",
      payload_cid: "bafy-fetch-payload",
      verified: true,
    });

    const verifyOutput = await captureOutput(async () =>
      harness.runCliEntrypoint([
        "techtree",
        "main",
        "verify",
        "0x1234000000000000000000000000000000000000000000000000000000000000",
        "--config",
        harness.configPath,
      ]),
    );
    expect(verifyOutput.result).toBe(0);
    expect(JSON.parse(verifyOutput.stdout)).toEqual(
      expect.objectContaining({
        ok: true,
        tree: "main",
        node_id: "0x1234000000000000000000000000000000000000000000000000000000000000",
      }),
    );
  });

  it("returns JSON errors for invalid node ids", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["techtree", "node", "get", "0", "--config", harness.configPath]),
    );

    expect(output.result).toBe(2);
    expect(output.stdout).toBe("");
    expect(JSON.parse(output.stderr)).toEqual({
      error: expect.objectContaining({
        code: "invalid_flag_value",
        command: "regents techtree node get <id>",
        usage: "regents techtree node get <id>",
        message: "invalid node id",
      }),
    });
  });

  it("returns JSON errors for invalid Techtree node ids in fetch", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["techtree", "main", "fetch", "0", "--config", harness.configPath]),
    );

    expect(output.result).toBe(2);
    expect(JSON.parse(output.stderr)).toEqual({
      error: expect.objectContaining({
        code: "invalid_flag_value",
        message: "invalid node id",
      }),
    });
  });

  it("returns JSON errors when techtree search is missing --query", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["techtree", "search", "--config", harness.configPath]),
    );

    expect(output.result).toBe(2);
    expect(JSON.parse(output.stderr)).toEqual({
      error: expect.objectContaining({
        code: "missing_required_argument",
        command: "regents techtree search",
        usage: "regents techtree search --query <text> [--limit <n>] [--json]",
        missing: ["--query"],
        message: "--query is required.",
      }),
    });
  });

  it("returns daemon errors as JSON", async () => {
    const { CommandExitError } = await import("../src/internal-runtime/errors.js");
    ensureIdentityMock.mockRejectedValueOnce(
      new CommandExitError("SERVICE_UNAVAILABLE", "Shared Regent service unavailable."),
    );

    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["identity", "ensure", "--json", "--config", harness.configPath]),
    );

    expect(output.result).toBe(5);
    expect(output.stderr).toBe("");
    expect(JSON.parse(output.stdout)).toEqual({
      status: "error",
      code: "SERVICE_UNAVAILABLE",
      message: "Shared Regent service unavailable.",
    });
  });

  it("returns exit code 3 when doctor surfaces an internal runtime failure", async () => {
    runDoctorMock.mockResolvedValueOnce({
      ok: false,
      mode: "default",
      summary: { ok: 0, warn: 0, fail: 1, skip: 0 },
      checks: [
        {
          id: "runtime.internal",
          scope: "runtime",
          status: "fail",
          title: "internal check",
          message: "Doctor check crashed before it could return a result",
          details: { internal: true, code: "doctor_check_crashed" },
          startedAt: "2026-03-11T00:00:00.000Z",
          finishedAt: "2026-03-11T00:00:00.001Z",
          durationMs: 1,
        },
      ],
      nextSteps: ["Inspect the failing doctor check implementation and retry"],
      generatedAt: "2026-03-11T00:00:00.002Z",
    });

    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["doctor", "--json", "--config", harness.configPath]),
    );

    expect(output.result).toBe(3);
    expect(output.stderr).toBe("");
  });

  it("treats flags without values as missing required inputs instead of swallowing the next flag", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint([
        "techtree",
        "search",
        "--config",
        harness.configPath,
        "--query",
        "--limit",
        "2",
      ]),
    );

    expect(output.result).toBe(2);
    expect(JSON.parse(output.stderr)).toEqual({
      error: expect.objectContaining({
        code: "missing_required_argument",
        command: "regents techtree search",
        usage: "regents techtree search --query <text> [--limit <n>] [--json]",
        missing: ["--query"],
        message: "--query is required.",
      }),
    });
  });
  it("rejects invalid BBH lanes before the daemon call", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["techtree", "bbh", "run", "exec", "--lane", "moon", "--config", harness.configPath]),
    );

    expect(output.result).toBe(1);
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain("invalid BBH lane; expected `climb`, `benchmark`, or `challenge`");
  });
});
