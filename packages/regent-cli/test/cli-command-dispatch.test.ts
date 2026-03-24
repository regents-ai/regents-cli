import path from "node:path";

import { describe, expect, it } from "vitest";

import { captureOutput } from "../../../test-support/test-helpers.js";
import {
  CommandCase,
  TEST_REGISTRY,
  TEST_WALLET,
  daemonCallMock,
  runDoctorMock,
  runFullDoctorMock,
  runScopedDoctorMock,
  setupCliEntrypointHarness,
} from "./helpers/cli-entrypoint-support.js";

const harness = setupCliEntrypointHarness();

const commandCases: CommandCase[] = [
  {
    name: "auth siwa login",
    args: [
      "auth",
      "siwa",
      "login",
      "--wallet-address",
      TEST_WALLET,
      "--chain-id",
      "11155111",
      "--registry-address",
      TEST_REGISTRY,
      "--token-id",
      "99",
      "--audience",
      "techtree",
    ],
    expected: {
      method: "auth.siwa.login",
      params: {
        walletAddress: TEST_WALLET,
        chainId: 11155111,
        registryAddress: TEST_REGISTRY,
        tokenId: "99",
        audience: "techtree",
      },
    },
  },
  { name: "auth siwa status", args: ["auth", "siwa", "status"], expected: { method: "auth.siwa.status" } },
  { name: "auth siwa logout", args: ["auth", "siwa", "logout"], expected: { method: "auth.siwa.logout" } },
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
    const { JsonRpcError } = await import("../src/internal-runtime/index.js");
    daemonCallMock.mockRejectedValueOnce(new JsonRpcError("daemon exploded", { code: "daemon_exploded" }));

    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["auth", "siwa", "login", "--config", harness.configPath]),
    );

    expect(output.result).toBe(1);
    expect(JSON.parse(output.stderr)).toEqual({
      error: { code: "daemon_exploded", message: "daemon exploded" },
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
