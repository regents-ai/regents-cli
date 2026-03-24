import type { CommentCreateResponse, DoctorCheckResult, DoctorMode, DoctorReport, DoctorRunFullParams, DoctorRunParams, DoctorRunScopedParams, DoctorScope, DoctorStatus, NodeCreateResponse, RegentConfig } from "../../internal-types/index.js";
import type { WalletSecretSource } from "../agent/key-store.js";
import type { RuntimeContext } from "../runtime.js";
import type { SessionStore } from "../store/session-store.js";
import type { StateStore } from "../store/state-store.js";
import type { TechtreeClient } from "../techtree/client.js";
export interface DoctorCheckOutcome {
    status: DoctorStatus;
    message: string;
    details?: Record<string, unknown>;
    remediation?: string;
    fixApplied?: boolean;
}
export interface DoctorCheckDefinition {
    id: string;
    scope: DoctorScope;
    title: string;
    run: (ctx: DoctorCheckContext) => Promise<DoctorCheckOutcome>;
}
export interface DoctorFullState {
    nodeResponse?: NodeCreateResponse;
    commentResponse?: CommentCreateResponse;
}
export interface DoctorCheckContext {
    mode: DoctorMode;
    configPath: string;
    runtimeContext: RuntimeContext | null;
    config: RegentConfig | null;
    configLoadError: Error | null;
    stateStore: StateStore | null;
    sessionStore: SessionStore | null;
    walletSecretSource: WalletSecretSource | null;
    techtree: TechtreeClient | null;
    fix: boolean;
    verbose: boolean;
    knownParentId?: number;
    cleanupCommentBodyPrefix: string;
    fullState: DoctorFullState;
    refreshConfig: () => void;
}
export type DoctorInvocation = {
    mode: "default";
    configPath?: string;
    params?: DoctorRunParams;
    runtimeContext?: RuntimeContext;
} | {
    mode: "scoped";
    configPath?: string;
    params: DoctorRunScopedParams;
    runtimeContext?: RuntimeContext;
} | {
    mode: "full";
    configPath?: string;
    params?: DoctorRunFullParams;
    runtimeContext?: RuntimeContext;
};
export type { DoctorCheckResult, DoctorMode, DoctorReport, DoctorScope, DoctorStatus };
