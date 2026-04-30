import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

import { CLI_COMMANDS } from "../command-registry.js";
import { loadConfig } from "../internal-runtime/config.js";
import { runDoctor, runFullDoctor, runScopedDoctor } from "../internal-runtime/index.js";
import type { DoctorReport, DoctorScope } from "../internal-types/index.js";
import { getBooleanFlag, getFlag, parseIntegerFlag, type ParsedCliArgs } from "../parse.js";
import { printJson, printText } from "../printer.js";
import { renderDoctorReport } from "../printers/doctorPrinter.js";
import { renderTablePanel } from "../terminal/table.js";
import {
    allContractEntries,
    defaultWorkspaceManifestPath,
    incidentClasses,
    knownReleaseGaps,
    moneyMovementRows,
    readWorkspaceManifest,
    repoEntries,
    sharedContractPairs,
    walletActionSchemaPath,
} from "../workspace/manifest.js";

const DOCTOR_SCOPES = ["runtime", "auth", "techtree", "transports", "xmtp"] as const satisfies readonly DoctorScope[];
type DoctorCommandScope = (typeof DOCTOR_SCOPES)[number] | "contracts" | "workspace";

const DOCTOR_SCOPE_SET = new Set<string>([...DOCTOR_SCOPES, "contracts", "workspace"]);

type ContractOwner = string;
type ContractKind = "api" | "cli" | "shared";
type BaseUrlKey = "platform" | "techtree" | "autolaunch" | "siwa";

interface ContractManifestEntry {
    readonly owner: ContractOwner;
    readonly kind: ContractKind;
    readonly sourceRepo: string;
    readonly contractPath: string;
    readonly generatedBindings: readonly string[];
    readonly releaseArtifactPaths: readonly string[];
    readonly ciCheckoutRequired: boolean;
    readonly baseUrlKey: BaseUrlKey | null;
}

interface ContractDoctorFileResult extends ContractManifestEntry {
    readonly path: string;
    readonly loaded: boolean;
    readonly version: string | null;
    readonly hash: string | null;
    readonly generatedStatus: "present" | "stale" | "missing" | "not_applicable";
    readonly generatedPaths: readonly string[];
    readonly commandStatus: "covered" | "missing" | "not_applicable";
    readonly commandCount: number;
    readonly missingCommands: readonly string[];
    readonly baseUrl: string | null;
}

interface ContractDoctorReport {
    readonly ok: boolean;
    readonly command: "regents doctor contracts";
    readonly root: string;
    readonly manifestPath: string;
    readonly files: readonly ContractDoctorFileResult[];
    readonly summary: {
        readonly loaded: number;
        readonly missingFiles: number;
        readonly missingGeneratedBindings: number;
        readonly staleGeneratedBindings: number;
        readonly missingCommands: number;
    };
}

interface BuildContractDoctorReportOptions {
    readonly manifestPath?: string;
}

interface WorkspaceDoctorRepoResult {
    readonly name: string;
    readonly owner: string;
    readonly path: string;
    readonly loaded: boolean;
    readonly requiredForPublicBeta: boolean;
    readonly releaseGroup: string;
    readonly ownedDomainCount: number;
    readonly contractCount: number;
    readonly acceptanceCommandCount: number;
}

interface WorkspaceDoctorReport {
    readonly ok: boolean;
    readonly command: "regents doctor workspace";
    readonly root: string;
    readonly manifestPath: string;
    readonly repos: readonly WorkspaceDoctorRepoResult[];
    readonly sharedContractPairs: readonly {
        readonly id: string;
        readonly source: string;
        readonly mirror: string;
        readonly matches: boolean;
    }[];
    readonly walletActionSchemaPath: string;
    readonly walletActionSchemaLoaded: boolean;
    readonly moneyMovementRows: number;
    readonly incidentClasses: number;
    readonly openReleaseGaps: number;
    readonly summary: {
        readonly requiredRepos: number;
        readonly missingRequiredRepos: number;
        readonly contracts: number;
        readonly acceptanceCommands: number;
    };
}

interface BuildWorkspaceDoctorReportOptions {
    readonly manifestPath?: string;
}

const BASE_URL_BY_OWNER: Readonly<Record<string, BaseUrlKey | null>> = {
    autolaunch: "autolaunch",
    ios: null,
    platform: "platform",
    "regents-cli": "siwa",
    "shared-services": "siwa",
    "siwa-server": "siwa",
    techtree: "techtree",
};

const reportHasInternalFailure = (report: DoctorReport): boolean => {
    return report.checks.some((check) => check.details?.internal === true);
};

const doctorExitCode = (report: DoctorReport): number => {
    if (reportHasInternalFailure(report)) {
        return 3;
    }
    return report.summary.fail > 0 ? 1 : 0;
};

export class CliUsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CliUsageError";
    }
}

const isDoctorScope = (value: string): value is DoctorCommandScope => DOCTOR_SCOPE_SET.has(value);

const currentModuleDir = path.dirname(fileURLToPath(import.meta.url));

const candidateRoots = (): readonly string[] => [
    process.cwd(),
    path.resolve(currentModuleDir, "../../.."),
    path.resolve(currentModuleDir, "../../../.."),
    path.resolve(currentModuleDir, "../../../../.."),
];

const findRepoRoot = (): string => {
    for (const root of candidateRoots()) {
        if (fs.existsSync(path.join(root, "docs", "shared-cli-contract.yaml"))) {
            return root;
        }
    }

    return process.cwd();
};

const manifestEntries = (repoRoot: string, manifestPath: string): readonly ContractManifestEntry[] => {
    const manifest = readWorkspaceManifest(repoRoot, YAML, manifestPath);
    return allContractEntries(manifest, repoRoot).map((entry: {
        owner: string;
        kind: ContractKind;
        sourceRepo: string;
        path: string;
        resolvedPath: string;
        generatedBindings: readonly { resolvedPath: string }[];
        requiredForPublicBeta: boolean;
    }) => ({
        owner: entry.owner,
        kind: entry.kind,
        sourceRepo: entry.sourceRepo,
        contractPath: entry.resolvedPath,
        generatedBindings: entry.generatedBindings.map((binding) => binding.resolvedPath),
        releaseArtifactPaths: [],
        ciCheckoutRequired: entry.requiredForPublicBeta,
        baseUrlKey: BASE_URL_BY_OWNER[entry.owner] ?? null,
    })).sort((left, right) =>
        `${left.owner}:${left.kind}:${left.contractPath}`.localeCompare(`${right.owner}:${right.kind}:${right.contractPath}`),
    );
};

const sha256Short = (content: string): string =>
    crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);

const extractVersion = (content: string): string | null => {
    const infoVersion = content.match(/^\s{2}version:\s*["']?([^"'\n]+)["']?\s*$/mu)?.[1];
    if (infoVersion) {
        return infoVersion.trim();
    }

    return content.match(/^version:\s*["']?([^"'\n]+)["']?\s*$/mu)?.[1]?.trim() ?? null;
};

const stripInlineComment = (value: string): string => value.replace(/\s+#.*$/u, "").trim();

const normalizeContractCommand = (command: string): string =>
    stripInlineComment(command)
        .replace(/^["']|["']$/gu, "")
        .replace(/^regents?\s+/u, "")
        .trim();

const extractContractCommands = (content: string): readonly string[] => {
    const commands = new Set<string>();
    const lines = content.split(/\r?\n/u);
    let commandListIndent: number | null = null;

    for (const line of lines) {
        if (/^\s*$|^\s*#/u.test(line)) {
            continue;
        }

        const indent = line.match(/^\s*/u)?.[0].length ?? 0;
        if (commandListIndent !== null && indent <= commandListIndent && !/^\s*-\s/u.test(line)) {
            commandListIndent = null;
        }

        if (/^\s*commands:\s*$/u.test(line)) {
            commandListIndent = indent;
            continue;
        }

        const objectName = line.match(/^\s*-\s+name:\s*(.+)$/u)?.[1];
        if (objectName && commandListIndent !== null && indent === commandListIndent + 2) {
            const command = normalizeContractCommand(objectName);
            if (command) {
                commands.add(command);
            }
            continue;
        }

        if (commandListIndent !== null) {
            const listItem = line.match(/^\s*-\s+(.+)$/u)?.[1];
            if (listItem && indent === commandListIndent + 2 && !listItem.includes(":")) {
                const command = normalizeContractCommand(listItem);
                if (command) {
                    commands.add(command);
                }
            }
        }
    }

    return [...commands].sort();
};

const baseUrls = (configPath?: string): Record<BaseUrlKey, string> => {
    const config = loadConfig(configPath);

    return {
        siwa: config.services.siwa.baseUrl.replace(/\/+$/u, ""),
        techtree: config.services.techtree.baseUrl.replace(/\/+$/u, ""),
        platform: (process.env.REGENT_PLATFORM_ORIGIN ?? config.services.platform.baseUrl).replace(/\/+$/u, ""),
        autolaunch: (process.env.AUTOLAUNCH_BASE_URL ?? config.services.autolaunch.baseUrl).replace(/\/+$/u, ""),
    };
};

const contractFileResult = (
    entry: ContractManifestEntry,
    urls: Record<BaseUrlKey, string>,
): ContractDoctorFileResult => {
    const filePath = entry.contractPath;
    const generatedPaths = entry.generatedBindings;
    const sourceExists = fs.existsSync(filePath);
    const generatedStatus = generatedPaths.length > 0
        ? generatedPaths.some((generatedPath) => !fs.existsSync(generatedPath))
            ? "missing"
            : sourceExists && generatedPaths.some((generatedPath) => fs.statSync(generatedPath).mtimeMs < fs.statSync(filePath).mtimeMs)
                ? "stale"
                : "present"
        : "not_applicable";

    if (!sourceExists) {
        return {
            ...entry,
            path: filePath,
            loaded: false,
            version: null,
            hash: null,
            generatedStatus,
            generatedPaths,
            commandStatus: entry.kind === "cli" ? "missing" : "not_applicable",
            commandCount: 0,
            missingCommands: [],
            baseUrl: entry.baseUrlKey ? urls[entry.baseUrlKey] : null,
        };
    }

    const content = fs.readFileSync(filePath, "utf8");
    const commands = entry.kind === "cli" ? extractContractCommands(content) : [];
    const missingCommands = commands.filter((command) => !CLI_COMMANDS.includes(command as (typeof CLI_COMMANDS)[number]));

    return {
        ...entry,
        path: filePath,
        loaded: true,
        version: extractVersion(content),
        hash: sha256Short(content),
        generatedStatus,
        generatedPaths,
        commandStatus: entry.kind === "cli" ? missingCommands.length === 0 ? "covered" : "missing" : "not_applicable",
        commandCount: commands.length,
        missingCommands,
        baseUrl: entry.baseUrlKey ? urls[entry.baseUrlKey] : null,
    };
};

export const buildContractDoctorReport = (
    configPath?: string,
    options: BuildContractDoctorReportOptions = {},
): ContractDoctorReport => {
    const root = findRepoRoot();
    const manifestPath = options.manifestPath ?? defaultWorkspaceManifestPath(root);
    const urls = baseUrls(configPath);
    const files = manifestEntries(root, manifestPath).map((entry) => contractFileResult(entry, urls));
    const missingGeneratedBindings = files.filter((file) => file.generatedStatus === "missing").length;
    const staleGeneratedBindings = files.filter((file) => file.generatedStatus === "stale").length;
    const missingCommands = files.reduce((count, file) => count + file.missingCommands.length, 0);
    const missingFiles = files.filter((file) => !file.loaded).length;

    return {
        ok: missingFiles === 0 && missingGeneratedBindings === 0 && staleGeneratedBindings === 0 && missingCommands === 0,
        command: "regents doctor contracts",
        root,
        manifestPath,
        files,
        summary: {
            loaded: files.filter((file) => file.loaded).length,
            missingFiles,
            missingGeneratedBindings,
            staleGeneratedBindings,
            missingCommands,
        },
    };
};

const renderContractDoctorReport = (report: ContractDoctorReport): string => {
    const rows = report.files.map((file) => ({
        cells: [
            file.owner,
            file.kind,
            path.isAbsolute(file.contractPath) ? path.relative(report.root, file.contractPath) : file.contractPath,
            file.version ?? "unknown",
            file.hash ?? "missing",
            file.generatedPaths.length > 0
                ? `${file.generatedStatus}: ${file.generatedPaths.map((generatedPath) => path.relative(report.root, generatedPath)).join(", ")}`
                : "-",
            file.commandStatus === "not_applicable" ? "-" : `${file.commandStatus} (${file.commandCount})`,
            file.ciCheckoutRequired ? "yes" : "no",
            file.baseUrl ?? "-",
        ],
    }));

    const missingCommands = report.files
        .filter((file) => file.missingCommands.length > 0)
        .flatMap((file) => file.missingCommands.map((command) => `${file.owner}: ${command}`));

    return [
        renderTablePanel(
            "CONTRACTS",
            [
                { header: "owner" },
                { header: "kind" },
                { header: "contract" },
                { header: "version" },
                { header: "hash" },
                { header: "generated" },
                { header: "commands" },
                { header: "CI checkout" },
                { header: "base URL" },
            ],
            rows,
        ),
        renderTablePanel(
            "SUMMARY",
            [
                { header: "loaded", align: "right" },
                { header: "missing files", align: "right" },
                { header: "missing generated", align: "right" },
                { header: "stale generated", align: "right" },
                { header: "missing commands", align: "right" },
                { header: "ready" },
            ],
            [
                {
                    cells: [
                        String(report.summary.loaded),
                        String(report.summary.missingFiles),
                        String(report.summary.missingGeneratedBindings),
                        String(report.summary.staleGeneratedBindings),
                        String(report.summary.missingCommands),
                        report.ok ? "yes" : "no",
                    ],
                },
            ],
        ),
        missingCommands.length > 0
            ? renderTablePanel(
                "MISSING COMMANDS",
                [{ header: "command" }],
                missingCommands.map((command) => ({ cells: [command] })),
            )
            : undefined,
    ]
        .filter((part): part is string => Boolean(part))
        .join("\n\n");
};

export const runDoctorContractsCommand = (args: ParsedCliArgs, configPath?: string): number => {
    const json = getBooleanFlag(args, "json");
    const report = buildContractDoctorReport(configPath);
    if (json) {
        printJson(report);
    }
    else {
        printText(renderContractDoctorReport(report));
    }

    return report.ok ? 0 : 1;
};

const fileExists = (filePath: string): boolean => {
    try {
        return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    }
    catch {
        return false;
    }
};

const dirExists = (dirPath: string): boolean => {
    try {
        return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    }
    catch {
        return false;
    }
};

export const buildWorkspaceDoctorReport = (
    _configPath?: string,
    options: BuildWorkspaceDoctorReportOptions = {},
): WorkspaceDoctorReport => {
    const root = findRepoRoot();
    const manifestPath = options.manifestPath ?? defaultWorkspaceManifestPath(root);
    const manifest = readWorkspaceManifest(root, YAML, manifestPath);
    const contracts = allContractEntries(manifest, root);
    const repos = repoEntries(manifest, root).map((repo: {
        name: string;
        owner: string;
        resolvedPath: string;
        requiredForPublicBeta: boolean;
        releaseGroup: string;
        owns: readonly string[];
        acceptanceCommands: readonly unknown[];
    }): WorkspaceDoctorRepoResult => ({
        name: repo.name,
        owner: repo.owner,
        path: repo.resolvedPath,
        loaded: dirExists(repo.resolvedPath),
        requiredForPublicBeta: repo.requiredForPublicBeta,
        releaseGroup: repo.releaseGroup,
        ownedDomainCount: repo.owns.length,
        contractCount: contracts.filter((contract: { repo: string }) => contract.repo === repo.name).length,
        acceptanceCommandCount: repo.acceptanceCommands.length,
    }));

    const pairs = sharedContractPairs(manifest, root).map((pair: { id: string; source: string; mirror: string }) => ({
        id: pair.id,
        source: pair.source,
        mirror: pair.mirror,
        matches: fileExists(pair.source) && fileExists(pair.mirror) && fs.readFileSync(pair.source).equals(fs.readFileSync(pair.mirror)),
    }));
    const schemaPath = walletActionSchemaPath(manifest, root);
    const missingRequiredRepos = repos.filter((repo) => repo.requiredForPublicBeta && !repo.loaded).length;
    const acceptanceCommands = repos.reduce((count, repo) => count + repo.acceptanceCommandCount, 0);
    const pairFailures = pairs.filter((pair) => !pair.matches).length;

    return {
        ok: missingRequiredRepos === 0 && pairFailures === 0 && fileExists(schemaPath),
        command: "regents doctor workspace",
        root,
        manifestPath,
        repos,
        sharedContractPairs: pairs,
        walletActionSchemaPath: schemaPath,
        walletActionSchemaLoaded: fileExists(schemaPath),
        moneyMovementRows: moneyMovementRows(manifest).length,
        incidentClasses: incidentClasses(manifest).length,
        openReleaseGaps: knownReleaseGaps(manifest).filter((gap: { status: string }) => gap.status !== "done").length,
        summary: {
            requiredRepos: repos.filter((repo) => repo.requiredForPublicBeta).length,
            missingRequiredRepos,
            contracts: contracts.length,
            acceptanceCommands,
        },
    };
};

const renderWorkspaceDoctorReport = (report: WorkspaceDoctorReport): string => {
    return [
        renderTablePanel(
            "WORKSPACE",
            [
                { header: "repo" },
                { header: "group" },
                { header: "required" },
                { header: "present" },
                { header: "contracts", align: "right" },
                { header: "checks", align: "right" },
                { header: "path" },
            ],
            report.repos.map((repo) => ({
                cells: [
                    repo.name,
                    repo.releaseGroup,
                    repo.requiredForPublicBeta ? "yes" : "no",
                    repo.loaded ? "yes" : "no",
                    String(repo.contractCount),
                    String(repo.acceptanceCommandCount),
                    path.relative(report.root, repo.path),
                ],
            })),
        ),
        renderTablePanel(
            "SHARED CONTRACTS",
            [
                { header: "pair" },
                { header: "matches" },
                { header: "source" },
                { header: "mirror" },
            ],
            report.sharedContractPairs.map((pair) => ({
                cells: [
                    pair.id,
                    pair.matches ? "yes" : "no",
                    path.relative(report.root, pair.source),
                    path.relative(report.root, pair.mirror),
                ],
            })),
        ),
        renderTablePanel(
            "SUMMARY",
            [
                { header: "required repos", align: "right" },
                { header: "missing repos", align: "right" },
                { header: "contracts", align: "right" },
                { header: "checks", align: "right" },
                { header: "money rows", align: "right" },
                { header: "incidents", align: "right" },
                { header: "open gaps", align: "right" },
                { header: "WalletAction" },
                { header: "ready" },
            ],
            [
                {
                    cells: [
                        String(report.summary.requiredRepos),
                        String(report.summary.missingRequiredRepos),
                        String(report.summary.contracts),
                        String(report.summary.acceptanceCommands),
                        String(report.moneyMovementRows),
                        String(report.incidentClasses),
                        String(report.openReleaseGaps),
                        report.walletActionSchemaLoaded ? "present" : "missing",
                        report.ok ? "yes" : "no",
                    ],
                },
            ],
        ),
    ].join("\n\n");
};

export const runDoctorWorkspaceCommand = (args: ParsedCliArgs, configPath?: string): number => {
    const json = getBooleanFlag(args, "json");
    const report = buildWorkspaceDoctorReport(configPath);
    if (json) {
        printJson(report);
    }
    else {
        printText(renderWorkspaceDoctorReport(report));
    }

    return report.ok ? 0 : 1;
};

const resolveDoctorScope = (args: ParsedCliArgs): DoctorCommandScope | undefined => {
    const scopeCandidate = args.positionals[1];
    if (!scopeCandidate || scopeCandidate.startsWith("--")) {
        return undefined;
    }
    if (!isDoctorScope(scopeCandidate)) {
        throw new CliUsageError(`invalid doctor scope: ${scopeCandidate}`);
    }
    return scopeCandidate;
};

const resolveDoctorParams = (args: ParsedCliArgs) => {
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

export async function runDoctorCommand(args: ParsedCliArgs, configPath?: string): Promise<number> {
    const scope = resolveDoctorScope(args);
    const params = resolveDoctorParams(args);
    const { json, verbose, fix, full, quiet, onlyFailures, ci, knownParentId, cleanupCommentBodyPrefix } = params;
    if (scope && full) {
        throw new CliUsageError("`regents doctor --full` does not support scoped subcommands");
    }
    if (scope === "contracts") {
        return runDoctorContractsCommand(args, configPath);
    }
    if (scope === "workspace") {
        return runDoctorWorkspaceCommand(args, configPath);
    }
    let report: DoctorReport;
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
