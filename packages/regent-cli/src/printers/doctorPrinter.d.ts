import type { DoctorReport } from "../internal-types/index.js";
export interface RenderDoctorReportOptions {
    verbose?: boolean;
    quiet?: boolean;
    onlyFailures?: boolean;
    ci?: boolean;
}
export declare function renderDoctorReport(report: DoctorReport, options?: RenderDoctorReportOptions): string;
