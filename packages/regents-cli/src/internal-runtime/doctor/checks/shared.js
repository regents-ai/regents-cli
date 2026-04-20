import fs from "node:fs";
import path from "node:path";
import { deriveWalletAddress } from "../../agent/wallet.js";
import { getCurrentAgentIdentity } from "../../agent/profile.js";
import { RegentError, TechtreeApiError } from "../../errors.js";
import { readIdentityReceipt } from "../../identity/cache.js";
import { resolveIdentitySigner, resolveSignerFromReceipt } from "../../identity/providers.js";
import { identityNetworkForChainId } from "../../identity/shared.js";
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const POSITIVE_INTEGER_STRING_REGEX = /^[1-9][0-9]*$/;
export function skipDueToMissingConfig() {
    return {
        status: "skip",
        message: "Config is unavailable; later checks were not attempted",
        remediation: "Fix the config load failure first",
    };
}
export function isValidAddress(value) {
    return ADDRESS_REGEX.test(value);
}
export function isPositiveIntegerString(value) {
    return POSITIVE_INTEGER_STRING_REGEX.test(value);
}
export async function deriveSignerWalletAddress(ctx) {
    const receipt = readIdentityReceipt();
    if (receipt?.provider === "coinbase-cdp" && ctx.config) {
        return (await resolveSignerFromReceipt(receipt, {
            config: ctx.config,
            timeoutMs: ctx.config.auth.requestTimeoutMs,
        })).address;
    }
    const identity = ctx.stateStore ? getCurrentAgentIdentity(ctx.stateStore) : null;
    if (identity?.walletAddress && typeof identity.chainId === "number" && ctx.config) {
        return (await resolveIdentitySigner({
            provider: "coinbase-cdp",
            network: identityNetworkForChainId(identity.chainId),
            walletHint: identity.walletAddress,
            config: ctx.config,
            timeoutMs: ctx.config.auth.requestTimeoutMs,
            expectedAddress: identity.walletAddress,
        })).address;
    }
    if (!ctx.walletSecretSource) {
        return null;
    }
    const privateKey = await ctx.walletSecretSource.getPrivateKeyHex();
    return deriveWalletAddress(privateKey);
}
export function buildBackendDetails(error) {
    if (error instanceof TechtreeApiError) {
        const payload = error.payload && typeof error.payload === "object" && !Array.isArray(error.payload)
            ? error.payload
            : undefined;
        const backendError = payload && typeof payload.error === "object" && payload.error && !Array.isArray(payload.error)
            ? payload.error
            : undefined;
        const backend = backendError
            ? {
                ...(typeof backendError.code === "string" ? { code: backendError.code } : {}),
                ...(typeof backendError.message === "string" ? { message: backendError.message } : {}),
                ...("details" in backendError ? { details: backendError.details } : {}),
            }
            : payload;
        const sidecar = backend &&
            typeof backend === "object" &&
            "details" in backend &&
            backend.details &&
            typeof backend.details === "object" &&
            !Array.isArray(backend.details) &&
            "sidecar" in backend.details &&
            backend.details.sidecar &&
            typeof backend.details.sidecar === "object" &&
            !Array.isArray(backend.details.sidecar)
            ? backend.details.sidecar
            : undefined;
        return {
            code: error.code,
            message: error.message,
            ...(error.status === undefined ? {} : { status: error.status }),
            ...(backend === undefined ? {} : { backend }),
            ...(sidecar === undefined ? {} : { sidecar }),
        };
    }
    if (error instanceof RegentError) {
        return {
            code: error.code,
            message: error.message,
        };
    }
    if (error instanceof Error) {
        return {
            message: error.message,
        };
    }
    return {
        message: String(error),
    };
}
export function ensureDirExists(dirPath) {
    if (fs.existsSync(dirPath)) {
        return false;
    }
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
}
export function uniquePaths(paths) {
    return [...new Set(paths.map((value) => path.resolve(value)))];
}
