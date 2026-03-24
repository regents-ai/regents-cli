import type {
  AuthStatusResponse,
  RequiredAgentIdentityField,
  SiwaSession,
  SiwaVerifyResponse,
} from "../../internal-types/index.js";

import { deriveWalletAddress, signPersonalMessage } from "../agent/wallet.js";
import { AuthError } from "../errors.js";
import type { RuntimeContext } from "../runtime.js";
import { buildSiwaMessage } from "../techtree/siwa.js";

export async function handleAuthSiwaLogin(
  ctx: RuntimeContext,
  params: {
    walletAddress?: `0x${string}`;
    chainId?: number;
    registryAddress?: `0x${string}`;
    tokenId?: string;
    audience?: string;
  },
): Promise<SiwaVerifyResponse> {
  const privateKey = await ctx.walletSecretSource.getPrivateKeyHex();
  const walletAddress = params.walletAddress ?? (await deriveWalletAddress(privateKey));
  const chainId = params.chainId ?? ctx.config.techtree.defaultChainId;
  const audience = params.audience ?? ctx.config.techtree.audience;

  const hasRegistryAddress = typeof params.registryAddress === "string";
  const hasTokenId = typeof params.tokenId === "string";
  if (hasRegistryAddress !== hasTokenId) {
    throw new AuthError(
      "invalid_agent_identity",
      "provide --registry-address and --token-id together so protected Techtree routes can identify the current agent",
    );
  }

  const nonceResponse = await ctx.techtree.siwaNonce({
    kind: "nonce_request",
    walletAddress,
    chainId,
    audience,
  });

  const message = buildSiwaMessage({
    domain: "regent.cx",
    uri: "https://regent.cx/login",
    walletAddress,
    chainId,
    nonce: nonceResponse.data.nonce,
    statement: "Sign in to Regent CLI.",
  });

  const signature = await signPersonalMessage(privateKey, message);
  const verifyResponse = await ctx.techtree.siwaVerify({
    kind: "verify_request",
    walletAddress,
    chainId,
    nonce: nonceResponse.data.nonce,
    message,
    signature,
    ...(params.registryAddress ? { registryAddress: params.registryAddress } : {}),
    ...(params.tokenId ? { tokenId: params.tokenId } : {}),
  });

  const session: SiwaSession = {
    walletAddress: verifyResponse.data.walletAddress,
    chainId: verifyResponse.data.chainId,
    nonce: verifyResponse.data.nonce,
    keyId: verifyResponse.data.keyId,
    receipt: verifyResponse.data.receipt,
    receiptExpiresAt: verifyResponse.data.receiptExpiresAt,
    audience,
    ...(params.registryAddress ? { registryAddress: params.registryAddress } : {}),
    ...(params.tokenId ? { tokenId: params.tokenId } : {}),
  };

  ctx.sessionStore.setSiwaSession(session);

  if (params.registryAddress && params.tokenId) {
    ctx.stateStore.patch({
      agent: {
        walletAddress,
        chainId,
        registryAddress: params.registryAddress,
        tokenId: params.tokenId,
      },
    });
  }

  return verifyResponse;
}

export async function handleAuthSiwaStatus(ctx: RuntimeContext): Promise<AuthStatusResponse> {
  const session = ctx.sessionStore.getSiwaSession();
  const agentIdentity = ctx.stateStore.read().agent ?? null;
  const authenticated = !!session && !ctx.sessionStore.isReceiptExpired();
  const missingIdentityFields: RequiredAgentIdentityField[] = [
    agentIdentity?.walletAddress ? null : "walletAddress",
    typeof agentIdentity?.chainId === "number" ? null : "chainId",
    agentIdentity?.registryAddress ? null : "registryAddress",
    agentIdentity?.tokenId ? null : "tokenId",
  ].filter((field): field is RequiredAgentIdentityField => field !== null);
  const protectedRoutesReady = authenticated && missingIdentityFields.length === 0;

  if (!authenticated) {
    return {
      authenticated: false,
      session,
      agentIdentity,
      protectedRoutesReady,
      missingIdentityFields,
    };
  }

  return {
    authenticated: true,
    session,
    agentIdentity,
    protectedRoutesReady,
    missingIdentityFields,
  };
}

export async function handleAuthSiwaLogout(ctx: RuntimeContext): Promise<{ ok: true }> {
  ctx.sessionStore.clearSiwaSession();
  return { ok: true };
}
