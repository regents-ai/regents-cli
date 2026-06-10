import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";

import { CLI_COMMANDS } from "../command-registry.js";
import { loadConfig } from "../internal-runtime/config.js";
import { getBooleanFlag, type ParsedCliArgs } from "../parse.js";
import { printJson, printText } from "../printer.js";
import { renderTablePanel } from "../terminal/table.js";
import {
    allContractEntries,
    defaultWorkspaceManifestPath,
    readWorkspaceManifest,
} from "../workspace/manifest.js";
import { findRepoRoot } from "./doctor-shared.js";

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

const BASE_URL_BY_OWNER: Readonly<Record<string, BaseUrlKey | null>> = {
    autolaunch: "autolaunch",
    ios: null,
    platform: "platform",
    "regents-cli": "siwa",
    "shared-services": "siwa",
    "siwa-server": "siwa",
    techtree: "techtree",
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
