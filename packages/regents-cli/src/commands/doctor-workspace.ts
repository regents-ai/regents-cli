import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";

import { getBooleanFlag, type ParsedCliArgs } from "../parse.js";
import { printJson, printText } from "../printer.js";
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
import { dirExists, fileExists, findRepoRoot } from "./doctor-shared.js";

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
