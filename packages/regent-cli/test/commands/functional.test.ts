import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RegentRuntime, writeInitialConfig } from "../../src/internal-runtime/index.js";

import { runCliEntrypoint } from "../../src/index.js";
import { TechtreeContractServer } from "../../../../test-support/techtree-contract-server.js";
import { describeNetwork } from "../../../../test-support/integration.js";
import { captureOutput } from "../../../../test-support/test-helpers.js";

const TEST_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const TEST_WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TEST_REGISTRY = "0x2222222222222222222222222222222222222222";

describeNetwork.sequential("CLI functional flows against the real runtime", () => {
  let server: TechtreeContractServer;
  let runtime: RegentRuntime | null = null;
  let configPath = "";
  let originalPrivateKey: string | undefined;

  beforeEach(async () => {
    server = new TechtreeContractServer();
    await server.start();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-cli-functional-"));
    configPath = path.join(tempDir, "regent.config.json");
    originalPrivateKey = process.env.REGENT_WALLET_PRIVATE_KEY;
    process.env.REGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY;

    writeInitialConfig(configPath, {
      runtime: {
        socketPath: path.join(tempDir, "runtime", "regent.sock"),
        stateDir: path.join(tempDir, "state"),
        logLevel: "debug",
      },
      techtree: {
        baseUrl: server.baseUrl,
        audience: "techtree",
        defaultChainId: 11155111,
        requestTimeoutMs: 1_000,
      },
      wallet: {
        privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
        keystorePath: path.join(tempDir, "keys", "agent-wallet.json"),
      },
    });

    runtime = new RegentRuntime(configPath);
    await runtime.start();
  });

  afterEach(async () => {
    if (runtime) {
      await runtime.stop();
    }
    await server.stop();
    process.env.REGENT_WALLET_PRIVATE_KEY = originalPrivateKey;
  });

  it("logs in, reports auth status, and logs out", async () => {
    const loginOutput = await captureOutput(async () =>
      runCliEntrypoint([
        "auth",
        "siwa",
        "login",
        "--config",
        configPath,
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
      ]),
    );

    expect(loginOutput.result).toBe(0);
    expect(JSON.parse(loginOutput.stdout)).toEqual(
      expect.objectContaining({
        code: "siwa_verified",
        data: expect.objectContaining({
          walletAddress: TEST_WALLET,
        }),
      }),
    );

    const statusOutput = await captureOutput(async () =>
      runCliEntrypoint(["auth", "siwa", "status", "--config", configPath]),
    );
    expect(statusOutput.result).toBe(0);
    expect(JSON.parse(statusOutput.stdout)).toEqual({
      authenticated: true,
      session: expect.objectContaining({
        walletAddress: TEST_WALLET,
      }),
      agentIdentity: {
        walletAddress: TEST_WALLET,
        chainId: 11155111,
        registryAddress: TEST_REGISTRY,
        tokenId: "99",
      },
      protectedRoutesReady: true,
      missingIdentityFields: [],
    });

    const logoutOutput = await captureOutput(async () =>
      runCliEntrypoint(["auth", "siwa", "logout", "--config", configPath]),
    );
    expect(logoutOutput.result).toBe(0);
    expect(JSON.parse(logoutOutput.stdout)).toEqual({ ok: true });
  }, 15_000);

  it("makes the protected-route identity prerequisite explicit in auth status and failures", async () => {
    const loginOutput = await captureOutput(async () =>
      runCliEntrypoint([
        "auth",
        "siwa",
        "login",
        "--config",
        configPath,
        "--wallet-address",
        TEST_WALLET,
        "--chain-id",
        "11155111",
      ]),
    );
    expect(loginOutput.result).toBe(0);

    const statusOutput = await captureOutput(async () =>
      runCliEntrypoint(["auth", "siwa", "status", "--config", configPath]),
    );
    expect(statusOutput.result).toBe(0);
    expect(JSON.parse(statusOutput.stdout)).toEqual({
      authenticated: true,
      session: expect.objectContaining({
        walletAddress: TEST_WALLET,
      }),
      agentIdentity: null,
      protectedRoutesReady: false,
      missingIdentityFields: ["walletAddress", "chainId", "registryAddress", "tokenId"],
    });

    const workPacketOutput = await captureOutput(async () =>
      runCliEntrypoint(["techtree", "node", "work-packet", "1", "--config", configPath]),
    );
    expect(workPacketOutput.result).toBe(1);
    expect(JSON.parse(workPacketOutput.stderr)).toEqual({
      error: {
        code: "agent_identity_missing",
        message: expect.stringContaining("registryAddress, tokenId"),
      },
    });
  }, 15_000);

  it("rejects partial protected-route identity flags during SIWA login", async () => {
    const loginOutput = await captureOutput(async () =>
      runCliEntrypoint([
        "auth",
        "siwa",
        "login",
        "--config",
        configPath,
        "--wallet-address",
        TEST_WALLET,
        "--chain-id",
        "11155111",
        "--registry-address",
        TEST_REGISTRY,
      ]),
    );

    expect(loginOutput.result).toBe(1);
    expect(JSON.parse(loginOutput.stderr)).toEqual({
      error: {
        code: "invalid_agent_identity",
        message:
          "provide --registry-address and --token-id together so protected Techtree routes can identify the current agent",
      },
    });
  }, 15_000);

  it("covers public reads and transport status through the CLI", async () => {
    const targetNodeId = 1;
    const childNodeId = 2;

    const loginOutput = await captureOutput(async () =>
      runCliEntrypoint([
        "auth",
        "siwa",
        "login",
        "--config",
        configPath,
        "--wallet-address",
        TEST_WALLET,
        "--chain-id",
        "11155111",
        "--registry-address",
        TEST_REGISTRY,
        "--token-id",
        "99",
      ]),
    );
    expect(loginOutput.result).toBe(0);

    const techtreeStatusOutput = await captureOutput(async () =>
      runCliEntrypoint(["techtree", "status", "--config", configPath]),
    );
    expect(techtreeStatusOutput.result).toBe(0);
    expect(JSON.parse(techtreeStatusOutput.stdout)).toEqual({
      config: expect.objectContaining({
        baseUrl: server.baseUrl,
        audience: "techtree",
      }),
      health: {
        ok: true,
        service: "techtree-contract-server",
      },
    });

    const nodesListOutput = await captureOutput(async () =>
      runCliEntrypoint(["techtree", "nodes", "list", "--limit", "5", "--seed", "ml", "--config", configPath]),
    );
    expect(nodesListOutput.result).toBe(0);
    expect(JSON.parse(nodesListOutput.stdout)).toEqual({
      data: expect.arrayContaining([
        expect.objectContaining({
          id: 1,
          seed: "ml",
          kind: "hypothesis",
        }),
      ]),
    });

    const activityOutput = await captureOutput(async () =>
      runCliEntrypoint(["techtree", "activity", "--limit", "2", "--config", configPath]),
    );
    expect(activityOutput.result).toBe(0);
    expect(JSON.parse(activityOutput.stdout)).toEqual({
      data: [
        expect.objectContaining({
          event_type: "node_created",
          subject_node_id: 1,
        }),
        expect.objectContaining({
          event_type: "comment_added",
          subject_node_id: 1,
        }),
      ],
    });

    const searchOutput = await captureOutput(async () =>
      runCliEntrypoint(["techtree", "search", "--query", "Root", "--limit", "2", "--config", configPath]),
    );
    expect(searchOutput.result).toBe(0);
    expect(JSON.parse(searchOutput.stdout)).toEqual({
      data: {
        nodes: [
          expect.objectContaining({
            id: 1,
            title: "Root node",
          }),
        ],
        comments: [],
      },
    });

    const childrenOutput = await captureOutput(async () =>
      runCliEntrypoint(["techtree", "node", "children", "1", "--limit", "20", "--config", configPath]),
    );
    expect(childrenOutput.result).toBe(0);
    expect(JSON.parse(childrenOutput.stdout)).toEqual({
      data: expect.arrayContaining([
        expect.objectContaining({
          id: childNodeId,
          parent_id: 1,
        }),
      ]),
    });

    const watchOutput = await captureOutput(async () =>
      runCliEntrypoint(["techtree", "watch", String(targetNodeId), "--config", configPath]),
    );
    expect(watchOutput.result).toBe(0);
    expect(JSON.parse(watchOutput.stdout)).toEqual({
      data: expect.objectContaining({
        node_id: targetNodeId,
        watcher_type: "agent",
      }),
    });

    const unwatchOutput = await captureOutput(async () =>
      runCliEntrypoint(["techtree", "unwatch", String(targetNodeId), "--config", configPath]),
    );
    expect(unwatchOutput.result).toBe(0);
    expect(JSON.parse(unwatchOutput.stdout)).toEqual({ ok: true });

    const commentsOutput = await captureOutput(async () =>
      runCliEntrypoint([
        "techtree",
        "node",
        "comments",
        String(targetNodeId),
        "--limit",
        "20",
        "--config",
        configPath,
      ]),
    );
    expect(commentsOutput.result).toBe(0);
    expect(JSON.parse(commentsOutput.stdout)).toEqual({
      data: expect.arrayContaining([
        expect.objectContaining({
          id: expect.any(Number),
          node_id: targetNodeId,
          body_markdown: "Existing comment",
        }),
      ]),
    });

    const workPacketOutput = await captureOutput(async () =>
      runCliEntrypoint([
        "techtree",
        "node",
        "work-packet",
        String(targetNodeId),
        "--config",
        configPath,
      ]),
    );
    expect(workPacketOutput.result).toBe(0);
    expect(JSON.parse(workPacketOutput.stdout)).toEqual({
      data: expect.objectContaining({
        node: expect.objectContaining({
          id: targetNodeId,
        }),
        comments: expect.any(Array),
        activity_events: expect.any(Array),
      }),
    });

    const rootWatchOutput = await captureOutput(async () =>
      runCliEntrypoint(["techtree", "watch", String(targetNodeId), "--config", configPath]),
    );
    expect(rootWatchOutput.result).toBe(0);
    expect(JSON.parse(rootWatchOutput.stdout)).toEqual({
      data: {
        id: 801,
        node_id: targetNodeId,
        watcher_type: "agent",
        watcher_ref: 1,
        inserted_at: "2026-03-10T00:00:00.000Z",
      },
    });

    const watchListOutput = await captureOutput(async () =>
      runCliEntrypoint(["techtree", "watch", "list", "--config", configPath]),
    );
    expect(watchListOutput.result).toBe(0);
    expect(JSON.parse(watchListOutput.stdout)).toEqual({
      data: [
        {
          id: 801,
          node_id: targetNodeId,
          watcher_type: "agent",
          watcher_ref: 1,
          inserted_at: "2026-03-10T00:00:00.000Z",
        },
      ],
    });

    const starOutput = await captureOutput(async () =>
      runCliEntrypoint(["techtree", "star", String(targetNodeId), "--config", configPath]),
    );
    expect(starOutput.result).toBe(0);
    expect(JSON.parse(starOutput.stdout)).toEqual({
      data: {
        id: 900,
        node_id: targetNodeId,
        actor_type: "agent",
        actor_ref: 1,
        inserted_at: "2026-03-10T00:00:00.000Z",
      },
    });

    const unstarOutput = await captureOutput(async () =>
      runCliEntrypoint(["techtree", "unstar", String(targetNodeId), "--config", configPath]),
    );
    expect(unstarOutput.result).toBe(0);
    expect(JSON.parse(unstarOutput.stdout)).toEqual({ ok: true });

    const inboxOutput = await captureOutput(async () =>
      runCliEntrypoint([
        "techtree",
        "inbox",
        "--limit",
        "5",
        "--seed",
        "ml",
        "--kind",
        "comment,mention",
        "--config",
        configPath,
      ]),
    );
    expect(inboxOutput.result).toBe(0);
    expect(JSON.parse(inboxOutput.stdout)).toEqual({
      events: expect.arrayContaining([
        expect.objectContaining({
          actor_type: "agent",
          actor_ref: 1,
          stream: "agent_inbox",
          payload: expect.objectContaining({
            seed: "ml",
            kind_filters: ["comment", "mention"],
          }),
          inserted_at: "2026-03-10T00:00:00.000Z",
        }),
      ]),
      next_cursor: expect.any(Number),
    });

    const opportunitiesOutput = await captureOutput(async () =>
      runCliEntrypoint([
        "techtree",
        "opportunities",
        "--limit",
        "2",
        "--seed",
        "ml",
        "--kind",
        "review",
        "--config",
        configPath,
      ]),
    );
    expect(opportunitiesOutput.result).toBe(0);
    expect(JSON.parse(opportunitiesOutput.stdout)).toEqual({
      opportunities: [
        {
          node_id: 1,
          title: "Root node",
          seed: "ml",
          kind: "hypothesis",
          opportunity_type: "review",
          activity_score: "1.0",
        },
      ],
    });

    const gossipsubStatusOutput = await captureOutput(async () =>
      runCliEntrypoint(["gossipsub", "status", "--config", configPath]),
    );
    expect(gossipsubStatusOutput.result).toBe(0);
    expect(JSON.parse(gossipsubStatusOutput.stdout)).toEqual({
      enabled: false,
      configured: false,
      connected: false,
      subscribedTopics: [],
      peerCount: 0,
      lastError: null,
      eventSocketPath: null,
      status: "disabled",
      note: "Trollbox transport disabled",
    });
  }, 15_000);

  it("returns deterministic local failure paths for mutating commands", async () => {
    const missingArtifactIdOutput = await captureOutput(async () =>
      runCliEntrypoint([
        "techtree",
        "main",
        "run",
        "init",
        "--config",
        configPath,
        "--path",
        "run-workspace",
      ]),
    );
    expect(missingArtifactIdOutput.result).toBe(1);
    expect(JSON.parse(missingArtifactIdOutput.stderr)).toEqual({
      error: {
        message: "missing required argument: artifact id",
      },
    });

    const missingTargetOutput = await captureOutput(async () =>
      runCliEntrypoint([
        "techtree",
        "main",
        "review",
        "init",
        "--config",
        configPath,
        "--path",
        "review-workspace",
      ]),
    );
    expect(missingTargetOutput.result).toBe(1);
    expect(JSON.parse(missingTargetOutput.stderr)).toEqual({
      error: {
        message: "missing required argument: target id",
      },
    });

    const unauthenticatedWatchOutput = await captureOutput(async () =>
      runCliEntrypoint(["techtree", "watch", "1", "--config", configPath]),
    );
    expect(unauthenticatedWatchOutput.result).toBe(1);
    expect(JSON.parse(unauthenticatedWatchOutput.stderr)).toEqual({
      error: {
        code: "siwa_session_missing",
        message: "no SIWA session found; run `regent auth siwa login`",
      },
    });

    const unauthenticatedUnwatchOutput = await captureOutput(async () =>
      runCliEntrypoint(["techtree", "unwatch", "1", "--config", configPath]),
    );
    expect(unauthenticatedUnwatchOutput.result).toBe(1);
    expect(JSON.parse(unauthenticatedUnwatchOutput.stderr)).toEqual({
      error: {
        code: "siwa_session_missing",
        message: "no SIWA session found; run `regent auth siwa login`",
      },
    });
  }, 15_000);

  it("surfaces a daemon-unavailable failure path for logout", async () => {
    if (!runtime) {
      throw new Error("runtime was not initialized");
    }

    await runtime.stop();
    runtime = null;

    const logoutOutput = await captureOutput(async () =>
      runCliEntrypoint(["auth", "siwa", "logout", "--config", configPath]),
    );

    expect(logoutOutput.result).toBe(1);
    expect(JSON.parse(logoutOutput.stderr)).toEqual({
      error: {
        code: "jsonrpc_error",
        message: expect.stringContaining("unable to connect to daemon"),
      },
    });
  }, 15_000);

  it("runs doctor in human, json, scoped, and full modes through the CLI", async () => {
    const loginOutput = await captureOutput(async () =>
      runCliEntrypoint([
        "auth",
        "siwa",
        "login",
        "--config",
        configPath,
        "--wallet-address",
        TEST_WALLET,
        "--chain-id",
        "11155111",
        "--registry-address",
        TEST_REGISTRY,
        "--token-id",
        "99",
      ]),
    );
    expect(loginOutput.result).toBe(0);

    const humanDoctor = await captureOutput(async () =>
      runCliEntrypoint(["doctor", "--config", configPath]),
    );
    expect(humanDoctor.result).toBe(0);
    expect(humanDoctor.stdout).toContain("R E G E N T   D O C T O R");
    expect(humanDoctor.stdout).toContain("techtree health reachable");
    expect(humanDoctor.stdout).toContain("CHECK GRID");

    const jsonDoctor = await captureOutput(async () =>
      runCliEntrypoint(["doctor", "auth", "--json", "--config", configPath]),
    );
    expect(jsonDoctor.result).toBe(0);
    expect(JSON.parse(jsonDoctor.stdout)).toEqual(
      expect.objectContaining({
        mode: "scoped",
        scope: "auth",
        checks: expect.arrayContaining([
          expect.objectContaining({
            id: "auth.http-envelope.build",
            status: "ok",
          }),
        ]),
      }),
    );

    const fullDoctor = await captureOutput(async () =>
      runCliEntrypoint([
        "doctor",
        "--full",
        "--known-parent-id",
        "1",
        "--config",
        configPath,
      ]),
    );
    expect(fullDoctor.result).toBe(0);
    expect(fullDoctor.stdout).toContain("full proof node create");
    expect(fullDoctor.stdout).toContain("full proof comment readback");
    expect(fullDoctor.stdout).toContain("NEXT MOVES");
  }, 15_000);
});
