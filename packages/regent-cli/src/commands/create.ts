import fs from "node:fs";
import path from "node:path";

import {
  defaultConfigPath,
  loadConfig,
  ensureParentDir,
  expandHome,
  generateWallet,
  writeInitialConfigIfMissing,
} from "../internal-runtime/index.js";

import { getBooleanFlag, getFlag, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";

const ensureDirectories = (paths: readonly string[]): void => {
  for (const targetPath of paths) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
};

export async function runCreateInit(args: string[] | ParsedCliArgs): Promise<void> {
  const configPath = expandHome(getFlag(args, "config") ?? defaultConfigPath());
  const configCreated = writeInitialConfigIfMissing(configPath);
  const config = loadConfig(configPath);

  ensureDirectories([
    config.runtime.stateDir,
    path.dirname(config.runtime.socketPath),
    path.dirname(config.wallet.keystorePath),
    path.dirname(config.xmtp.dbPath),
    path.dirname(config.xmtp.publicPolicyPath),
    path.dirname(config.gossipsub.peerIdPath),
  ]);

  printJson({
    ok: true,
    configPath,
    configCreated,
    stateDir: config.runtime.stateDir,
    socketDir: path.dirname(config.runtime.socketPath),
    keystoreDir: path.dirname(config.wallet.keystorePath),
    xmtpDir: path.dirname(config.xmtp.dbPath),
    xmtpPolicyDir: path.dirname(config.xmtp.publicPolicyPath),
    gossipsubDir: path.dirname(config.gossipsub.peerIdPath),
  });
}

export async function runCreateWallet(args: string[] | ParsedCliArgs): Promise<void> {
  const wallet = await generateWallet();
  const writeEnv = getBooleanFlag(args, "write-env");
  const devFile = getFlag(args, "dev-file");

  if (devFile) {
    const resolvedPath = path.resolve(expandHome(devFile));
    ensureParentDir(resolvedPath);
    fs.writeFileSync(resolvedPath, `${JSON.stringify({ privateKey: wallet.privateKey }, null, 2)}\n`, "utf8");
  }

  printJson({
    address: wallet.address,
    ...(writeEnv
      ? {
          export: `export REGENT_WALLET_PRIVATE_KEY=${wallet.privateKey}`,
        }
      : {}),
    ...(devFile ? { devFile: path.resolve(expandHome(devFile)) } : {}),
  });
}
