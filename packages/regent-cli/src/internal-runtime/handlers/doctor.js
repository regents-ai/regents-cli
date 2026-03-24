import { runDoctor, runFullDoctor, runScopedDoctor } from "../doctor/checkRunner.js";
export async function handleDoctorRun(ctx, params) {
    return runDoctor(params, { runtimeContext: ctx });
}
export async function handleDoctorRunScoped(ctx, params) {
    return runScopedDoctor(params, { runtimeContext: ctx });
}
export async function handleDoctorRunFull(ctx, params) {
    return runFullDoctor(params, { runtimeContext: ctx });
}
