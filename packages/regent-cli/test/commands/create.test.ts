import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCreateInit, runCreateWallet } from "../../src/commands/create.js";
import { parseCliArgs } from "../../src/parse.js";
import { captureOutput, parsePrintedJson } from "../helpers/output.js";

describe("create commands", () => {
  it("initializes config and runtime directories", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-cli-create-init-"));
    const configPath = path.join(tempDir, "config.json");

    const { stdout } = await captureOutput(() => runCreateInit(parseCliArgs(["--config", configPath])));
    const printed = parsePrintedJson<{
      ok: boolean;
      configPath: string;
      configCreated: boolean;
      stateDir: string;
      socketDir: string;
      keystoreDir: string;
      gossipsubDir: string;
      xmtpDir: string;
      xmtpPolicyDir: string;
    }>(stdout);

    expect(printed.ok).toBe(true);
    expect(printed.configPath).toBe(configPath);
    expect(printed.configCreated).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);

    const writtenConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      runtime: { stateDir: string; socketPath: string };
      wallet: { keystorePath: string };
      gossipsub: { peerIdPath: string };
      xmtp: { dbPath: string; publicPolicyPath: string };
    };

    expect(writtenConfig.runtime.stateDir).toBe(path.join(tempDir, "state"));
    expect(writtenConfig.runtime.socketPath).toBe(path.join(tempDir, "run", "regent.sock"));
    expect(writtenConfig.wallet.keystorePath).toBe(path.join(tempDir, "keys", "agent-wallet.json"));
    expect(writtenConfig.gossipsub.peerIdPath).toBe(path.join(tempDir, "p2p", "peer-id.json"));
    expect(writtenConfig.xmtp.dbPath).toBe(path.join(tempDir, "xmtp", "production", "client.db"));
    expect(writtenConfig.xmtp.publicPolicyPath).toBe(path.join(tempDir, "policies", "xmtp-public.md"));
    expect(fs.existsSync(writtenConfig.runtime.stateDir)).toBe(true);
    expect(printed.socketDir).toBe(path.dirname(writtenConfig.runtime.socketPath));
    expect(printed.keystoreDir).toBe(path.dirname(writtenConfig.wallet.keystorePath));
    expect(printed.gossipsubDir).toBe(path.dirname(writtenConfig.gossipsub.peerIdPath));
    expect(printed.xmtpDir).toBe(path.dirname(writtenConfig.xmtp.dbPath));
    expect(printed.xmtpPolicyDir).toBe(path.dirname(writtenConfig.xmtp.publicPolicyPath));
    expect(fs.existsSync(printed.socketDir)).toBe(true);
    expect(fs.existsSync(printed.keystoreDir)).toBe(true);
    expect(fs.existsSync(printed.gossipsubDir)).toBe(true);
    expect(fs.existsSync(printed.xmtpDir)).toBe(true);
    expect(fs.existsSync(printed.xmtpPolicyDir)).toBe(true);
  });

  it("creates a wallet and supports export/dev-file output", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-cli-create-wallet-"));
    const devFile = path.join(tempDir, "wallet.json");

    const { stdout } = await captureOutput(() =>
      runCreateWallet(parseCliArgs(["--write-env", "--dev-file", devFile])),
    );
    const printed = parsePrintedJson<{
      address: `0x${string}`;
      export: string;
      devFile: string;
    }>(stdout);

    expect(printed.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(printed.devFile).toBe(devFile);

    const written = JSON.parse(fs.readFileSync(devFile, "utf8")) as { privateKey: string };
    expect(written.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(printed.export).toBe(`export REGENT_WALLET_PRIVATE_KEY=${written.privateKey}`);
  });
});
