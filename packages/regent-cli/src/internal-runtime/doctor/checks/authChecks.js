import { getCurrentAgentIdentity, getMissingAgentIdentityFields } from "../../agent/profile.js";
import { buildAuthenticatedFetchInit } from "../../techtree/request-builder.js";
import { buildSiwaMessage } from "../../techtree/siwa.js";
import { HTTP_SIGNATURE_COVERED_COMPONENTS, parseSignatureInputHeader, } from "../../techtree/signing.js";
import { buildBackendDetails, deriveSignerWalletAddress, isPositiveIntegerString, isValidAddress, skipDueToMissingConfig } from "./shared.js";
const FRESHNESS_THRESHOLD_MS = 5 * 60 * 1000;
const PLACEHOLDER_WALLET = "0x0000000000000000000000000000000000000001";
export function authChecks() {
    return [
        {
            id: "auth.identity.headers",
            scope: "auth",
            title: "identity fields present",
            run: async (ctx) => {
                if (!ctx.stateStore) {
                    return skipDueToMissingConfig();
                }
                const identity = getCurrentAgentIdentity(ctx.stateStore);
                const missingFields = getMissingAgentIdentityFields(ctx.stateStore);
                if (!identity) {
                    return {
                        status: "fail",
                        message: "Protected-route identity is missing",
                        details: {
                            identity,
                            missingFields,
                        },
                        remediation: "Run `regent auth siwa login --registry-address <addr> --token-id <id>`",
                    };
                }
                if (missingFields.length > 0) {
                    return {
                        status: "warn",
                        message: "Protected-route identity fields are incomplete",
                        details: {
                            identity,
                            missingFields,
                        },
                        remediation: "Run `regent auth siwa login --registry-address <addr> --token-id <id>`",
                    };
                }
                const signerWalletAddress = await deriveSignerWalletAddress(ctx).catch(() => null);
                const issues = [
                    !isValidAddress(identity.walletAddress)
                        ? "walletAddress must be a 20-byte hex address"
                        : undefined,
                    !Number.isSafeInteger(identity.chainId) || identity.chainId <= 0
                        ? "chainId must be a positive integer"
                        : undefined,
                    !isValidAddress(identity.registryAddress)
                        ? "registryAddress must be a 20-byte hex address"
                        : undefined,
                    !isPositiveIntegerString(identity.tokenId) ? "tokenId must be a positive integer string" : undefined,
                    signerWalletAddress !== null && signerWalletAddress.toLowerCase() !== identity.walletAddress.toLowerCase()
                        ? "configured signer wallet does not match the stored agent wallet address"
                        : undefined,
                ].filter((value) => value !== undefined);
                if (issues.length > 0) {
                    return {
                        status: "fail",
                        message: "Protected-route identity fields are invalid",
                        details: {
                            identity,
                            signerWalletAddress,
                            issues,
                        },
                        remediation: "Re-run `regent auth siwa login` with the intended signer and agent identity",
                    };
                }
                return {
                    status: "ok",
                    message: "Runtime can produce all required protected-route identity headers",
                    details: {
                        identity,
                        signerWalletAddress,
                    },
                };
            },
        },
        {
            id: "auth.siwa.nonce.endpoint",
            scope: "auth",
            title: "SIWA nonce endpoint reachable",
            run: async (ctx) => {
                if (!ctx.config || !ctx.techtree || !ctx.stateStore) {
                    return skipDueToMissingConfig();
                }
                try {
                    const identity = getCurrentAgentIdentity(ctx.stateStore);
                    const walletAddress = identity?.walletAddress ?? (await deriveSignerWalletAddress(ctx)) ?? PLACEHOLDER_WALLET;
                    const chainId = identity?.chainId ?? ctx.config.techtree.defaultChainId;
                    const response = await ctx.techtree.siwaNonce({
                        kind: "nonce_request",
                        walletAddress,
                        chainId,
                        audience: ctx.config.techtree.audience,
                    });
                    return {
                        status: "ok",
                        message: "SIWA nonce endpoint responded successfully",
                        details: {
                            code: response.code,
                            walletAddress: response.data.walletAddress,
                            chainId: response.data.chainId,
                            expiresAt: response.data.expiresAt,
                        },
                    };
                }
                catch (error) {
                    return {
                        status: "fail",
                        message: "SIWA nonce endpoint is unreachable or returned an error",
                        details: buildBackendDetails(error),
                        remediation: "Verify the Techtree base URL and Phoenix availability",
                    };
                }
            },
        },
        {
            id: "auth.siwa.verify.endpoint",
            scope: "auth",
            title: "SIWA verify endpoint reachable",
            run: async (ctx) => {
                if (!ctx.config || !ctx.techtree || !ctx.stateStore) {
                    return skipDueToMissingConfig();
                }
                const identity = getCurrentAgentIdentity(ctx.stateStore);
                const missingFields = getMissingAgentIdentityFields(ctx.stateStore);
                if (identity && missingFields.length > 0) {
                    return {
                        status: "skip",
                        message: "SIWA verify probe skipped because protected-route identity is incomplete",
                        remediation: "Run `regent auth siwa login --registry-address <addr> --token-id <id>`",
                    };
                }
                const walletAddress = identity?.walletAddress ?? (await deriveSignerWalletAddress(ctx)) ?? PLACEHOLDER_WALLET;
                const chainId = identity?.chainId ?? ctx.config.techtree.defaultChainId;
                const nonce = `doctor-unverifiable-${Date.now()}`;
                const message = buildSiwaMessage({
                    domain: "regent.cx",
                    uri: "https://regent.cx/login",
                    walletAddress,
                    chainId,
                    nonce,
                    statement: "Sign in to Regent CLI.",
                });
                try {
                    const response = await ctx.techtree.siwaVerify({
                        kind: "verify_request",
                        walletAddress,
                        chainId,
                        nonce,
                        message,
                        signature: `0x${"00".repeat(65)}`,
                        ...(identity ? { registryAddress: identity.registryAddress, tokenId: identity.tokenId } : {}),
                    });
                    return {
                        status: "warn",
                        message: "SIWA verify endpoint is reachable but accepted a deliberately invalid probe",
                        details: {
                            code: response.code,
                            walletAddress: response.data.walletAddress,
                            chainId: response.data.chainId,
                        },
                        remediation: "Inspect SIWA verify validation on the Techtree backend before relying on this environment",
                    };
                }
                catch (error) {
                    const details = buildBackendDetails(error);
                    const status = typeof details.status === "number" ? details.status : undefined;
                    if (status !== undefined && status >= 400 && status < 500 && status !== 404 && status !== 405) {
                        return {
                            status: "ok",
                            message: "SIWA verify endpoint rejected a deliberately invalid probe, confirming route reachability without persisting a session",
                            details,
                        };
                    }
                    return {
                        status: "fail",
                        message: "SIWA verify endpoint is unreachable or did not return a usable denial response",
                        details,
                        remediation: "Verify the Techtree base URL and SIWA verify route behavior",
                    };
                }
            },
        },
        {
            id: "auth.session.present",
            scope: "auth",
            title: "SIWA session",
            run: async (ctx) => {
                if (!ctx.sessionStore) {
                    return skipDueToMissingConfig();
                }
                const session = ctx.sessionStore.getSiwaSession();
                if (!session) {
                    return {
                        status: "warn",
                        message: "No active SIWA session found",
                        remediation: "Run `regent auth siwa login`",
                    };
                }
                return {
                    status: "ok",
                    message: "Active SIWA session found",
                    details: {
                        walletAddress: session.walletAddress,
                        chainId: session.chainId,
                        receiptExpiresAt: session.receiptExpiresAt,
                    },
                };
            },
        },
        {
            id: "auth.session.freshness",
            scope: "auth",
            title: "SIWA session freshness",
            run: async (ctx) => {
                if (!ctx.sessionStore) {
                    return skipDueToMissingConfig();
                }
                const session = ctx.sessionStore.getSiwaSession();
                if (!session) {
                    return {
                        status: "skip",
                        message: "No SIWA session is stored locally",
                        remediation: "Run `regent auth siwa login`",
                    };
                }
                const expiresAt = Date.parse(session.receiptExpiresAt);
                if (!Number.isFinite(expiresAt)) {
                    return {
                        status: "fail",
                        message: "Stored SIWA receipt expiry is invalid",
                        details: {
                            receiptExpiresAt: session.receiptExpiresAt,
                        },
                        remediation: "Run `regent auth siwa login` again",
                    };
                }
                const remainingMs = expiresAt - Date.now();
                if (remainingMs <= 0) {
                    return {
                        status: "fail",
                        message: "Stored SIWA receipt is expired",
                        details: {
                            receiptExpiresAt: session.receiptExpiresAt,
                        },
                        remediation: "Run `regent auth siwa login` again",
                    };
                }
                if (remainingMs <= FRESHNESS_THRESHOLD_MS) {
                    return {
                        status: "warn",
                        message: "Stored SIWA receipt expires soon",
                        details: {
                            receiptExpiresAt: session.receiptExpiresAt,
                            remainingMs,
                        },
                        remediation: "Run `regent auth siwa login` again soon",
                    };
                }
                return {
                    status: "ok",
                    message: "Stored SIWA receipt is fresh",
                    details: {
                        receiptExpiresAt: session.receiptExpiresAt,
                        remainingMs,
                    },
                };
            },
        },
        {
            id: "auth.session.binding",
            scope: "auth",
            title: "session binding matches local identity",
            run: async (ctx) => {
                if (!ctx.sessionStore || !ctx.stateStore) {
                    return skipDueToMissingConfig();
                }
                const session = ctx.sessionStore.getSiwaSession();
                if (!session) {
                    return {
                        status: "skip",
                        message: "No SIWA session is stored locally",
                        remediation: "Run `regent auth siwa login`",
                    };
                }
                const identity = getCurrentAgentIdentity(ctx.stateStore);
                if (!identity) {
                    return {
                        status: "fail",
                        message: "A SIWA session exists, but local protected-route identity is missing",
                        remediation: "Run `regent auth siwa login --registry-address <addr> --token-id <id>`",
                    };
                }
                const mismatches = [
                    session.walletAddress.toLowerCase() !== identity.walletAddress.toLowerCase()
                        ? "walletAddress"
                        : undefined,
                    session.chainId !== identity.chainId ? "chainId" : undefined,
                    session.registryAddress && session.registryAddress.toLowerCase() !== identity.registryAddress.toLowerCase()
                        ? "registryAddress"
                        : undefined,
                    session.tokenId && session.tokenId !== identity.tokenId ? "tokenId" : undefined,
                ].filter((value) => value !== undefined);
                if (mismatches.length > 0) {
                    return {
                        status: "fail",
                        message: "Stored SIWA session does not match the local protected-route identity",
                        details: {
                            session: {
                                walletAddress: session.walletAddress,
                                chainId: session.chainId,
                                registryAddress: session.registryAddress,
                                tokenId: session.tokenId,
                            },
                            identity,
                            mismatches,
                        },
                        remediation: "Run `regent auth siwa login` again with the current signer and agent identity",
                    };
                }
                if (!session.registryAddress || !session.tokenId) {
                    return {
                        status: "warn",
                        message: "Stored SIWA session lacks registry/token binding metadata",
                        details: {
                            session: {
                                walletAddress: session.walletAddress,
                                chainId: session.chainId,
                            },
                            identity,
                        },
                        remediation: "Run `regent auth siwa login` again to refresh the stored binding metadata",
                    };
                }
                return {
                    status: "ok",
                    message: "Stored SIWA session matches the local protected-route identity",
                    details: {
                        walletAddress: session.walletAddress,
                        chainId: session.chainId,
                        registryAddress: session.registryAddress,
                        tokenId: session.tokenId,
                    },
                };
            },
        },
        {
            id: "auth.http-envelope.build",
            scope: "auth",
            title: "HTTP auth envelope builds locally",
            run: async (ctx) => {
                if (!ctx.sessionStore || !ctx.stateStore || !ctx.walletSecretSource) {
                    return skipDueToMissingConfig();
                }
                const session = ctx.sessionStore.getSiwaSession();
                const identity = getCurrentAgentIdentity(ctx.stateStore);
                if (!session) {
                    return {
                        status: "skip",
                        message: "No SIWA session is stored locally",
                        remediation: "Run `regent auth siwa login`",
                    };
                }
                if (!identity) {
                    return {
                        status: "skip",
                        message: "Protected-route identity is unavailable locally",
                        remediation: "Run `regent auth siwa login --registry-address <addr> --token-id <id>`",
                    };
                }
                try {
                    const privateKey = await ctx.walletSecretSource.getPrivateKeyHex();
                    const request = await buildAuthenticatedFetchInit({
                        method: "GET",
                        path: "/v1/agent/opportunities",
                        session,
                        agentIdentity: identity,
                        privateKey,
                    });
                    const headers = request.init.headers;
                    const missing = [
                        "x-siwa-receipt",
                        "x-key-id",
                        "x-timestamp",
                        "signature-input",
                        "signature",
                        "x-agent-wallet-address",
                        "x-agent-chain-id",
                        "x-agent-registry-address",
                        "x-agent-token-id",
                    ].filter((headerName) => !headers[headerName]);
                    const parsedSignatureInput = parseSignatureInputHeader(headers["signature-input"] ?? "");
                    const missingCoveredComponents = HTTP_SIGNATURE_COVERED_COMPONENTS.filter((component) => !parsedSignatureInput?.coveredComponents.includes(component));
                    const timestamp = Number.parseInt(headers["x-timestamp"] ?? "", 10);
                    const nowUnixSeconds = Math.floor(Date.now() / 1000);
                    const expectedSessionKeyId = session.keyId.trim().toLowerCase();
                    const expectedWalletKeyId = session.walletAddress.toLowerCase();
                    const signatureIssues = [
                        parsedSignatureInput === null ? "signature-input could not be parsed" : undefined,
                        parsedSignatureInput?.label !== "sig1" ? "signature-input must use the sig1 label" : undefined,
                        headers["x-key-id"]?.toLowerCase() !== expectedSessionKeyId
                            ? "x-key-id does not match the stored SIWA session keyId"
                            : undefined,
                        expectedSessionKeyId !== expectedWalletKeyId
                            ? "stored SIWA session keyId is not bound to the stored SIWA wallet"
                            : undefined,
                        headers["x-key-id"]?.toLowerCase() !== expectedWalletKeyId
                            ? "x-key-id does not match the receipt wallet binding"
                            : undefined,
                        headers["x-agent-wallet-address"]?.toLowerCase() !== session.walletAddress.toLowerCase()
                            ? "x-agent-wallet-address does not match the stored SIWA wallet"
                            : undefined,
                        headers["x-agent-chain-id"] !== String(session.chainId)
                            ? "x-agent-chain-id does not match the stored SIWA chain id"
                            : undefined,
                        session.registryAddress && headers["x-agent-registry-address"]?.toLowerCase() !== session.registryAddress.toLowerCase()
                            ? "x-agent-registry-address does not match the stored SIWA registry binding"
                            : undefined,
                        session.tokenId && headers["x-agent-token-id"] !== session.tokenId
                            ? "x-agent-token-id does not match the stored SIWA token binding"
                            : undefined,
                        !Number.isFinite(timestamp) ? "x-timestamp is not a valid unix timestamp" : undefined,
                        parsedSignatureInput?.params.created === undefined ? "signature-input is missing created" : undefined,
                        parsedSignatureInput?.params.expires === undefined ? "signature-input is missing expires" : undefined,
                        !parsedSignatureInput?.params.nonce ? "signature-input is missing nonce" : undefined,
                        !parsedSignatureInput?.params.keyid ? "signature-input is missing keyid" : undefined,
                        parsedSignatureInput?.params.created !== undefined && parsedSignatureInput.params.created !== timestamp
                            ? "signature-input created does not match x-timestamp"
                            : undefined,
                        parsedSignatureInput?.params.keyid !== undefined && parsedSignatureInput.params.keyid !== headers["x-key-id"]
                            ? "signature-input keyid does not match x-key-id"
                            : undefined,
                        parsedSignatureInput?.params.expires !== undefined &&
                            parsedSignatureInput.params.created !== undefined &&
                            parsedSignatureInput.params.expires <= parsedSignatureInput.params.created
                            ? "signature-input expires must be later than created"
                            : undefined,
                        parsedSignatureInput?.params.expires !== undefined && parsedSignatureInput.params.expires <= nowUnixSeconds
                            ? "signature-input expiry is already in the past"
                            : undefined,
                        Number.isFinite(timestamp) && Math.abs(nowUnixSeconds - timestamp) > 300
                            ? "x-timestamp is outside the expected freshness window"
                            : undefined,
                    ].filter((value) => value !== undefined);
                    if (missing.length > 0 || missingCoveredComponents.length > 0 || signatureIssues.length > 0) {
                        return {
                            status: "fail",
                            message: "Authenticated HTTP envelope does not satisfy the SIWA sidecar-sensitive header and binding contract",
                            details: {
                                missingHeaders: missing,
                                missingCoveredComponents,
                                signatureIssues,
                            },
                            remediation: "Inspect the local signer and SIWA header builder implementation",
                        };
                    }
                    return {
                        status: "ok",
                        message: "Authenticated HTTP envelope builds locally",
                        details: {
                            path: request.urlPath,
                            headers: {
                                "x-key-id": headers["x-key-id"],
                                "x-timestamp": headers["x-timestamp"],
                                "signature-input": headers["signature-input"],
                            },
                            signatureParams: parsedSignatureInput?.params,
                        },
                    };
                }
                catch (error) {
                    return {
                        status: "fail",
                        message: "Authenticated HTTP envelope could not be built locally",
                        details: buildBackendDetails(error),
                        remediation: "Inspect local SIWA session state, signer setup, and identity headers",
                    };
                }
            },
        },
    ];
}
