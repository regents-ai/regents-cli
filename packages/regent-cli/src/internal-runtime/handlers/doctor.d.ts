import type { DoctorReport, DoctorRunFullParams, DoctorRunParams, DoctorRunScopedParams } from "../../internal-types/index.js";
import type { RuntimeContext } from "../runtime.js";
export declare function handleDoctorRun(ctx: RuntimeContext, params?: DoctorRunParams): Promise<DoctorReport>;
export declare function handleDoctorRunScoped(ctx: RuntimeContext, params: DoctorRunScopedParams): Promise<DoctorReport>;
export declare function handleDoctorRunFull(ctx: RuntimeContext, params?: DoctorRunFullParams): Promise<DoctorReport>;
