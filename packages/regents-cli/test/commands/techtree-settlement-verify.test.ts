import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCliEntrypoint } from "../../src/index.js";
import { writeInitialConfig } from "../../src/internal-runtime/config.js";
import { writeFakeCdp } from "../support/fake-cdp.js";
import { captureOutput, parsePrintedJson } from "../helpers/output.js";

const { readContractMock, getReceiptMock } = vi.hoisted(() => ({
  readContractMock: vi.fn(),
  getReceiptMock: vi.fn(),
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: () => ({
    address: "0x00000000000000000000000000000000000000aa",
    signMessage: async () => "0xsigned",
  }),
}));

vi.mock("viem/chains", () => ({
  base: { id: 8453, name: "Base" },
  baseSepolia: { id: 84532, name: "Base Sepolia" },
  mainnet: { id: 1, name: "Ethereum" },
}));

// Deterministic merkle math for the proof test: keccak256 returns its (trimmed)
// input padded to 32 bytes, so a single-leaf proof with no nodes verifies when
// the published root equals that padded leaf.
vi.mock("viem", () => ({
  http: (url: string) => ({ url }),
  isAddress: (value: string) => /^0x[0-9a-fA-F]{40}$/u.test(value),
  isHex: (value: string) => /^0x[0-9a-fA-F]*$/u.test(value),
  keccak256: (value: string) => `0x${value.slice(2, 66).padEnd(64, "0")}`.toLowerCase(),
  encodeAbiParameters: () => "0xabcdef",
  createWalletClient: () => ({ sendTransaction: vi.fn() }),
  createPublicClient: () => ({
    readContract: readContractMock,
    getTransactionReceipt: getReceiptMock,
    getBytecode: vi.fn(),
    call: vi.fn(),
    estimateGas: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  }),
}));

interface CheckPayload {
  readonly item: string;
  readonly status: string;
  readonly detail: string;
  readonly reason?: string;
  readonly next?: string;
}

interface VerifyPayload {
  readonly ok: boolean;
  readonly command: string;
  readonly status: string;
  readonly checks: readonly CheckPayload[];
}

describe("techtree settlement verify", () => {
  const testWallet = "0x1111111111111111111111111111111111111111";
  const rewardRouter = "0x7777777777777777777777777777777777777777";
  const postedTx = `0x${"a".repeat(64)}`;
  const merkleRoot = `0x${"b".repeat(64)}`;
  const otherRoot = `0x${"c".repeat(64)}`;

  const touchedEnvKeys = [
    "HOME",
    "PATH",
    "CDP_KEY_ID",
    "CDP_KEY_SECRET",
    "CDP_WALLET_SECRET",
    "REGENT_WALLET_PRIVATE_KEY",
    "TECHTREE_BASE_URL",
    "BASE_MAINNET_RPC_URL",
    "BASE_RPC_URL",
    "BASE_SEPOLIA_RPC_URL",
  ] as const;
  const savedEnv: Partial<Record<(typeof touchedEnvKeys)[number], string | undefined>> = {};
  const fetchMock = vi.fn<typeof fetch>();
  let homeDir = "";
  let configPath = "";

  const writeConfig = (): void => {
    writeInitialConfig(configPath);
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      services: {
        siwa: { baseUrl: string };
        platform: { baseUrl: string };
        autolaunch: { baseUrl: string };
        techtree: { baseUrl: string };
      };
    };
    config.services.siwa.baseUrl = "https://siwa.regents.test";
    config.services.platform.baseUrl = "https://platform.regents.test";
    config.services.autolaunch.baseUrl = "http://127.0.0.1:4010";
    config.services.techtree.baseUrl = "http://127.0.0.1:4020";
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  };

  const writeSession = (audience: "techtree" | "autolaunch"): void => {
    const statePath = path.join(homeDir, "state", "runtime-state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify(
        {
          agent: {
            walletAddress: testWallet,
            chainId: 8453,
            registryAddress: "0x2222222222222222222222222222222222222222",
            tokenId: "99",
          },
          siwa: {
            walletAddress: testWallet,
            chainId: 8453,
            nonce: "verify-nonce",
            keyId: testWallet.toLowerCase(),
            receipt: "verify-receipt",
            receiptExpiresAt: "2999-01-01T00:00:00.000Z",
            audience,
            registryAddress: "0x2222222222222222222222222222222222222222",
            tokenId: "99",
          },
        },
        null,
        2,
      ),
    );
  };

  const jsonResponse = (payload: unknown): Response =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const statusResponse = (): Record<string, unknown> => ({
    data: { contracts: { chain_id: 8453, reward_router: rewardRouter }, current_epoch: { epoch: 0 } },
  });

  const rewardsResponse = (manifests: readonly Record<string, unknown>[]): Record<string, unknown> => ({
    data: manifests,
  });

  const checkByItem = (payload: VerifyPayload, predicate: (item: string) => boolean): CheckPayload => {
    const check = payload.checks.find((candidate) => predicate(candidate.item));
    expect(check, "expected matching check row").toBeDefined();
    return check as CheckPayload;
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-settlement-verify-home-"));
    configPath = path.join(homeDir, "regent.config.json");
    for (const key of touchedEnvKeys) {
      savedEnv[key] = process.env[key];
    }
    process.env.HOME = homeDir;
    process.env.PATH = `${writeFakeCdp(homeDir, {
      accounts: [{ name: "main", address: testWallet }],
    })}:${savedEnv.PATH ?? ""}`;
    process.env.CDP_KEY_ID = "test-key";
    process.env.CDP_KEY_SECRET = "test-secret";
    process.env.CDP_WALLET_SECRET = "test-wallet-secret";
    process.env.REGENT_WALLET_PRIVATE_KEY =
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    process.env.TECHTREE_BASE_URL = "http://127.0.0.1:4020";
    delete process.env.BASE_MAINNET_RPC_URL;
    delete process.env.BASE_RPC_URL;
    delete process.env.BASE_SEPOLIA_RPC_URL;
    fetchMock.mockReset();
    readContractMock.mockReset();
    getReceiptMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of touchedEnvKeys) {
      const saved = savedEnv[key];
      if (saved === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved;
      }
    }
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const runVerify = async (extraArgs: readonly string[]) =>
    captureOutput(() =>
      runCliEntrypoint([
        "techtree",
        "settlement",
        "verify",
        ...extraArgs,
        "--json",
        "--config",
        configPath,
      ]),
    );

  // allocationRoots(epoch, lane) returns the AllocationRoot tuple.
  const stubAllocationRoot = (root: string): void => {
    readContractMock.mockImplementation(() => [root, 100n, `0x${"0".repeat(64)}`, 0n, true]);
  };

  it("reports MATCH for a posted manifest with a confirmed receipt and matching root", async () => {
    writeConfig();
    writeSession("techtree");
    process.env.BASE_MAINNET_RPC_URL = "https://base.example";
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/techtree/v1/tech/status")) return jsonResponse(statusResponse());
      if (url.includes("/api/techtree/v1/tech/rewards")) {
        return jsonResponse(
          rewardsResponse([{ lane: "science", status: "posted", merkle_root: merkleRoot, tx_hash: postedTx }]),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    getReceiptMock.mockResolvedValue({ status: "success", to: rewardRouter });
    stubAllocationRoot(merkleRoot);

    const output = await runVerify(["--epoch", "0", "--lane", "science"]);

    expect(output.result, output.stderr).toBe(0);
    const payload = parsePrintedJson(output.stdout) as VerifyPayload;
    expect(payload.command).toBe("techtree settlement verify");
    expect(payload.status).toBe("ready");
    expect(checkByItem(payload, (item) => item.startsWith("settlement receipt")).status).toBe("MATCH");
    expect(checkByItem(payload, (item) => item.startsWith("onchain root")).status).toBe("MATCH");
  });

  it("exits 1 with the paid_payload_entitlement next line when a posted receipt is missing", async () => {
    writeConfig();
    writeSession("techtree");
    process.env.BASE_MAINNET_RPC_URL = "https://base.example";
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/techtree/v1/tech/status")) return jsonResponse(statusResponse());
      if (url.includes("/api/techtree/v1/tech/rewards")) {
        return jsonResponse(
          rewardsResponse([{ lane: "science", status: "posted", merkle_root: merkleRoot, tx_hash: postedTx }]),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    getReceiptMock.mockRejectedValue(new Error("receipt not found"));

    const output = await runVerify(["--epoch", "0", "--lane", "science"]);

    expect(output.result).toBe(1);
    const payload = parsePrintedJson(output.stdout) as VerifyPayload;
    expect(payload.status).toBe("mismatch");
    const row = checkByItem(payload, (item) => item.startsWith("settlement receipt"));
    expect(row.status).toBe("MISMATCH");
    expect(row.next).toContain("chain wins for rewards");
    expect(row.next).toContain("paid_payload_entitlement (owner: techtree)");
  });

  it("exits 1 when the onchain root differs from the manifest root", async () => {
    writeConfig();
    writeSession("techtree");
    process.env.BASE_MAINNET_RPC_URL = "https://base.example";
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/techtree/v1/tech/status")) return jsonResponse(statusResponse());
      if (url.includes("/api/techtree/v1/tech/rewards")) {
        return jsonResponse(
          rewardsResponse([{ lane: "science", status: "posted", merkle_root: merkleRoot, tx_hash: postedTx }]),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    getReceiptMock.mockResolvedValue({ status: "success", to: rewardRouter });
    stubAllocationRoot(otherRoot);

    const output = await runVerify(["--epoch", "0", "--lane", "science"]);

    expect(output.result).toBe(1);
    const payload = parsePrintedJson(output.stdout) as VerifyPayload;
    const row = checkByItem(payload, (item) => item.startsWith("onchain root"));
    expect(row.status).toBe("MISMATCH");
    expect(row.next).toContain("chain wins for rewards");
  });

  it("reports MATCH (pending) for a prepared manifest with no tx hash", async () => {
    writeConfig();
    writeSession("techtree");
    process.env.BASE_MAINNET_RPC_URL = "https://base.example";
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/techtree/v1/tech/status")) return jsonResponse(statusResponse());
      if (url.includes("/api/techtree/v1/tech/rewards")) {
        return jsonResponse(
          rewardsResponse([{ lane: "science", status: "prepared", merkle_root: merkleRoot, tx_hash: null }]),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const output = await runVerify(["--epoch", "0", "--lane", "science"]);

    expect(output.result, output.stderr).toBe(0);
    const payload = parsePrintedJson(output.stdout) as VerifyPayload;
    expect(payload.status).toBe("ready");
    const row = checkByItem(payload, (item) => item.startsWith("settlement"));
    expect(row.status).toBe("MATCH");
    expect(row.detail).toContain("pending");
  });

  it("reports UNVERIFIABLE with the techtree login command when there is no techtree session", async () => {
    writeConfig();
    writeSession("autolaunch");
    process.env.BASE_MAINNET_RPC_URL = "https://base.example";

    const output = await runVerify(["--epoch", "0", "--lane", "science"]);

    expect(output.result, output.stderr).toBe(0);
    const payload = parsePrintedJson(output.stdout) as VerifyPayload;
    const row = checkByItem(payload, (item) => item === "techtree status");
    expect(row.status).toBe("UNVERIFIABLE");
    expect(row.reason).toContain("regents auth login --audience techtree");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks chain rows UNVERIFIABLE when no RPC URL is configured", async () => {
    writeConfig();
    writeSession("techtree");
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/techtree/v1/tech/status")) return jsonResponse(statusResponse());
      if (url.includes("/api/techtree/v1/tech/rewards")) {
        return jsonResponse(
          rewardsResponse([{ lane: "science", status: "posted", merkle_root: merkleRoot, tx_hash: postedTx }]),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const output = await runVerify(["--epoch", "0", "--lane", "science"]);

    expect(output.result, output.stderr).toBe(0);
    const payload = parsePrintedJson(output.stdout) as VerifyPayload;
    const row = checkByItem(payload, (item) => item.startsWith("settlement receipt"));
    expect(row.status).toBe("UNVERIFIABLE");
    expect(row.reason).toContain("BASE_MAINNET_RPC_URL");
    expect(getReceiptMock).not.toHaveBeenCalled();
  });

  it("verifies an agent's allocation proof against the posted root with --agent", async () => {
    writeConfig();
    writeSession("techtree");
    process.env.BASE_MAINNET_RPC_URL = "https://base.example";
    // keccak256("0xabcdef" trimmed to leaf) -> the mocked keccak pads input[2:66].
    const expectedLeaf = `0x${"abcdef".padEnd(64, "0")}`.toLowerCase();
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/techtree/v1/tech/status")) return jsonResponse(statusResponse());
      if (url.includes("/api/techtree/v1/tech/rewards/proof")) {
        return jsonResponse({
          data: {
            epoch: 0,
            lane: "science",
            agent_id: "1",
            amount: "100",
            allocation_ref: `0x${"0".repeat(64)}`,
            proof: [],
            merkle_root: expectedLeaf,
          },
        });
      }
      if (url.includes("/api/techtree/v1/tech/rewards")) {
        return jsonResponse(
          rewardsResponse([{ lane: "science", status: "posted", merkle_root: merkleRoot, tx_hash: postedTx }]),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    getReceiptMock.mockResolvedValue({ status: "success", to: rewardRouter });
    stubAllocationRoot(merkleRoot);

    const output = await runVerify(["--epoch", "0", "--lane", "science", "--agent", "1"]);

    expect(output.result, output.stderr).toBe(0);
    const payload = parsePrintedJson(output.stdout) as VerifyPayload;
    const row = checkByItem(payload, (item) => item === "allocation proof");
    expect(row.status).toBe("MATCH");
  });
});
