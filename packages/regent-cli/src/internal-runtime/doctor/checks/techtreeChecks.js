import { getCurrentAgentIdentity, getMissingAgentIdentityFields } from "../../agent/profile.js";
import { buildBackendDetails, skipDueToMissingConfig } from "./shared.js";
const buildProbeFailureDetails = (route, error) => {
    const normalized = buildBackendDetails(error);
    return {
        route,
        ...(typeof normalized.code === "string" ? { code: normalized.code } : {}),
        ...(typeof normalized.message === "string" ? { message: normalized.message } : {}),
        ...(typeof normalized.status === "number" ? { status: normalized.status } : {}),
        ...(normalized.backend && typeof normalized.backend === "object" ? { backend: normalized.backend } : {}),
        ...(normalized.sidecar && typeof normalized.sidecar === "object" ? { sidecar: normalized.sidecar } : {}),
        raw: normalized,
    };
};
export function techtreeChecks() {
    return [
        {
            id: "techtree.health",
            scope: "techtree",
            title: "techtree health reachable",
            run: async (ctx) => {
                if (!ctx.techtree) {
                    return skipDueToMissingConfig();
                }
                try {
                    const health = await ctx.techtree.health();
                    return {
                        status: "ok",
                        message: "Techtree health endpoint responded successfully",
                        details: health,
                    };
                }
                catch (error) {
                    return {
                        status: "fail",
                        message: "Techtree health endpoint is unreachable or unhealthy",
                        details: buildBackendDetails(error),
                        remediation: "Verify the Techtree base URL and local Phoenix server",
                    };
                }
            },
        },
        {
            id: "techtree.public.read",
            scope: "techtree",
            title: "public read reachable",
            run: async (ctx) => {
                if (!ctx.techtree) {
                    return skipDueToMissingConfig();
                }
                try {
                    const response = await ctx.techtree.listNodes({ limit: 1 });
                    return {
                        status: "ok",
                        message: "Public Techtree read succeeded",
                        details: {
                            resultCount: response.data.length,
                        },
                    };
                }
                catch (error) {
                    return {
                        status: "fail",
                        message: "Public Techtree read failed",
                        details: buildBackendDetails(error),
                        remediation: "Verify general Techtree connectivity before debugging auth",
                    };
                }
            },
        },
        {
            id: "techtree.authenticated.probe",
            scope: "techtree",
            title: "authenticated probe",
            run: async (ctx) => {
                if (!ctx.techtree || !ctx.sessionStore || !ctx.stateStore) {
                    return skipDueToMissingConfig();
                }
                const session = ctx.sessionStore.getSiwaSession();
                if (!session) {
                    return {
                        status: "skip",
                        message: "Authenticated probe skipped because no SIWA session is stored locally",
                        remediation: "Run `regent auth siwa login`",
                    };
                }
                if (ctx.sessionStore.isReceiptExpired()) {
                    return {
                        status: "skip",
                        message: "Authenticated probe skipped because the stored SIWA receipt is expired",
                        remediation: "Run `regent auth siwa login` again",
                    };
                }
                const identity = getCurrentAgentIdentity(ctx.stateStore);
                const missingFields = getMissingAgentIdentityFields(ctx.stateStore);
                if (!identity || missingFields.length > 0) {
                    return {
                        status: "skip",
                        message: "Authenticated probe skipped because protected-route identity is incomplete",
                        remediation: "Run `regent auth siwa login --registry-address <addr> --token-id <id>`",
                    };
                }
                try {
                    const opportunities = await ctx.techtree.getOpportunities();
                    return {
                        status: "ok",
                        message: "Authenticated read-only Techtree probe succeeded via /v1/agent/opportunities",
                        details: {
                            route: "/v1/agent/opportunities",
                            opportunityCount: opportunities.opportunities.length,
                        },
                    };
                }
                catch (error) {
                    const details = buildProbeFailureDetails("/v1/agent/opportunities", error);
                    const routeMissing = typeof details.status === "number" && Number(details.status) === 404;
                    if (routeMissing) {
                        try {
                            const inbox = await ctx.techtree.getInbox({ limit: 1 });
                            return {
                                status: "ok",
                                message: "Authenticated read-only Techtree probe succeeded via /v1/agent/inbox",
                                details: {
                                    route: "/v1/agent/inbox",
                                    eventCount: inbox.events.length,
                                    fallbackFrom: "/v1/agent/opportunities",
                                },
                            };
                        }
                        catch (fallbackError) {
                            return {
                                status: "fail",
                                message: "Authenticated Techtree probe failed on both preferred and fallback routes",
                                details: {
                                    preferred: details,
                                    fallback: buildProbeFailureDetails("/v1/agent/inbox", fallbackError),
                                },
                                remediation: "Inspect auth headers and SIWA sidecar configuration",
                            };
                        }
                    }
                    return {
                        status: "fail",
                        message: "Authenticated Techtree probe failed",
                        details,
                        remediation: "Inspect auth headers and SIWA sidecar configuration",
                    };
                }
            },
        },
    ];
}
