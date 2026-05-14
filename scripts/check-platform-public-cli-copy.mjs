import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildCliCommandMetadata } from "./generate-cli-command-metadata.mjs";
import { loadYaml } from "./dependency-preflight.mjs";
import {
  readWorkspaceManifest,
  repoEntries,
} from "../packages/regents-cli/src/workspace/manifest.js";

const root = path.resolve(import.meta.dirname, "..");
const YAML = await loadYaml(root);
const manifest = readWorkspaceManifest(root, YAML);
const platformRepo = repoEntries(manifest, root).find((repo) => repo.name === "platform");

if (!platformRepo) {
  console.error("Regent workspace manifest is missing the Platform repo.");
  process.exit(1);
}

const platformCopyFiles = [
  "README.md",
  "lib/platform_phx_web/components/platform_components.ex",
  "lib/platform_phx_web/components/regent_cli_page.ex",
  "lib/platform_phx_web/live/autolaunch_live.ex",
  "lib/platform_phx_web/live/regents_cli_catalog.ex",
  "lib/platform_phx_web/live/techtree_live.ex",
  "lib/platform_phx_web/public_page_catalog.ex",
];

const ownerForPublicCommand = (commandKeyValue) => {
  const first = commandKeyValue.split(" ")[0];

  if (first === "techtree") {
    return "techtree";
  }

  if (first === "autolaunch") {
    return "autolaunch";
  }

  if (
    first === "platform" ||
    first === "runtime" ||
    first === "work" ||
    first === "agentbook" ||
    first === "regent-staking" ||
    first === "bug" ||
    first === "security-report"
  ) {
    return "platform";
  }

  return undefined;
};

const stripHtmlEntities = (value) =>
  value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", "\"");

const cleanToken = (token) =>
  stripHtmlEntities(token)
    .replace(/\\+$/u, "")
    .replace(/[),.;:]+$/u, "")
    .trim();

function commandKey(command) {
  const tokens = command
    .replace(/^regents?\s+/u, "")
    .split(/\s+/u)
    .map(cleanToken)
    .filter(Boolean);

  const commandTokens = [];
  for (const token of tokens) {
    if (
      token === "..." ||
      token === "…" ||
      token.startsWith("--") ||
      token.startsWith("[") ||
      token.startsWith("<")
    ) {
      break;
    }

    commandTokens.push(token);
  }

  return commandTokens.join(" ").trim();
}

const metadata = buildCliCommandMetadata();
const commandDetails = metadata.commandDetailsByCommand;
const commandRows = metadata.commands.map((command) => ({
  command,
  owner: commandDetails[command]?.owner,
  key: commandKey(command),
}));
const exactCommandsByKey = new Map(commandRows.map((row) => [row.key, row]));
const publicCommandPattern = /\bregents(?:\s+[A-Za-z0-9_<>{}\[\].:/=-]+)+/gu;

const extractCommands = (relativePath) => {
  const filePath = path.join(platformRepo.resolvedPath, relativePath);
  if (!fs.existsSync(filePath)) {
    return [
      {
        kind: "missing-file",
        relativePath,
        filePath,
      },
    ];
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/u);

  return lines.flatMap((line, index) =>
    Array.from(line.matchAll(publicCommandPattern), (match) => ({
      kind: "command",
      relativePath,
      line: index + 1,
      raw: stripHtmlEntities(match[0]).replace(/\s+/gu, " ").trim(),
    })),
  );
};

const matchCommand = (key) => {
  if (!key) {
    return [];
  }

  const exact = exactCommandsByKey.get(key);
  if (exact) {
    return [exact];
  }

  return commandRows.filter((row) => row.key.startsWith(`${key} `));
};

const suggestionsFor = (key) => {
  const [first, second] = key.split(" ");
  const candidates = commandRows
    .filter((row) => row.key.startsWith(first))
    .filter((row) => !second || row.key.includes(second))
    .slice(0, 5);

  return candidates.length > 0 ? candidates : commandRows.filter((row) => row.key.startsWith(first)).slice(0, 5);
};

const findings = [];

for (const entry of platformCopyFiles.flatMap(extractCommands)) {
  if (entry.kind === "missing-file") {
    findings.push({
      title: "Configured Platform public copy file is missing",
      location: entry.relativePath,
      detail: entry.filePath,
    });
    continue;
  }

  const key = commandKey(entry.raw);
  const matches = matchCommand(key);
  if (matches.length === 0) {
    findings.push({
      title: "Platform public copy references a command missing from CLI contracts",
      location: `${entry.relativePath}:${entry.line}`,
      detail: entry.raw,
      suggestions: suggestionsFor(key),
    });
    continue;
  }

  const expectedOwner = ownerForPublicCommand(key);
  if (expectedOwner && !matches.some((match) => match.owner === expectedOwner)) {
    findings.push({
      title: "Platform public copy references a command under the wrong owner",
      location: `${entry.relativePath}:${entry.line}`,
      detail: entry.raw,
      expectedOwner,
      matchedOwners: Array.from(new Set(matches.map((match) => match.owner).filter(Boolean))).sort(),
    });
  }
}

if (findings.length > 0) {
  console.error("Platform public CLI copy drift found.\n");

  for (const finding of findings) {
    console.error(`${finding.title}:`);
    console.error(`  ${finding.location}`);
    console.error(`  ${finding.detail}`);

    if (finding.expectedOwner) {
      console.error(`  expected owner: ${finding.expectedOwner}`);
      console.error(`  matched owners: ${finding.matchedOwners.join(", ") || "none"}`);
    }

    if (finding.suggestions?.length) {
      console.error("  closest known commands:");
      for (const suggestion of finding.suggestions) {
        console.error(`    regents ${suggestion.command}`);
      }
    }

    console.error("");
  }

  process.exit(1);
}

console.log("platform public CLI copy check passed");
