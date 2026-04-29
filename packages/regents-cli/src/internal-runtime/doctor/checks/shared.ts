import fs from "node:fs";
import path from "node:path";
import { deriveWalletAddress } from "../../agent/wallet.js";
import { getCurrentAgentIdentity } from "../../agent/profile.js";
import { RegentError, TechtreeApiError } from "../../errors.js";
import { readIdentityReceipt } from "../../identity/cache.js";
import { resolveIdentitySigner, resolveSignerFromReceipt } from "../../identity/providers.js";
import { identityNetworkForChainId } from "../../identity/shared.js";
import type { DoctorCheckContext, DoctorCheckOutcome } from "../types.js";

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const POSITIVE_INTEGER_STRING_REGEX = /^[1-9][0-9]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function skipDueToMissingConfig(): DoctorCheckOutcome {
    return {
        status: "skip",
        message: "Config is unavailable; later checks were not attempted",
        remediation: "Fix the config load failure first",
    };
}

export function isValidAddress(value: string): boolean {
    return ADDRESS_REGEX.test(value);
}

export function isPositiveIntegerString(value: string): boolean {
    return POSITIVE_INTEGER_STRING_REGEX.test(value);
}

export async function deriveSignerWalletAddress(ctx: DoctorCheckContext): Promise<`0x${string}` | null> {
    const receipt = readIdentityReceipt();
    if (receipt?.provider === "coinbase-cdp" && ctx.config) {
        return (await resolveSignerFromReceipt(receipt, {
            config: ctx.config,
            timeoutMs: ctx.config.services.siwa.requestTimeoutMs,
        })).address;
    }
    const identity = ctx.stateStore ? getCurrentAgentIdentity(ctx.stateStore) : null;
    if (identity?.walletAddress && typeof identity.chainId === "number" && ctx.config) {
        return (await resolveIdentitySigner({
            provider: "coinbase-cdp",
            network: identityNetworkForChainId(identity.chainId),
            walletHint: identity.walletAddress,
            config: ctx.config,
            timeoutMs: ctx.config.services.siwa.requestTimeoutMs,
            expectedAddress: identity.walletAddress,
        })).address;
    }
    if (!ctx.walletSecretSource) {
        return null;
    }
    const privateKey = await ctx.walletSecretSource.getPrivateKeyHex();
    return deriveWalletAddress(privateKey);
}

export function buildBackendDetails(error: unknown): Record<string, unknown> {
    if (error instanceof TechtreeApiError) {
        const payload = isRecord(error.payload)
            ? error.payload
            : undefined;
        const backendError = isRecord(payload?.error)
            ? payload.error
            : undefined;
        const backend = backendError
            ? {
                ...(typeof backendError.code === "string" ? { code: backendError.code } : {}),
                ...(typeof backendError.message === "string" ? { message: backendError.message } : {}),
                ...("details" in backendError ? { details: backendError.details } : {}),
            }
            : payload;
        const sidecar = isRecord(backend) &&
            "details" in backend &&
            isRecord(backend.details) &&
            "sidecar" in backend.details &&
            isRecord(backend.details.sidecar)
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
        const status = isRecord(error) && typeof error.status === "number" ? error.status : undefined;
        return {
            code: error.code,
            message: error.message,
            ...(status === undefined ? {} : { status }),
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

export function ensureDirExists(dirPath: string): boolean {
    if (fs.existsSync(dirPath)) {
        return false;
    }
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
}

export function uniquePaths(paths: string[]): string[] {
    return [...new Set(paths.map((value) => path.resolve(value)))];
}
