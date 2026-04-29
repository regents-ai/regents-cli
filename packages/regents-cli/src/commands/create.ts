import path from "node:path";

import {
  defaultConfigPath,
  loadConfig,
  ensureSecureDir,
  expandHome,
  generateWallet,
  writeJsonFileAtomicSync,
  writeInitialConfigIfMissing,
} from "../internal-runtime/index.js";

import { getBooleanFlag, getFlag, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";

const ensureDirectories = (paths: readonly string[]): void => {
  for (const targetPath of paths) {
    ensureSecureDir(targetPath);
  }
};

export async function runCreateInit(args: string[] | ParsedCliArgs): Promise<void> {
  const configPath = expandHome(getFlag(args, "config") ?? defaultConfigPath());
  const configCreated = writeInitialConfigIfMissing(configPath);
  const config = loadConfig(configPath);
  const directories = {
    stateDir: config.runtime.stateDir,
    socketDir: path.dirname(config.runtime.socketPath),
    keystoreDir: path.dirname(config.wallet.keystorePath),
    xmtpDir: path.dirname(config.xmtp.dbPath),
    xmtpPolicyDir: path.dirname(config.xmtp.publicPolicyPath),
    gossipsubDir: path.dirname(config.gossipsub.peerIdPath),
  };

  ensureDirectories(Object.values(directories));

  printJson({
    ok: true,
    configPath,
    configCreated,
    ...directories,
  });
}

export async function runCreateWallet(args: string[] | ParsedCliArgs): Promise<void> {
  const wallet = await generateWallet();
  const writeEnv = getBooleanFlag(args, "write-env");
  const devFile = getFlag(args, "dev-file");
  const resolvedDevFile = devFile ? path.resolve(expandHome(devFile)) : undefined;

  if (resolvedDevFile) {
    writeJsonFileAtomicSync(resolvedDevFile, { privateKey: wallet.privateKey });
  }

  printJson({
    address: wallet.address,
    ...(writeEnv
      ? {
          export: `export REGENT_WALLET_PRIVATE_KEY=${wallet.privateKey}`,
        }
      : {}),
    ...(resolvedDevFile ? { devFile: resolvedDevFile } : {}),
  });
}
