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
      agent_id: 99,
      agent_registry: TEST_REGISTRY,
      verified: "onchain",
      receipt_expires_at: "2999-01-01T00:00:00.000Z",
      cache_path: expect.stringContaining("receipt-v1.json"),
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
    name: "mcp export hermes",
    args: ["mcp", "export", "hermes", "--json"],
    expected: {
      ok: true,
      provider: "coinbase-cdp",
      mcpServers: {
        "coinbase-cdp": {
          transport: "stdio",
          command: "cdp",
          args: ["mcp"],
        },
      },
    },
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
    name: "agent profile show",
    args: ["agent", "profile", "show", "--profile", "public"],
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
      `{"encrypted_payload_uri":"ipfs://bafy-paid","seller_payout_address":"${TEST_REGISTRY}"}`,
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
          seller_payout_address: TEST_REGISTRY,
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
      "onchain",
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
          payment_rail: "onchain",
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
      "onchain",
      "--chain-id",
      "8453",
      "--usdc-token-address",
      TEST_WALLET,
      "--treasury-address",
      TEST_REGISTRY,
      "--seller-payout-address",
      TEST_WALLET,
      "--price-usdc",
      "25.000000",
    ],
    expected: {
      method: "techtree.autoskill.listing.create",
      params: {
        skill_node_id: 42,
        payment_rail: "onchain",
        chain_id: 8453,
        usdc_token_address: TEST_WALLET,
        treasury_address: TEST_REGISTRY,
        seller_payout_address: TEST_WALLET,
        price_usdc: "25.000000",
      },
    },
  },
  {
    name: "techtree autoskill buy",
    args: ["techtree", "autoskill", "buy", "42"],
    expected: {
      method: "techtree.autoskill.buy",
      params: {
        node_id: 42,
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
    name: "techtree main artifact init",
    args: ["techtree", "main", "artifact", "init", "artifact-workspace"],
    expected: {
      ok: true,
      tree: "main",
      entrypoint: "artifact.init",
      input: {
        tree: "main",
        workspace_path: path.resolve("artifact-workspace"),
      },
      workspace_path: path.resolve("artifact-workspace"),
    },
  },
  {
    name: "techtree main artifact compile",
    args: ["techtree", "main", "artifact", "compile", "--path", "artifact-workspace"],
    expected: expect.objectContaining({
      ok: true,
      entrypoint: "artifact.compile",
      input: {
        tree: "main",
        workspace_path: path.resolve("artifact-workspace"),
      },
      workspace_path: path.resolve("artifact-workspace"),
      dist_path: path.resolve("artifact-workspace", "dist"),
      manifest_path: path.resolve("artifact-workspace", "dist", "artifact.manifest.json"),
      payload_index_path: path.resolve("artifact-workspace", "dist", "payload.index.json"),
      node_header_path: path.resolve("artifact-workspace", "dist", "node-header.json"),
      checksums_path: path.resolve("artifact-workspace", "dist", "checksums.txt"),
      node_header: expect.objectContaining({
        nodeType: 1,
        schemaVersion: 1,
      }),
    }),
  },
  {
    name: "techtree main artifact pin",
    args: ["techtree", "main", "artifact", "pin", "artifact-workspace"],
    expected: {
      ok: true,
      tree: "main",
      node_id: expect.stringMatching(/^0xartifact0+$/),
      manifest_cid: "bafy-artifact-manifest",
      payload_cid: "bafy-artifact-payload",
      compiled: expect.objectContaining({
        dist_path: expect.any(String),
      }),
    },
  },
  {
    name: "techtree main artifact publish",
    args: ["techtree", "main", "artifact", "publish", "artifact-workspace"],
    expected: {
      ok: true,
      tree: "main",
      node_id: expect.stringMatching(/^0xartifact0+$/),
      manifest_cid: "bafy-artifact-manifest",
      payload_cid: "bafy-artifact-payload",
      tx_hash: `0x${"ab".repeat(32)}`,
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
    name: "techtree main run init",
    args: ["techtree", "main", "run", "init", "--artifact", "0x1234000000000000000000000000000000000000000000000000000000000000", "run-workspace"],
    expected: {
      ok: true,
      tree: "main",
      entrypoint: "run.init",
      input: {
        tree: "main",
        workspace_path: path.resolve("run-workspace"),
        artifact_id: "0x1234000000000000000000000000000000000000000000000000000000000000",
      },
      workspace_path: path.resolve("run-workspace"),
    },
  },
  {
    name: "techtree main run exec",
    args: [
      "techtree",
      "main",
      "run",
      "exec",
      "run-workspace",
      "--executor-harness-kind",
      "hermes",
      "--executor-harness-profile",
      "researcher",
      "--executor-harness-entrypoint",
      "analysis.py",
      "--origin-kind",
      "api",
      "--origin-transport",
      "api",
      "--origin-session-id",
      "session-123",
      "--origin-trigger-ref",
      "trigger-9",
    ],
    expected: {
      ok: true,
      tree: "main",
      entrypoint: "run.exec",
      input: {
        tree: "main",
        workspace_path: path.resolve("run-workspace"),
        metadata: {
          executor_harness: {
            kind: "hermes",
            profile: "researcher",
            entrypoint: "analysis.py",
          },
          origin: {
            kind: "api",
            transport: "api",
            session_id: "session-123",
            trigger_ref: "trigger-9",
          },
        },
      },
      workspace_path: path.resolve("run-workspace"),
      resolved_metadata: {
        resolved_at: "2026-03-20T00:00:00.000Z",
        executor_harness: {
          kind: "hermes",
          profile: "researcher",
          entrypoint: "analysis.py",
        },
        origin: {
          kind: "api",
          transport: "api",
          session_id: "session-123",
          trigger_ref: "trigger-9",
        },
        executor_harness_kind: "hermes",
        executor_harness_profile: "researcher",
        origin_session_id: "session-123",
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
    name: "techtree main run compile",
    args: ["techtree", "main", "run", "compile", "run-workspace"],
    expected: expect.objectContaining({
      ok: true,
      entrypoint: "run.compile",
      workspace_path: path.resolve("run-workspace"),
      dist_path: path.resolve("run-workspace", "dist"),
      manifest_path: path.resolve("run-workspace", "dist", "run.manifest.json"),
      payload_index_path: path.resolve("run-workspace", "dist", "payload.index.json"),
      node_header_path: path.resolve("run-workspace", "dist", "node-header.json"),
      checksums_path: path.resolve("run-workspace", "dist", "checksums.txt"),
      node_header: expect.objectContaining({ nodeType: 2 }),
    }),
  },
  {
    name: "techtree main run pin",
    args: ["techtree", "main", "run", "pin", "run-workspace"],
    expected: {
      ok: true,
      tree: "main",
      node_id: expect.stringMatching(/^0xrun0+$/),
      manifest_cid: "bafy-run-manifest",
      payload_cid: "bafy-run-payload",
      compiled: expect.objectContaining({
        dist_path: path.resolve("run-workspace", "dist"),
        node_header: expect.objectContaining({ nodeType: 2 }),
      }),
    },
  },
  {
    name: "techtree main run publish",
    args: ["techtree", "main", "run", "publish", "run-workspace"],
    expected: {
      ok: true,
      tree: "main",
      node_id: expect.stringMatching(/^0xrun0+$/),
      manifest_cid: "bafy-run-manifest",
      payload_cid: "bafy-run-payload",
      tx_hash: `0x${"ab".repeat(32)}`,
    },
  },
  {
    name: "techtree main review init",
    args: ["techtree", "main", "review", "init", "--target", "0x5678000000000000000000000000000000000000000000000000000000000000", "review-workspace"],
    expected: {
      ok: true,
      tree: "main",
      entrypoint: "review.init",
      input: {
        tree: "main",
        workspace_path: path.resolve("review-workspace"),
        target_id: "0x5678000000000000000000000000000000000000000000000000000000000000",
      },
      workspace_path: path.resolve("review-workspace"),
    },
  },
  {
    name: "techtree main review compile",
    args: ["techtree", "main", "review", "compile", "review-workspace"],
    expected: expect.objectContaining({
      ok: true,
      entrypoint: "review.compile",
      workspace_path: path.resolve("review-workspace"),
      dist_path: path.resolve("review-workspace", "dist"),
      manifest_path: path.resolve("review-workspace", "dist", "review.manifest.json"),
      payload_index_path: path.resolve("review-workspace", "dist", "payload.index.json"),
      node_header_path: path.resolve("review-workspace", "dist", "node-header.json"),
      checksums_path: path.resolve("review-workspace", "dist", "checksums.txt"),
      node_header: expect.objectContaining({ nodeType: 3 }),
    }),
  },
  {
    name: "techtree main review pin",
    args: ["techtree", "main", "review", "pin", "review-workspace"],
    expected: {
      ok: true,
      tree: "main",
      node_id: expect.stringMatching(/^0xreview0+$/),
      manifest_cid: "bafy-review-manifest",
      payload_cid: "bafy-review-payload",
      compiled: expect.objectContaining({
        dist_path: path.resolve("review-workspace", "dist"),
        node_header: expect.objectContaining({ nodeType: 3 }),
      }),
    },
  },
  {
    name: "techtree main review publish",
    args: ["techtree", "main", "review", "publish", "review-workspace"],
    expected: {
      ok: true,
      tree: "main",
      node_id: expect.stringMatching(/^0xreview0+$/),
      manifest_cid: "bafy-review-manifest",
      payload_cid: "bafy-review-payload",
      tx_hash: `0x${"ab".repeat(32)}`,
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

  it("dispatches the new artifact/run/review/fetch/verify command family", async () => {
    const artifactInit = await captureOutput(async () =>
      harness.runCliEntrypoint(["techtree", "main", "artifact", "init", "artifact-workspace", "--config", harness.configPath]),
    );
    expect(artifactInit.result).toBe(0);
    expect(JSON.parse(artifactInit.stdout)).toEqual({
      ok: true,
      tree: "main",
      entrypoint: "artifact.init",
      input: {
        tree: "main",
        workspace_path: path.resolve("artifact-workspace"),
      },
      workspace_path: path.resolve("artifact-workspace"),
    });

    const artifactCompile = await captureOutput(async () =>
      harness.runCliEntrypoint([
        "techtree",
        "main",
        "artifact",
        "compile",
        "--path",
        "artifact-workspace",
        "--config",
        harness.configPath,
      ]),
    );
    expect(artifactCompile.result).toBe(0);
    expect(JSON.parse(artifactCompile.stdout)).toEqual(
      expect.objectContaining({
        ok: true,
        entrypoint: "artifact.compile",
        dist_path: path.resolve("artifact-workspace", "dist"),
        node_header: expect.objectContaining({ nodeType: 1, schemaVersion: 1 }),
      }),
    );

    const runPin = await captureOutput(async () =>
      harness.runCliEntrypoint(["techtree", "main", "run", "pin", "run-workspace", "--config", harness.configPath]),
    );
    expect(runPin.result).toBe(0);
    expect(JSON.parse(runPin.stdout)).toEqual(
      expect.objectContaining({
        ok: true,
        tree: "main",
        manifest_cid: "bafy-run-manifest",
        payload_cid: "bafy-run-payload",
        compiled: expect.objectContaining({
          node_header: expect.objectContaining({ nodeType: 2 }),
        }),
      }),
    );

    const reviewPublish = await captureOutput(async () =>
      harness.runCliEntrypoint([
        "techtree",
        "main",
        "review",
        "publish",
        "review-workspace",
        "--config",
        harness.configPath,
      ]),
    );
    expect(reviewPublish.result).toBe(0);
    expect(JSON.parse(reviewPublish.stdout)).toEqual(
      expect.objectContaining({
        ok: true,
        tree: "main",
        manifest_cid: "bafy-review-manifest",
        payload_cid: "bafy-review-payload",
        tx_hash: `0x${"ab".repeat(32)}`,
      }),
    );

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

    expect(output.result).toBe(1);
    expect(output.stdout).toBe("");
    expect(JSON.parse(output.stderr)).toEqual({ error: { message: "invalid node id" } });
  });

  it("returns JSON errors for invalid Techtree node ids in fetch", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["techtree", "main", "fetch", "0", "--config", harness.configPath]),
    );

    expect(output.result).toBe(1);
    expect(JSON.parse(output.stderr)).toEqual({
      error: {
        message: "invalid node id",
      },
    });
  });

  it("returns JSON errors when techtree search is missing --query", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["techtree", "search", "--config", harness.configPath]),
    );

    expect(output.result).toBe(1);
    expect(JSON.parse(output.stderr)).toEqual({
      error: {
        message: "missing required argument: --query",
      },
    });
  });

  it("returns daemon errors as JSON", async () => {
    const { CommandExitError } = await import("../src/internal-runtime/errors.js");
    ensureIdentityMock.mockRejectedValueOnce(
      new CommandExitError("SERVICE_UNAVAILABLE", "Shared Regent service unavailable.", 30),
    );

    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["identity", "ensure", "--json", "--config", harness.configPath]),
    );

    expect(output.result).toBe(30);
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
        "main",
        "run",
        "init",
        "--config",
        harness.configPath,
        "--artifact",
        "--path",
        "run-workspace",
      ]),
    );

    expect(output.result).toBe(1);
    expect(JSON.parse(output.stderr)).toEqual({
      error: {
        message: "missing required argument: artifact id",
      },
    });
  });

  it("rejects the legacy BBH --split flag", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["techtree", "bbh", "run", "exec", "--split", "train", "--config", harness.configPath]),
    );

    expect(output.result).toBe(1);
    expect(output.stderr).toContain("use --lane with `climb`, `benchmark`, `challenge`, or `draft`");
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
