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

const DOCTOR_SCOPES = ["runtime", "auth", "techtree", "transports", "xmtp"] as const satisfies readonly DoctorScope[];
type DoctorCommandScope = (typeof DOCTOR_SCOPES)[number] | "contracts";

const DOCTOR_SCOPE_SET = new Set<string>([...DOCTOR_SCOPES, "contracts"]);

type ContractOwner = string;
type ContractKind = "api" | "cli";
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
    readonly registryPath: string;
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
    readonly registryPath?: string;
}

interface RegistryDocument {
    readonly interfaces: Readonly<Record<string, RegistryInterface>>;
}

interface RegistryInterface {
    readonly repo?: string;
    readonly repos?: readonly string[];
    readonly api_contracts: readonly string[];
    readonly cli_contracts: readonly string[];
    readonly generated_bindings: readonly RegistryGeneratedBinding[];
    readonly release_artifacts: readonly string[];
    readonly minimum_ci_checkout?: {
        readonly repos?: readonly string[];
    };
}

interface RegistryGeneratedBinding {
    readonly path: string;
    readonly source_contract: string;
}

const BASE_URL_BY_REGISTRY_KEY: Readonly<Record<string, BaseUrlKey | null>> = {
    autolaunch: "autolaunch",
    ios: null,
    platform: "platform",
    regents_cli: "siwa",
    shared_services: "siwa",
    siwa_server: "siwa",
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

const defaultRegistryPath = (repoRoot: string): string =>
    path.resolve(repoRoot, "..", "docs", "regent-interface-registry.yaml");

const requireString = (value: unknown, field: string): string => {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`Regent interface registry has an invalid ${field}.`);
    }

    return value.trim();
};

const requireStringArray = (value: unknown, field: string): readonly string[] => {
    if (!Array.isArray(value)) {
        throw new Error(`Regent interface registry has an invalid ${field}.`);
    }

    return value.map((item, index) => requireString(item, `${field}[${index}]`));
};

const parseRegistryDocument = (registryPath: string): RegistryDocument => {
    const parsed = YAML.parse(fs.readFileSync(registryPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Regent interface registry must be a YAML object.");
    }

    const interfaces = (parsed as { interfaces?: unknown }).interfaces;
    if (!interfaces || typeof interfaces !== "object" || Array.isArray(interfaces)) {
        throw new Error("Regent interface registry must define interfaces.");
    }

    return {
        interfaces: Object.fromEntries(Object.entries(interfaces).map(([key, entry]): [string, RegistryInterface] => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                throw new Error(`Regent interface registry has an invalid interfaces.${key} entry.`);
            }

            const record = entry as Record<string, unknown>;
            const generatedBindings = record.generated_bindings;
            if (!Array.isArray(generatedBindings)) {
                throw new Error(`Regent interface registry has an invalid interfaces.${key}.generated_bindings.`);
            }

            const registryInterface = {
                ...(typeof record.repo === "string" ? { repo: record.repo } : {}),
                ...(Array.isArray(record.repos) ? { repos: requireStringArray(record.repos, `interfaces.${key}.repos`) } : {}),
                api_contracts: requireStringArray(record.api_contracts, `interfaces.${key}.api_contracts`),
                cli_contracts: requireStringArray(record.cli_contracts, `interfaces.${key}.cli_contracts`),
                generated_bindings: generatedBindings.map((binding, index): RegistryGeneratedBinding => {
                    if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
                        throw new Error(`Regent interface registry has an invalid interfaces.${key}.generated_bindings[${index}].`);
                    }
                    const bindingRecord = binding as Record<string, unknown>;
                    return {
                        path: requireString(bindingRecord.path, `interfaces.${key}.generated_bindings[${index}].path`),
                        source_contract: requireString(bindingRecord.source_contract, `interfaces.${key}.generated_bindings[${index}].source_contract`),
                    };
                }),
                release_artifacts: requireStringArray(record.release_artifacts, `interfaces.${key}.release_artifacts`),
                ...(record.minimum_ci_checkout && typeof record.minimum_ci_checkout === "object" && !Array.isArray(record.minimum_ci_checkout)
                    ? {
                        minimum_ci_checkout: {
                            repos: requireStringArray(
                                (record.minimum_ci_checkout as { repos?: unknown }).repos,
                                `interfaces.${key}.minimum_ci_checkout.repos`,
                            ),
                        },
                    }
                    : {}),
            };

            return [key, registryInterface];
        })),
    };
};

const registryEntries = (registryPath: string): readonly ContractManifestEntry[] => {
    if (!fs.existsSync(registryPath)) {
        throw new Error(
            `Regent interface registry is missing: ${registryPath}. Add docs/regent-interface-registry.yaml, then run this again.`,
        );
    }

    const registry = parseRegistryDocument(registryPath);
    return Object.entries(registry.interfaces).flatMap(([key, entry]): ContractManifestEntry[] => {
        const sourceRepo = entry.repo ?? entry.repos?.join(", ") ?? key;
        const baseUrlKey = BASE_URL_BY_REGISTRY_KEY[key] ?? null;
        const generatedBindingsForContract = (contractPath: string): readonly string[] =>
            entry.generated_bindings
                .filter((binding) => path.resolve(binding.source_contract) === path.resolve(contractPath))
                .map((binding) => binding.path);
        const common = {
            owner: key,
            sourceRepo,
            releaseArtifactPaths: entry.release_artifacts,
            ciCheckoutRequired: (entry.minimum_ci_checkout?.repos?.length ?? 0) > 0,
            baseUrlKey,
        };
        return [
            ...entry.api_contracts.map((contractPath) => ({
                    ...common,
                    kind: "api" as const,
                    contractPath,
                    generatedBindings: generatedBindingsForContract(contractPath),
                })),
            ...entry.cli_contracts.map((contractPath) => ({
                    ...common,
                    kind: "cli" as const,
                    contractPath,
                    generatedBindings: generatedBindingsForContract(contractPath),
                })),
        ];
    }).sort((left, right) =>
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
    regentRoot: string,
    entry: ContractManifestEntry,
    urls: Record<BaseUrlKey, string>,
): ContractDoctorFileResult => {
    const filePath = path.isAbsolute(entry.contractPath) ? entry.contractPath : path.resolve(regentRoot, entry.contractPath);
    const generatedPaths = entry.generatedBindings.map((bindingPath) =>
        path.isAbsolute(bindingPath) ? bindingPath : path.resolve(regentRoot, bindingPath),
    );
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
    const regentRoot = path.resolve(root, "..");
    const registryPath = options.registryPath ?? defaultRegistryPath(root);
    const urls = baseUrls(configPath);
    const files = registryEntries(registryPath).map((entry) => contractFileResult(regentRoot, entry, urls));
    const missingGeneratedBindings = files.filter((file) => file.generatedStatus === "missing").length;
    const staleGeneratedBindings = files.filter((file) => file.generatedStatus === "stale").length;
    const missingCommands = files.reduce((count, file) => count + file.missingCommands.length, 0);
    const missingFiles = files.filter((file) => !file.loaded).length;

    return {
        ok: missingFiles === 0 && missingGeneratedBindings === 0 && staleGeneratedBindings === 0 && missingCommands === 0,
        command: "regents doctor contracts",
        root,
        registryPath,
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
            path.isAbsolute(file.contractPath) ? path.relative(path.resolve(report.root, ".."), file.contractPath) : file.contractPath,
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
