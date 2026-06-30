import fs from "node:fs";
import path from "node:path";

export const defaultWorkspaceManifestPath = (cliRoot) =>
  path.resolve(cliRoot, "../meta/stack.yaml");

export const workspaceRootFromCliRoot = (cliRoot) => path.resolve(cliRoot, "..");

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requireString = (value, field) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Regent workspace manifest has an invalid ${field}.`);
  }
  return value.trim();
};

const optionalBoolean = (value, fallback) =>
  typeof value === "boolean" ? value : fallback;

const asArray = (value) => Array.isArray(value) ? value : [];

export const readWorkspaceManifest = (cliRoot, YAML, manifestPath = defaultWorkspaceManifestPath(cliRoot)) => {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Regent stack contract is missing: ${manifestPath}. Add meta/stack.yaml, then run this again.`,
    );
  }

  const parsed = YAML.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error("Regent workspace manifest must be a YAML object.");
  }
  if (!isRecord(parsed.repos)) {
    throw new Error("Regent workspace manifest must define repos.");
  }

  return parsed;
};

export const repoEntries = (manifest, cliRoot) =>
  Object.entries(manifest.repos ?? {})
    .map(([name, repo]) => {
      if (!isRecord(repo)) {
        throw new Error(`Regent workspace manifest has an invalid repos.${name} entry.`);
      }

      const repoPath = requireString(repo.path, `repos.${name}.path`);
      return {
        name,
        owner: typeof repo.owner === "string" ? repo.owner : name,
        path: repoPath,
        resolvedPath: path.resolve(workspaceRootFromCliRoot(cliRoot), repoPath),
        active: optionalBoolean(repo.active, true),
        requiredForPublicBeta: optionalBoolean(repo.required_for_public_beta, false),
        releaseGroup: typeof repo.release_group === "string" ? repo.release_group : "public_beta",
        owns: asArray(repo.owns).filter((item) => typeof item === "string"),
        acceptanceCommands: asArray(repo.acceptance_commands).filter(isRecord),
        apiContracts: asArray(repo.api_contracts),
        cliContracts: asArray(repo.cli_contracts),
        sharedContracts: asArray(repo.shared_contracts),
        packagePaths: asArray(repo.package_paths).filter((item) => typeof item === "string"),
        localPathDependencies: asArray(repo.local_path_dependencies).filter((item) => typeof item === "string"),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

const repoByName = (manifest, cliRoot) => new Map(repoEntries(manifest, cliRoot).map((repo) => [repo.name, repo]));

const resolveRepoFile = (repos, repoName, relativePath, field) => {
  const repo = repos.get(repoName);
  if (!repo) {
    throw new Error(`Regent workspace manifest references unknown repo ${repoName} in ${field}.`);
  }
  return path.resolve(repo.resolvedPath, requireString(relativePath, field));
};

const bindingEntries = (contract) =>
  asArray(contract.generated_bindings).filter(isRecord).map((binding, index) => ({
    path: requireString(binding.path, `generated_bindings[${index}].path`),
    generator: typeof binding.generator === "string" ? binding.generator : "unknown",
  }));

const contractEntries = (manifest, cliRoot, kind) => {
  const repos = repoEntries(manifest, cliRoot);
  return repos.flatMap((repo) => {
    const list = kind === "api" ? repo.apiContracts : kind === "cli" ? repo.cliContracts : repo.sharedContracts;
    return list.filter(isRecord).map((contract, index) => {
      const contractPath = requireString(contract.path, `repos.${repo.name}.${kind}_contracts[${index}].path`);
      const contractOwner = typeof contract.owner === "string" ? contract.owner : repo.name;
      return {
        id: typeof contract.id === "string" ? contract.id : `${repo.name}_${kind}_${index}`,
        repo: repo.name,
        sourceRepo: repo.name,
        owner: contractOwner,
        kind,
        path: contractPath,
        resolvedPath: path.resolve(repo.resolvedPath, contractPath),
        includeInCliCommandCheck: optionalBoolean(contract.include_in_cli_command_check, false),
        generatedBindings: bindingEntries(contract).map((binding) => ({
          ...binding,
          resolvedPath: path.resolve(workspaceRootFromCliRoot(cliRoot), binding.path),
        })),
        releaseGroup: repo.releaseGroup,
        requiredForPublicBeta: repo.requiredForPublicBeta,
      };
    });
  });
};

export const allContractEntries = (manifest, cliRoot) => [
  ...contractEntries(manifest, cliRoot, "api"),
  ...contractEntries(manifest, cliRoot, "cli"),
  ...contractEntries(manifest, cliRoot, "shared"),
].sort((left, right) => `${left.owner}:${left.kind}:${left.id}`.localeCompare(`${right.owner}:${right.kind}:${right.id}`));

export const cliCommandOpenApiFiles = (manifest, cliRoot) =>
  cliCommandCheckFiles(manifest, cliRoot, "api");

export const cliCommandContractFiles = (manifest, cliRoot) =>
  cliCommandCheckFiles(manifest, cliRoot, "cli");

const cliCommandCheckFiles = (manifest, cliRoot, kind) => {
  const files = {};

  for (const contract of contractEntries(manifest, cliRoot, kind).filter((entry) => entry.includeInCliCommandCheck)) {
    if (Object.prototype.hasOwnProperty.call(files, contract.owner)) {
      throw new Error(
        `Regent workspace manifest has multiple ${kind} contracts marked for CLI command checks for owner ${contract.owner}.`,
      );
    }

    files[contract.owner] = contract.resolvedPath;
  }

  return files;
};

export const openApiGenerationTargets = (manifest, cliRoot) =>
  contractEntries(manifest, cliRoot, "api").flatMap((contract) =>
    contract.generatedBindings
      .filter((binding) => binding.generator === "openapi-typescript")
      .map((binding) => ({
        label: contract.id
          .split("_")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" "),
        input: contract.resolvedPath,
        output: binding.resolvedPath,
      })),
  );

export const sharedContractPairs = (manifest, cliRoot) => {
  const repos = repoByName(manifest, cliRoot);
  return asArray(manifest.shared_contract_pairs).filter(isRecord).map((pair, index) => {
    const source = pair.source;
    const mirror = pair.mirror;
    if (!isRecord(source) || !isRecord(mirror)) {
      throw new Error(`Regent workspace manifest has an invalid shared_contract_pairs[${index}] entry.`);
    }
    return {
      id: typeof pair.id === "string" ? pair.id : `shared_contract_pair_${index}`,
      source: resolveRepoFile(repos, requireString(source.repo, `shared_contract_pairs[${index}].source.repo`), source.path, `shared_contract_pairs[${index}].source.path`),
      mirror: resolveRepoFile(repos, requireString(mirror.repo, `shared_contract_pairs[${index}].mirror.repo`), mirror.path, `shared_contract_pairs[${index}].mirror.path`),
    };
  });
};

export const walletActionSchemaPath = (manifest, cliRoot) => {
  const schemas = manifest.schemas;
  if (!isRecord(schemas) || !isRecord(schemas.wallet_action)) {
    throw new Error("Regent workspace manifest must define schemas.wallet_action.");
  }
  return path.resolve(workspaceRootFromCliRoot(cliRoot), requireString(schemas.wallet_action.path, "schemas.wallet_action.path"));
};

export const schemaEntries = (manifest, cliRoot) => {
  const schemas = manifest.schemas;
  if (!isRecord(schemas)) {
    throw new Error("Regent stack contract must define schemas.");
  }

  return Object.entries(schemas)
    .filter(([, schema]) => isRecord(schema) && typeof schema.path === "string")
    .map(([id, schema]) => ({
      id,
      path: schema.path,
      resolvedPath: path.resolve(workspaceRootFromCliRoot(cliRoot), schema.path),
      version: typeof schema.version === "number" ? schema.version : undefined,
    }));
};

export const repoManifestEntries = (manifest, cliRoot) =>
  repoEntries(manifest, cliRoot)
    .filter((repo) => repo.active)
    .map((repo) => ({
      repo: repo.name,
      path: "repo.yaml",
      resolvedPath: path.resolve(repo.resolvedPath, "repo.yaml"),
    }));

export const runtimeContractEntries = (manifest, cliRoot) =>
  asArray(manifest.runtime_contracts).filter(isRecord).map((entry, index) => ({
    id: typeof entry.id === "string" ? entry.id : `runtime_contract_${index}`,
    owner: requireString(entry.owner, `runtime_contracts[${index}].owner`),
    path: requireString(entry.path, `runtime_contracts[${index}].path`),
    resolvedPath: path.resolve(workspaceRootFromCliRoot(cliRoot), entry.path),
    registry: requireString(entry.registry, `runtime_contracts[${index}].registry`),
    resolvedRegistry: path.resolve(workspaceRootFromCliRoot(cliRoot), entry.registry),
    generatedMarkdown: requireString(entry.generated_markdown, `runtime_contracts[${index}].generated_markdown`),
    resolvedGeneratedMarkdown: path.resolve(workspaceRootFromCliRoot(cliRoot), entry.generated_markdown),
  }));

export const chainContractManifestEntries = (manifest, cliRoot) =>
  asArray(manifest.chain_contract_manifests).filter(isRecord).map((entry, index) => ({
    id: typeof entry.id === "string" ? entry.id : `chain_contract_manifest_${index}`,
    owner: requireString(entry.owner, `chain_contract_manifests[${index}].owner`),
    path: requireString(entry.path, `chain_contract_manifests[${index}].path`),
    resolvedPath: path.resolve(workspaceRootFromCliRoot(cliRoot), entry.path),
  }));

export const generatedViewEntries = (manifest, cliRoot) =>
  asArray(manifest.generated_views).filter(isRecord).map((entry, index) => ({
    id: typeof entry.id === "string" ? entry.id : `generated_view_${index}`,
    path: requireString(entry.path, `generated_views[${index}].path`),
    resolvedPath: entry.path.includes("<repo>")
      ? undefined
      : path.resolve(workspaceRootFromCliRoot(cliRoot), entry.path),
    renderer: typeof entry.renderer === "string" ? entry.renderer : "regents meta render",
  }));

export const ticketTemplateEntries = (manifest, cliRoot) =>
  asArray(manifest.ticket_templates).filter(isRecord).map((entry, index) => ({
    id: typeof entry.id === "string" ? entry.id : `ticket_template_${index}`,
    path: requireString(entry.path, `ticket_templates[${index}].path`),
    resolvedPath: path.resolve(workspaceRootFromCliRoot(cliRoot), entry.path),
  }));

export const moneyMovementRows = (manifest) =>
  asArray(manifest.money_movement).filter(isRecord).map((row, index) => ({
    id: requireString(row.id, `money_movement[${index}].id`),
    ownerProduct: requireString(row.owner_product, `money_movement[${index}].owner_product`),
    routeClass: requireString(row.route_class, `money_movement[${index}].route_class`),
    signer: requireString(row.signer, `money_movement[${index}].signer`),
    beneficiary: requireString(row.beneficiary, `money_movement[${index}].beneficiary`),
    sourceOfTruth: requireString(row.source_of_truth, `money_movement[${index}].source_of_truth`),
    confirmationRule: requireString(row.confirmation_rule, `money_movement[${index}].confirmation_rule`),
  }));

export const incidentClasses = (manifest) =>
  asArray(manifest.incident_classes).filter(isRecord).map((entry, index) => ({
    id: requireString(entry.id, `incident_classes[${index}].id`),
    ownerRepo: requireString(entry.owner_repo, `incident_classes[${index}].owner_repo`),
    recoveryCommand: requireString(entry.recovery_command, `incident_classes[${index}].recovery_command`),
    requiresReconciliationJob: optionalBoolean(entry.requires_reconciliation_job, false),
  }));

export const knownReleaseGaps = (manifest) =>
  asArray(manifest.known_release_gaps).filter(isRecord).map((entry, index) => ({
    id: requireString(entry.id, `known_release_gaps[${index}].id`),
    status: requireString(entry.status, `known_release_gaps[${index}].status`),
    ownerRepo: requireString(entry.owner_repo, `known_release_gaps[${index}].owner_repo`),
    requiredForPublicBeta: optionalBoolean(entry.required_for_public_beta, false),
    affectedRepos: asArray(entry.affected_repos).map((repo, repoIndex) =>
      requireString(repo, `known_release_gaps[${index}].affected_repos[${repoIndex}]`),
    ),
    title: requireString(entry.title, `known_release_gaps[${index}].title`),
    acceptance: asArray(entry.acceptance).map((item, itemIndex) =>
      requireString(item, `known_release_gaps[${index}].acceptance[${itemIndex}]`),
    ),
  }));

export const requiredWorkspaceFiles = (manifest, cliRoot) => {
  const repos = repoEntries(manifest, cliRoot);
  const repoRows = repos
    .filter((repo) => repo.requiredForPublicBeta)
    .map((repo) => ({ label: `${repo.name} repo`, path: repo.resolvedPath, kind: "dir" }));

  const contractRows = allContractEntries(manifest, cliRoot)
    .filter((contract) => contract.requiredForPublicBeta)
    .map((contract) => ({ label: `${contract.id} contract`, path: contract.resolvedPath, kind: "file" }));

  const localDependencyRows = repos
    .filter((repo) => repo.requiredForPublicBeta)
    .flatMap((repo) => repo.localPathDependencies.map((dependency) => ({
      label: `${repo.name} local dependency ${dependency}`,
      path: path.resolve(repo.resolvedPath, dependency),
      kind: "dir",
    })));

  const generatedRows = allContractEntries(manifest, cliRoot)
    .filter((contract) => contract.requiredForPublicBeta)
    .flatMap((contract) => contract.generatedBindings.map((binding) => ({
      label: `${contract.id} generated binding`,
      path: binding.resolvedPath,
      kind: "file",
    })));

  return [...repoRows, ...localDependencyRows, ...contractRows, ...generatedRows, {
    label: "WalletAction schema",
    path: walletActionSchemaPath(manifest, cliRoot),
    kind: "file",
  }, ...schemaEntries(manifest, cliRoot).map((schema) => ({
    label: `${schema.id} schema`,
    path: schema.resolvedPath,
    kind: "file",
  })), ...repoManifestEntries(manifest, cliRoot).map((repoManifest) => ({
    label: `${repoManifest.repo} repo.yaml`,
    path: repoManifest.resolvedPath,
    kind: "file",
  })), ...runtimeContractEntries(manifest, cliRoot).flatMap((runtime) => [
    { label: `${runtime.id} runtime contract`, path: runtime.resolvedPath, kind: "file" },
    { label: `${runtime.id} runtime registry`, path: runtime.resolvedRegistry, kind: "file" },
    { label: `${runtime.id} generated markdown`, path: runtime.resolvedGeneratedMarkdown, kind: "file" },
  ]), ...chainContractManifestEntries(manifest, cliRoot).map((chain) => ({
    label: `${chain.id} chain contract manifest`,
    path: chain.resolvedPath,
    kind: "file",
  })), ...ticketTemplateEntries(manifest, cliRoot).map((template) => ({
    label: `${template.id} ticket template`,
    path: template.resolvedPath,
    kind: "file",
  }))];
};
