import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";
import { loadYaml } from "./dependency-preflight.mjs";
import {
  allContractEntries,
  defaultWorkspaceManifestPath,
  readWorkspaceManifest,
  repoEntries,
  sharedContractPairs,
  workspaceRootFromCliRoot,
} from "../packages/regents-cli/src/workspace/manifest.js";

const BEGIN = "<!-- BEGIN REGENT META GENERATED -->";
const END = "<!-- END REGENT META GENERATED -->";

const generatedBlock = (title, body) => [
  BEGIN,
  `## ${title}`,
  "",
  "Generated from `meta/stack.yaml` and repo `repo.yaml` files. Local notes may live outside this block.",
  "",
  body.trimEnd(),
  END,
  "",
].join("\n");

const replaceGeneratedBlock = (current, block) => {
  const start = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  if (start >= 0 && end > start) {
    return `${current.slice(0, start)}${block}${current.slice(end + END.length).replace(/^\n+/u, "")}`;
  }
  return `${block}${current}`;
};

const readText = (path, fallback) => existsSync(path) ? readFileSync(path, "utf8") : fallback;

const repoDisplay = (repo) => `\`${repo.name}\``;

const renderRootAgentsBlock = (manifest, cliRoot) => {
  const activeRepos = repoEntries(manifest, cliRoot).filter((repo) => repo.active);
  return generatedBlock("Regent Meta Control Plane", [
    "- `founder.md` is the short constitution.",
    "- `meta/stack.yaml` is the stack-level machine contract.",
    "- Each active repo has one `repo.yaml` repo contract.",
    "- OpenAPI YAML owns HTTP behavior, CLI YAML owns terminal behavior, JSON-RPC YAML owns local runtime methods, and `chain-contracts.yaml` owns prepared onchain actions.",
    "- `bd` is the execution graph for tickets, claims, blockers, dependencies, and closure evidence. It never overrides the source-of-truth files.",
    "- Run `cd regents-cli && pnpm check:meta` or `regents meta check` before release gates.",
    "",
    `Active repos: ${activeRepos.map(repoDisplay).join(", ")}.`,
  ].join("\n"));
};

const renderRepoAgentsBlock = (repo) => generatedBlock("Repo Contract", [
  `- Repo contract: \`${repo.path}/repo.yaml\``,
  `- Owner: \`${repo.owner}\``,
  `- Release group: \`${repo.releaseGroup}\``,
  `- Owned areas: ${repo.owns.length > 0 ? repo.owns.map((item) => `\`${item}\``).join(", ") : "none listed"}.`,
  "- Change API or CLI behavior in the owning YAML contract before changing code.",
  "- Use `bd` only for execution state: tickets, claims, blockers, dependencies, and closure evidence.",
].join("\n"));

const contractRows = (contracts) =>
  contracts.length === 0
    ? "- No contracts listed."
    : contracts.map((contract) => `- \`${contract.id}\` (${contract.kind}, owner \`${contract.owner}\`): \`${contract.path}\``).join("\n");

const renderLayer2Block = (repo, contracts) => generatedBlock("Layer 2 Generated View", [
  `- Owner: \`${repo.owner}\``,
  `- Release group: \`${repo.releaseGroup}\``,
  `- Required for public beta: \`${repo.requiredForPublicBeta}\``,
  `- Owned areas: ${repo.owns.length > 0 ? repo.owns.map((item) => `\`${item}\``).join(", ") : "none listed"}.`,
  "",
  "Contracts:",
  contractRows(contracts),
  "",
  "Acceptance checks:",
  repo.acceptanceCommands.length > 0
    ? repo.acceptanceCommands.map((command) => `- \`${command.cwd}\`: \`${command.command}\``).join("\n")
    : "- No acceptance commands listed.",
].join("\n"));

const renderLayer3Block = (repo, repoYaml) => {
  const codeMap = Array.isArray(repoYaml?.code_map) ? repoYaml.code_map : [];
  return generatedBlock("Layer 3 Generated View", [
    `- Repo contract: \`${repo.path}/repo.yaml\``,
    "",
    "Code map:",
    codeMap.length > 0
      ? codeMap.map((entry) => `- \`${entry.path}\`: ${entry.owns ?? "owned surface"}`).join("\n")
      : "- No code map entries listed.",
  ].join("\n"));
};

const renderOwnerMapBlock = (manifest, cliRoot) => {
  const repos = repoEntries(manifest, cliRoot).filter((repo) => repo.active);
  return generatedBlock("Generated Owner Map", [
    "| Repo | Owner | Owned areas | First source |",
    "| --- | --- | --- | --- |",
    ...repos.map((repo) => {
      const contracts = allContractEntries(manifest, cliRoot).filter((contract) => contract.repo === repo.name);
      const firstSource = contracts[0]?.path ?? "repo.yaml";
      return `| \`${repo.name}\` | \`${repo.owner}\` | ${repo.owns.map((item) => `\`${item}\``).join(", ")} | \`${firstSource}\` |`;
    }),
  ].join("\n"));
};

const renderValidationBlock = (manifest, cliRoot) => {
  const repos = repoEntries(manifest, cliRoot).filter((repo) => repo.active);
  return generatedBlock("Generated Validation Matrix", [
    "| Repo | Release group | Required | Commands |",
    "| --- | --- | --- | --- |",
    ...repos.map((repo) => {
      const commands = repo.acceptanceCommands.map((command) => `\`${command.cwd}: ${command.command}\``).join("<br>");
      return `| \`${repo.name}\` | \`${repo.releaseGroup}\` | \`${repo.requiredForPublicBeta}\` | ${commands || "none listed"} |`;
    }),
  ].join("\n"));
};

const renderSecretBlock = (manifest, cliRoot) => {
  const repos = repoEntries(manifest, cliRoot).filter((repo) => repo.active);
  return generatedBlock("Generated Secret Boundary", [
    "- Secret ownership is by class, not by convenience.",
    "- A repo may not add a new secret class until its `repo.yaml`, `.env.example` when safe, and source docs name the class.",
    "- `.env` files must not be read by agents.",
    "",
    `Repos under this policy: ${repos.map(repoDisplay).join(", ")}.`,
  ].join("\n"));
};

const renderContractArtifactsBlock = (manifest, cliRoot) => generatedBlock("Generated Contract Artifacts", [
  "| Pair | Source | Mirror |",
  "| --- | --- | --- |",
  ...sharedContractPairs(manifest, cliRoot).map((pair) =>
    `| \`${pair.id}\` | \`${relative(workspaceRootFromCliRoot(cliRoot), pair.source)}\` | \`${relative(workspaceRootFromCliRoot(cliRoot), pair.mirror)}\` |`,
  ),
].join("\n"));

const parseRepoYaml = (YAML, path) => existsSync(path) ? YAML.parse(readFileSync(path, "utf8")) : undefined;

export const renderMetaDocuments = ({ workspaceRoot, YAML }) => {
  const cliRoot = resolve(workspaceRoot, "regents-cli");
  const manifest = readWorkspaceManifest(cliRoot, YAML, defaultWorkspaceManifestPath(cliRoot));
  const repos = repoEntries(manifest, cliRoot).filter((repo) => repo.active);
  const documents = new Map();

  const addDocument = (path, block, fallbackTitle) => {
    const current = readText(path, `# ${fallbackTitle}\n`);
    documents.set(path, replaceGeneratedBlock(current, block));
  };

  addDocument(resolve(workspaceRoot, "AGENTS.md"), renderRootAgentsBlock(manifest, cliRoot), "Regent Workspace Agent Guide");
  addDocument(resolve(workspaceRoot, "docs/owner-map.md"), renderOwnerMapBlock(manifest, cliRoot), "Regent Owner Map");
  addDocument(resolve(workspaceRoot, "docs/validation-matrix.md"), renderValidationBlock(manifest, cliRoot), "Regent Validation Matrix");
  addDocument(resolve(workspaceRoot, "docs/secret-class-allowlist.md"), renderSecretBlock(manifest, cliRoot), "Secret Class Allowlist");
  addDocument(resolve(workspaceRoot, "docs/contract-artifacts.md"), renderContractArtifactsBlock(manifest, cliRoot), "Contract Artifacts");

  for (const repo of repos) {
    const repoYamlPath = resolve(repo.resolvedPath, "repo.yaml");
    const repoYaml = parseRepoYaml(YAML, repoYamlPath);
    const contracts = allContractEntries(manifest, cliRoot).filter((contract) => contract.repo === repo.name);
    addDocument(resolve(repo.resolvedPath, "AGENTS.md"), renderRepoAgentsBlock(repo), `${repo.name} Agent Guide`);
    addDocument(resolve(repo.resolvedPath, "layer2.md"), renderLayer2Block(repo, contracts), `${repo.name} Layer 2`);
    addDocument(resolve(repo.resolvedPath, "layer3.md"), renderLayer3Block(repo, repoYaml), `${repo.name} Layer 3`);
  }

  return documents;
};

export const checkMetaRender = ({ workspaceRoot, YAML }) => {
  const expected = renderMetaDocuments({ workspaceRoot, YAML });
  const failures = [];
  for (const [path, expectedText] of expected.entries()) {
    const actual = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (actual !== expectedText) {
      failures.push(`generated meta view is out of date: ${path}`);
    }
  }
  return { ok: failures.length === 0, failures, expected };
};

const main = async () => {
  const root = resolve(import.meta.dirname, "..");
  const workspaceRoot = resolve(root, "..");
  const YAML = await loadYaml(root);
  const checkOnly = process.argv.includes("--check");
  const result = checkMetaRender({ workspaceRoot, YAML });

  if (checkOnly) {
    if (!result.ok) {
      console.error(result.failures.join("\n"));
      process.exitCode = 1;
    } else {
      console.log("meta render check passed");
    }
    return;
  }

  for (const [path, text] of result.expected.entries()) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  console.log("meta render completed");
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
