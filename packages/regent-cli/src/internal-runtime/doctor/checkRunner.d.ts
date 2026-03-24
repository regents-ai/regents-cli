import type { DoctorCheckResult, DoctorReport, DoctorRunFullParams, DoctorRunParams, DoctorRunScopedParams } from "../../internal-types/index.js";
import type { RuntimeContext } from "../runtime.js";
import type { DoctorCheckContext, DoctorCheckDefinition, DoctorInvocation } from "./types.js";
export declare function runChecksSequentially(checks: DoctorCheckDefinition[], ctx: DoctorCheckContext): Promise<DoctorCheckResult[]>;
export declare function summarizeChecks(results: DoctorCheckResult[]): {
    ok: number;
    warn: number;
    fail: number;
    skip: number;
};
export declare function computeReportOk(_invocation: DoctorInvocation, results: DoctorCheckResult[]): boolean;
export declare function runDoctorInvocation(invocation: DoctorInvocation): Promise<DoctorReport>;
export declare function runDoctor(params?: DoctorRunParams, options?: {
    configPath?: string;
    runtimeContext?: RuntimeContext;
}): Promise<DoctorReport>;
export declare function runScopedDoctor(params: DoctorRunScopedParams, options?: {
    configPath?: string;
    runtimeContext?: RuntimeContext;
}): Promise<DoctorReport>;
export declare function runFullDoctor(params?: DoctorRunFullParams, options?: {
    configPath?: string;
    runtimeContext?: RuntimeContext;
}): Promise<DoctorReport>;
