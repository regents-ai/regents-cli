import path from "node:path";

import type { LocalAgentIdentity, RegentConfig, SiwaSession } from "../internal-types/index.js";

import { loadConfig, StateStore } from "../internal-runtime/index.js";
import { readIdentityReceipt } from "../internal-runtime/identity/cache.js";
import { receiptToIdentity } from "../internal-runtime/identity/shared.js";
import { resolveAuthenticatedAgentSigningContext } from "../internal-runtime/techtree/auth.js";
import { buildSignerBackedAgentHeaders } from "../internal-runtime/techtree/signing.js";
import { SessionStore } from "../internal-runtime/store/session-store.js";

export const loadAgentAuthState = (
  configPath?: string,
): {
  config: RegentConfig;
  stateStore: StateStore;
  sessionStore: SessionStore;
  session: SiwaSession | null;
  identity: LocalAgentIdentity | null;
} => {
  const config = loadConfig(configPath);
  const stateFilePath = path.join(config.runtime.stateDir, "runtime-state.json");
  const stateStore = new StateStore(stateFilePath);
  const sessionStore = new SessionStore(stateStore);
  const receipt = readIdentityReceipt();
  const session = sessionStore.getSiwaSession();
  const storedIdentity = stateStore.read().agent;
  const identity =
    receipt
      ? receiptToIdentity(receipt)
      : storedIdentity ??
        (session
          ? {
              walletAddress: session.walletAddress,
              chainId: session.chainId,
              ...(session.registryAddress ? { registryAddress: session.registryAddress } : {}),
              ...(session.tokenId ? { tokenId: session.tokenId } : {}),
            }
          : null);

  return {
    config,
    stateStore,
    sessionStore,
    session,
    identity,
  };
};

export const requireAgentAuthState = (
  configPath?: string,
  options?: { requireBoundIdentity?: boolean },
): {
  config: RegentConfig;
  session: SiwaSession;
  identity: LocalAgentIdentity;
} => {
  const { config, sessionStore, session, identity } = loadAgentAuthState(configPath);

  if (!session) {
    throw new Error("Run `regents auth login` before using this command.");
  }

  if (sessionStore.isReceiptExpired()) {
    throw new Error("Your saved shared Regent agent session expired. Run `regents auth login` again.");
  }

  if (!identity?.walletAddress || typeof identity.chainId !== "number") {
    throw new Error("This machine does not have a saved Regent identity yet. Run `regents identity ensure` first.");
  }

  if (options?.requireBoundIdentity && (!identity.registryAddress || !identity.tokenId)) {
    throw new Error("This command needs a bound Regent identity. Run `regents identity ensure` again.");
  }

  return {
    config,
    session,
    identity,
  };
};

export const buildAgentAuthHeaders = async (
  input: {
    method: string;
    path: string;
    configPath?: string;
    requireBoundIdentity?: boolean;
  },
): Promise<Record<string, string>> => {
  requireAgentAuthState(input.configPath, {
    requireBoundIdentity: input.requireBoundIdentity,
  });
  const { config, stateStore, sessionStore } = loadAgentAuthState(input.configPath);
  const { session, identity, signer } = await resolveAuthenticatedAgentSigningContext(
    config,
    sessionStore,
    stateStore,
    config.auth.requestTimeoutMs,
  );

  return buildSignerBackedAgentHeaders({
    method: input.method,
    path: input.path,
    walletAddress: identity.walletAddress,
    chainId: identity.chainId,
    ...(identity.registryAddress ? { registryAddress: identity.registryAddress } : {}),
    ...(identity.tokenId ? { tokenId: identity.tokenId } : {}),
    receipt: session.receipt,
    signMessage: signer.signMessage,
  });
};
