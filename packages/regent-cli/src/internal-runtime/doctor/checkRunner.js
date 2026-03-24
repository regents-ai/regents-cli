import path from "node:path";

import { EnvWalletSecretSource, FileWalletSecretSource } from "../agent/key-store.js";
import { loadConfig } from "../config.js";
import { DoctorInternalError, errorMessage } from "../errors.js";
import { defaultConfigPath, expandHome } from "../paths.js";
import { SessionStore } from "../store/session-store.js";
import { StateStore } from "../store/state-store.js";
import { TechtreeClient } from "../techtree/client.js";
import { authChecks } from "./checks/authChecks.js";
import { artifactChecks } from "./checks/artifactChecks.js";
import { bbhChecks } from "./checks/bbhChecks.js";
import { fullChecks } from "./checks/fullChecks.js";
import { runtimeChecks } from "./checks/runtimeChecks.js";
import { techtreeChecks } from "./checks/techtreeChecks.js";
import { transportChecks } from "./checks/transportChecks.js";
import { deriveNextSteps } from "./renderNextSteps.js";

const DEFAULT_CHECK_FACTORIES = [runtimeChecks, authChecks, techtreeChecks, transportChecks];

const DEFAULT_REQUIRED_OK = new Set([
    "runtime.config.load",
    "runtime.paths.ensure",
    "runtime.wallet.source",
    "auth.identity.headers",
    "auth.siwa.nonce.endpoint",
    "auth.session.present",
    "auth.session.freshness",
    "auth.session.binding",
    "auth.http-envelope.build",
    "techtree.health",
    "techtree.public.read",
    "techtree.authenticated.probe",
]);

const createWalletSecretSource = (config) => {
    return process.env[config.wallet.privateKeyEnv]
        ? new EnvWalletSecretSource(config.wallet.privateKeyEnv)
        : new FileWalletSecretSource(config.wallet.keystorePath);
};

function resolveConfigPath(configPath) {
    return path.resolve(expandHome(configPath ?? defaultConfigPath()));
}

function buildDoctorContext(invocation) {
    const runtimeContext = invocation.runtimeContext ?? null;
    const resolvedConfigPath = resolveConfigPath(invocation.configPath ?? runtimeContext?.runtime.configPath);
    const context = {
        mode: invocation.mode,
        configPath: resolvedConfigPath,
        runtimeContext,
        config: runtimeContext?.config ?? null,
        configLoadError: null,
        stateStore: runtimeContext?.stateStore ?? null,
        sessionStore: runtimeContext?.sessionStore ?? null,
        walletSecretSource: runtimeContext?.walletSecretSource ?? null,
        techtree: runtimeContext?.techtree ?? null,
        fix: invocation.params?.fix ?? false,
        verbose: invocation.params?.verbose ?? false,
        knownParentId: invocation.mode === "full" ? invocation.params?.knownParentId : undefined,
        cleanupCommentBodyPrefix: invocation.mode === "full"
            ? invocation.params?.cleanupCommentBodyPrefix ?? "regent-doctor-comment"
            : "regent-doctor-comment",
        fullState: {},
        refreshConfig: () => {
            if (runtimeContext) {
                context.config = runtimeContext.config;
                context.configLoadError = null;
                context.stateStore = runtimeContext.stateStore;
                context.sessionStore = runtimeContext.sessionStore;
                context.walletSecretSource = runtimeContext.walletSecretSource;
                context.techtree = runtimeContext.techtree;
                return;
            }
            try {
                const config = loadConfig(context.configPath);
                const stateStore = new StateStore(path.join(config.runtime.stateDir, "runtime-state.json"));
                const sessionStore = new SessionStore(stateStore);
                const walletSecretSource = createWalletSecretSource(config);
                const techtree = new TechtreeClient({
                    baseUrl: config.techtree.baseUrl,
                    requestTimeoutMs: config.techtree.requestTimeoutMs,
                    sessionStore,
                    walletSecretSource,
                    stateStore,
                });
                context.config = config;
                context.configLoadError = null;
                context.stateStore = stateStore;
                context.sessionStore = sessionStore;
                context.walletSecretSource = walletSecretSource;
                context.techtree = techtree;
            }
            catch (error) {
                context.config = null;
                context.configLoadError = error instanceof Error ? error : new Error(String(error));
                context.stateStore = null;
                context.sessionStore = null;
                context.walletSecretSource = null;
                context.techtree = null;
            }
        },
    };
    context.refreshConfig();
    return context;
}

const buildCheckResult = (check, outcome, startedAtIso, startedMs) => {
    return {
        id: check.id,
        scope: check.scope,
        status: outcome.status,
        title: check.title,
        message: outcome.message,
        ...(outcome.details ? { details: outcome.details } : {}),
        ...(outcome.remediation ? { remediation: outcome.remediation } : {}),
        ...(outcome.fixApplied ? { fixApplied: outcome.fixApplied } : {}),
        startedAt: startedAtIso,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
    };
};

const buildCrashedCheckResult = (check, error, startedAtIso, startedMs) => {
    return {
        id: check.id,
        scope: check.scope,
        status: "fail",
        title: check.title,
        message: "Doctor check crashed before it could return a result",
        details: {
            internal: true,
            code: "doctor_check_crashed",
            error: errorMessage(error),
            ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        },
        remediation: "Inspect the failing doctor check implementation and retry",
        startedAt: startedAtIso,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
    };
};

export async function runChecksSequentially(checks, ctx) {
    const results = [];
    for (const check of checks) {
        const startedAtIso = new Date().toISOString();
        const startedMs = Date.now();
        try {
            const outcome = await check.run(ctx);
            results.push(buildCheckResult(check, outcome, startedAtIso, startedMs));
        }
        catch (error) {
            results.push(buildCrashedCheckResult(check, error, startedAtIso, startedMs));
        }
    }
    return results;
}

export function summarizeChecks(results) {
    return results.reduce((summary, check) => {
        summary[check.status] += 1;
        return summary;
    }, { ok: 0, warn: 0, fail: 0, skip: 0 });
}

export function computeReportOk(_invocation, results) {
    return results.every((check) => check.status !== "fail");
}

const defaultChecks = () => DEFAULT_CHECK_FACTORIES.flatMap((factory) => factory());

function selectChecks(invocation) {
    const checks = defaultChecks();
    if (invocation.mode !== "scoped") {
        return checks;
    }
    if (invocation.params.scope === "artifact") {
        return artifactChecks();
    }
    if (invocation.params.scope === "bbh") {
        return bbhChecks();
    }
    return checks.filter((check) => check.scope === invocation.params.scope);
}

const collectBlockingChecks = (results) => {
    return results
        .filter((check) => DEFAULT_REQUIRED_OK.has(check.id) && check.status !== "ok")
        .map((check) => ({
        id: check.id,
        status: check.status,
        message: check.message,
        ...(check.remediation ? { remediation: check.remediation } : {}),
    }));
};

const hasBlockingFailuresForFull = (results) => collectBlockingChecks(results).length > 0;

function buildFullPreconditionFailure(results) {
    const blockingChecks = collectBlockingChecks(results);
    const startedAt = new Date().toISOString();
    const primaryRemediation = blockingChecks.find((check) => check.remediation)?.remediation;
    return {
        id: "full.preconditions",
        scope: "techtree",
        status: "fail",
        title: "full proof preconditions",
        message: "Full proof did not run because required default doctor checks are not yet passing",
        details: {
            blockingChecks,
        },
        remediation: primaryRemediation ?? "Resolve the blocking doctor checks and retry `regent doctor --full`",
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
    };
}

export async function runDoctorInvocation(invocation) {
    try {
        const ctx = buildDoctorContext(invocation);
        const results = await runChecksSequentially(selectChecks(invocation), ctx);
        if (invocation.mode === "full") {
            if (hasBlockingFailuresForFull(results)) {
                results.push(buildFullPreconditionFailure(results));
            }
            else {
                results.push(...(await runChecksSequentially(fullChecks(), ctx)));
            }
        }
        return {
            ok: computeReportOk(invocation, results),
            mode: invocation.mode,
            ...(invocation.mode === "scoped" ? { scope: invocation.params.scope } : {}),
            summary: summarizeChecks(results),
            checks: results,
            nextSteps: deriveNextSteps(results),
            generatedAt: new Date().toISOString(),
        };
    }
    catch (error) {
        if (error instanceof DoctorInternalError) {
            throw error;
        }
        throw new DoctorInternalError("doctor execution failed before a report could be produced", error);
    }
}

const runDoctorByMode = (mode, params, options) => {
    return runDoctorInvocation({
        mode,
        params,
        configPath: options?.configPath,
        runtimeContext: options?.runtimeContext,
    });
};

export async function runDoctor(params, options) {
    return runDoctorByMode("default", params, options);
}

export async function runScopedDoctor(params, options) {
    return runDoctorByMode("scoped", params, options);
}

export async function runFullDoctor(params, options) {
    return runDoctorByMode("full", params, options);
}
