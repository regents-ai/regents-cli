import { CLI_PALETTE } from "../printer.js";

const ANSI = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    charcoalBlue: CLI_PALETTE.chrome,
    yaleBlue: CLI_PALETTE.emphasis,
    ivoryMist: CLI_PALETTE.primary,
    sunlitClay: CLI_PALETTE.accent,
    greyOlive: CLI_PALETTE.secondary,
};
const stripAnsi = (value) => value.replace(/\x1b\[[0-9;]*m/g, "");
const useColor = () => Boolean(process.stdout?.isTTY) && process.env.NO_COLOR !== "1";
const tone = (value, color, bold = false) => {
    if (!useColor()) {
        return value;
    }
    return `${bold ? ANSI.bold : ""}${color}${value}${ANSI.reset}`;
};
const padRight = (value, width) => {
    const visible = stripAnsi(value).length;
    return visible >= width ? value : `${value}${" ".repeat(width - visible)}`;
};
const frame = (title, lines) => {
    const contentWidth = Math.max(stripAnsi(title).length, ...lines.map((line) => stripAnsi(line).length), 28);
    const horizontal = "─".repeat(contentWidth + 2);
    const top = `${ANSI.charcoalBlue}╭─ ${tone(title, ANSI.ivoryMist, true)} ${"─".repeat(Math.max(0, contentWidth - stripAnsi(title).length))}╮${ANSI.reset}`;
    const body = lines.map((line) => `│ ${padRight(line, contentWidth)} │`);
    const bottom = `${ANSI.charcoalBlue}╰${horizontal}╯${ANSI.reset}`;
    return [top, ...body, bottom].join("\n");
};
const reportState = (report) => {
    if (report.summary.fail > 0) {
        return "blocked";
    }
    if (report.summary.warn > 0 || report.summary.skip > 0) {
        return "degraded";
    }
    return "ready";
};
const statusMeta = (status) => {
    switch (status) {
        case "ok":
            return { glyph: "●", label: "ready", color: ANSI.yaleBlue };
        case "warn":
            return { glyph: "◐", label: "watch", color: ANSI.sunlitClay };
        case "fail":
            return { glyph: "◆", label: "block", color: ANSI.sunlitClay };
        case "skip":
            return { glyph: "○", label: "skip", color: ANSI.greyOlive };
        default:
            return { glyph: "•", label: status, color: ANSI.ivoryMist };
    }
};
const scopeLabel = (report) => {
    if (report.mode === "scoped" && report.scope) {
        return `${report.scope} scope`;
    }
    if (report.mode === "full") {
        return "full proof";
    }
    return "default sweep";
};
const renderSummaryBand = (report) => {
    const parts = [
        `${tone("ok", ANSI.greyOlive)} ${tone(String(report.summary.ok), ANSI.yaleBlue, true)}`,
        `${tone("warn", ANSI.greyOlive)} ${tone(String(report.summary.warn), ANSI.sunlitClay, true)}`,
        `${tone("fail", ANSI.greyOlive)} ${tone(String(report.summary.fail), ANSI.sunlitClay, true)}`,
        `${tone("skip", ANSI.greyOlive)} ${tone(String(report.summary.skip), ANSI.greyOlive, true)}`,
    ];
    return `ledger  ${parts.join("   ")}`;
};
const formatCheck = (check, verbose) => {
    const status = statusMeta(check.status);
    const lines = [
        `${tone(status.glyph, status.color, true)} ${tone(status.label.toUpperCase(), status.color, true)}  ${tone(check.title, ANSI.ivoryMist, true)}`,
        `   ${check.message}`,
    ];
    if (check.remediation) {
        lines.push(`   ${tone("→", ANSI.sunlitClay, true)} ${check.remediation}`);
    }
    if (check.fixApplied) {
        lines.push(`   ${tone("✓", ANSI.yaleBlue, true)} local fix applied`);
    }
    if (verbose) {
        lines.push(`   ${tone("duration", ANSI.greyOlive)} ${tone(`${check.durationMs}ms`, ANSI.ivoryMist, true)}`);
        if (check.details) {
            lines.push(`   ${tone("details", ANSI.greyOlive)} ${JSON.stringify(check.details)}`);
        }
    }
    return lines;
};
const renderCiReport = (report, checks) => {
    const scope = report.mode === "scoped" && report.scope ? ` ${report.scope}` : "";
    const lines = [
        `${reportState(report).toUpperCase()}${scope} ${report.summary.ok} ok, ${report.summary.warn} warn, ${report.summary.fail} fail, ${report.summary.skip} skip`,
    ];
    for (const check of checks) {
        lines.push(`${check.status.toUpperCase()} ${check.id} :: ${check.message}`);
    }
    if (report.nextSteps[0]) {
        lines.push(`NEXT ${report.nextSteps[0]}`);
    }
    return lines.join("\n");
};
export function renderDoctorReport(report, options) {
    const selectedChecks = report.checks.filter((check) => {
        if (options?.onlyFailures) {
            return check.status === "fail";
        }
        return true;
    });
    if (options?.ci) {
        const ciChecks = selectedChecks.filter((check) => check.status !== "ok");
        return renderCiReport(report, ciChecks);
    }
    const state = reportState(report);
    const stateTone = state === "ready"
        ? tone("READY", ANSI.yaleBlue, true)
        : state === "degraded"
            ? tone("DEGRADED", ANSI.sunlitClay, true)
            : tone("BLOCKED", ANSI.sunlitClay, true);
    const summaryLines = [
        `${tone("mode", ANSI.greyOlive)} ${tone(scopeLabel(report), ANSI.ivoryMist, true)}`,
        `${tone("state", ANSI.greyOlive)} ${stateTone}`,
        renderSummaryBand(report),
        `${tone("generated", ANSI.greyOlive)} ${report.generatedAt}`,
    ];
    const sections = [frame("◆ R E G E N T   D O C T O R", summaryLines)];
    if (!options?.quiet) {
        const checkLines = [];
        for (const check of selectedChecks) {
            checkLines.push(...formatCheck(check, options?.verbose ?? false), "");
        }
        if (checkLines.length > 0) {
            checkLines.pop();
            sections.push(frame("◆ CHECK GRID", checkLines));
        }
    }
    const nextStepLines = report.nextSteps.length > 0
        ? report.nextSteps.map((step, index) => `${index === 0 ? tone("▶ now", ANSI.sunlitClay, true) : tone("• later", ANSI.greyOlive)} ${step}`)
        : [tone("no follow-up needed", ANSI.yaleBlue, true)];
    sections.push(frame("◆ NEXT MOVES", nextStepLines));
    return sections.join("\n\n");
}
