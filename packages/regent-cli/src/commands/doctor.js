import { runDoctor, runFullDoctor, runScopedDoctor } from "../internal-runtime/index.js";
import { getBooleanFlag, getFlag, parseIntegerFlag } from "../parse.js";
import { printJson, printText } from "../printer.js";
import { renderDoctorReport } from "../printers/doctorPrinter.js";
const DOCTOR_SCOPES = ["runtime", "auth", "techtree", "transports", "xmtp"];
const DOCTOR_SCOPE_SET = new Set(DOCTOR_SCOPES);
const reportHasInternalFailure = (report) => {
    return report.checks.some((check) => check.details?.internal === true);
};
const doctorExitCode = (report) => {
    if (reportHasInternalFailure(report)) {
        return 3;
    }
    return report.summary.fail > 0 ? 1 : 0;
};
export class CliUsageError extends Error {
    constructor(message) {
        super(message);
        this.name = "CliUsageError";
    }
}
const isDoctorScope = (value) => DOCTOR_SCOPE_SET.has(value);
const resolveDoctorScope = (args) => {
    const scopeCandidate = args.positionals[1];
    if (!scopeCandidate || scopeCandidate.startsWith("--")) {
        return undefined;
    }
    if (!isDoctorScope(scopeCandidate)) {
        throw new CliUsageError(`invalid doctor scope: ${scopeCandidate}`);
    }
    return scopeCandidate;
};
const resolveDoctorParams = (args) => {
    const full = getBooleanFlag(args, "full");
    return {
        json: getBooleanFlag(args, "json"),
        verbose: getBooleanFlag(args, "verbose"),
        fix: getBooleanFlag(args, "fix"),
        quiet: getBooleanFlag(args, "quiet"),
        onlyFailures: getBooleanFlag(args, "only-failures"),
        ci: getBooleanFlag(args, "ci"),
        full,
        knownParentId: parseIntegerFlag(args, "known-parent-id"),
        cleanupCommentBodyPrefix: getFlag(args, "cleanup-comment-body-prefix"),
    };
};
export async function runDoctorCommand(args, configPath) {
    const scope = resolveDoctorScope(args);
    const params = resolveDoctorParams(args);
    const { json, verbose, fix, full, quiet, onlyFailures, ci, knownParentId, cleanupCommentBodyPrefix } = params;
    if (scope && full) {
        throw new CliUsageError("`regent doctor --full` does not support scoped subcommands");
    }
    let report;
    if (full) {
        report = await runFullDoctor({
            json,
            verbose,
            fix,
            knownParentId,
            cleanupCommentBodyPrefix,
        }, { configPath });
    }
    else if (scope) {
        report = await runScopedDoctor({
                scope,
                json,
                verbose,
                fix,
            }, { configPath });
    }
    else {
        report = await runDoctor({
                json,
                verbose,
                fix,
            }, { configPath });
    }
    if (json) {
        printJson(report);
    }
    else {
        printText(renderDoctorReport(report, { verbose, quiet, onlyFailures, ci }));
    }
    return doctorExitCode(report);
}
