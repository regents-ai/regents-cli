import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const techtreeRoot = path.resolve(runtimeDir, "../../../../..");

export type TechtreeCoreEntrypoint =
  | "artifact.init"
  | "artifact.compile"
  | "artifact.exec"
  | "artifact.verify"
  | "run.init"
  | "run.exec"
  | "run.compile"
  | "run.verify"
  | "review.init"
  | "review.compile"
  | "review.exec"
  | "review.verify"
  | "verify";

export interface TechtreeCoreInvocationOptions {
  cwd?: string;
}

export interface TechtreeCoreProcessResult {
  stdout: string;
  stderr: string;
}

type JsonRecord = Record<string, unknown>;

export const resolveTechtreeCoreDir = async (): Promise<string> => {
  const envOverride = process.env.REGENT_TECHTREE_CORE_DIR;
  if (envOverride) {
    return path.resolve(envOverride);
  }

  return path.join(techtreeRoot, "core");
};

const runProcess = async (
  command: string,
  args: string[],
  input: string | undefined,
  options: TechtreeCoreInvocationOptions = {},
): Promise<TechtreeCoreProcessResult> => {
  return await new Promise<TechtreeCoreProcessResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: process.env,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `techtree core command failed with exit code ${code ?? -1}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
        ),
      );
    });

    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
};

const parseJson = <T>(stdout: string, entrypoint: TechtreeCoreEntrypoint): T => {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`techtree core entrypoint ${entrypoint} returned no JSON output`);
  }

  return JSON.parse(trimmed) as T;
};

const sha256Prefixed = (content: string): `sha256:${string}` => {
  const digest = crypto.createHash("sha256").update(content, "utf8").digest("hex");
  return `sha256:${digest}`;
};

const toNodeHeader = (header: JsonRecord): JsonRecord => ({
  id: header.id,
  subjectId: header.subject_id,
  auxId: header.aux_id,
  payloadHash: header.payload_hash,
  nodeType: header.node_type,
  schemaVersion: header.schema_version,
  flags: header.flags,
  author: header.author,
});

const toSnakeHeader = (header: JsonRecord): JsonRecord => ({
  id: header.id,
  subject_id: header.subjectId,
  aux_id: header.auxId,
  payload_hash: header.payloadHash,
  node_type: header.nodeType,
  schema_version: header.schemaVersion,
  flags: header.flags,
  author: header.author,
});

const sourceManifestName = (nodeType: "artifact" | "run" | "review"): string => `${nodeType}.source.yaml`;
const compiledManifestName = (nodeType: "artifact" | "run" | "review"): string => `${nodeType}.manifest.json`;

const resolveWorkspacePath = (input: unknown, options?: TechtreeCoreInvocationOptions): string => {
  const payload = (input ?? {}) as { workspace_path?: string | null };
  const explicit = payload.workspace_path;
  return path.resolve(options?.cwd ?? process.cwd(), explicit ?? ".");
};

const readJsonFile = async <T>(filePath: string): Promise<T> => {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as T;
};

const ensureFile = async (filePath: string, content: string): Promise<void> => {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, content, "utf8");
  }
};

const ensureDir = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

const buildCompilePayload = async (
  entrypoint: TechtreeCoreEntrypoint,
  workspacePath: string,
  input: unknown,
): Promise<JsonRecord> => {
  const nodeType = entrypoint.split(".")[0] as "artifact" | "run" | "review";
  const coreDir = await resolveTechtreeCoreDir();
  const { stdout } = await runProcess(
    "uv",
    ["run", "--directory", coreDir, "python", "-m", "techtree_core", "compile", workspacePath],
    undefined,
    { cwd: workspacePath },
  );
  const compiled = parseJson<JsonRecord>(stdout, entrypoint);
  const distPath = String(compiled.dist_dir ?? path.join(workspacePath, "dist"));
  const manifestPath = path.join(distPath, compiledManifestName(nodeType));
  const payloadIndexPath = path.join(distPath, "payload.index.json");
  const nodeHeaderPath = path.join(distPath, "node-header.json");
  const checksumsPath = path.join(distPath, "checksums.txt");

  const [manifestText, payloadIndexText, nodeHeaderText] = await Promise.all([
    fs.readFile(manifestPath, "utf8"),
    fs.readFile(payloadIndexPath, "utf8"),
    fs.readFile(nodeHeaderPath, "utf8"),
  ]);

  return {
    ok: true,
    entrypoint,
    input,
    workspace_path: workspacePath,
    dist_path: distPath,
    manifest_path: manifestPath,
    payload_index_path: payloadIndexPath,
    node_header_path: nodeHeaderPath,
    checksums_path: checksumsPath,
    node_id: compiled.node_id,
    manifest_hash: sha256Prefixed(manifestText),
    payload_hash: sha256Prefixed(payloadIndexText),
    manifest: JSON.parse(manifestText),
    payload_index: JSON.parse(payloadIndexText),
    node_header: toNodeHeader(JSON.parse(nodeHeaderText) as JsonRecord),
  };
};

const initArtifactWorkspace = async (workspacePath: string): Promise<JsonRecord> => {
  await ensureDir(path.join(workspacePath, "notebooks"));
  await ensureDir(path.join(workspacePath, "attestations"));
  await ensureFile(
    path.join(workspacePath, sourceManifestName("artifact")),
    `schema_version: techtree.artifact-source.v1

title: "New TechTree Artifact"
summary: "Describe the artifact."

parents: []

notebook:
  entrypoint: notebooks/main.py
  include:
    - notebooks/**/*.py
    - pyproject.toml
    - uv.lock
  exclude:
    - outputs/**
  marimo_version: "0.11.8"

env:
  lockfile_path: uv.lock
  image: null
  system:
    python: "3.11"
    platform: "linux/amd64"
  runtime_policy:
    network: none
    filesystem: workspace_write
    secrets: forbidden
    gpu: false
  external_resources: []

claims: []
sources: []
licenses:
  notebook: "MIT"
  data: "CC-BY-4.0"
  outputs: "CC-BY-4.0"

eval: null
`,
  );
  await ensureFile(path.join(workspacePath, "notebooks", "main.py"), "print('TechTree artifact notebook')\n");
  await ensureFile(path.join(workspacePath, "pyproject.toml"), "[project]\nname = \"techtree-artifact\"\nversion = \"0.1.0\"\n");
  await ensureFile(path.join(workspacePath, "uv.lock"), "# generated by techtree init\n");
  return { ok: true, entrypoint: "artifact.init", input: { workspace_path: workspacePath }, workspace_path: workspacePath };
};

const initRunWorkspace = async (workspacePath: string, input: JsonRecord): Promise<JsonRecord> => {
  await ensureDir(path.join(workspacePath, "outputs"));
  await ensureFile(
    path.join(workspacePath, sourceManifestName("run")),
    `schema_version: techtree.run-source.v1

artifact_id: "${String(input.artifact_id ?? "")}"

executor:
  type: genome
  id: "genome:local-dev"
  version_ref: null

instance:
  seed: 1
  instance_id: null
  params: {}

execution:
  output_dir: outputs/
  allow_resume: false
`,
  );
  return { ok: true, entrypoint: "run.init", input, workspace_path: workspacePath };
};

const initReviewWorkspace = async (workspacePath: string, input: JsonRecord): Promise<JsonRecord> => {
  await ensureDir(path.join(workspacePath, "evidence"));
  await ensureFile(
    path.join(workspacePath, sourceManifestName("review")),
    `schema_version: techtree.review-source.v1

target:
  type: run
  id: "${String(input.target_id ?? "")}"

kind: validation
method: manual

scope:
  level: whole
  path: null

result: confirmed
summary: "Validation summary."

findings: []

evidence:
  refs: []
  attachments:
    include:
      - evidence/**/*
    exclude: []
`,
  );
  await ensureFile(path.join(workspacePath, "evidence", "notes.md"), "# Evidence\n");
  return { ok: true, entrypoint: "review.init", input, workspace_path: workspacePath };
};

const runExecWorkspace = async (workspacePath: string): Promise<JsonRecord> => {
  const outputDir = path.join(workspacePath, "outputs");
  await ensureDir(outputDir);
  await ensureFile(
    path.join(outputDir, "verdict.json"),
    JSON.stringify({ decision: "completed", justification: "Local execution placeholder", metrics: { score: null, values: {} } }, null, 2) + "\n",
  );
  await ensureFile(path.join(outputDir, "run.log"), "techtree run exec placeholder\n");
  return { ok: true, entrypoint: "run.exec", input: { workspace_path: workspacePath }, workspace_path: workspacePath, output_dir: outputDir };
};

const verifyCompiledPayload = async (
  entrypoint: TechtreeCoreEntrypoint,
  payload: JsonRecord,
): Promise<JsonRecord> => {
  const coreDir = await resolveTechtreeCoreDir();
  const script = `
import json
import sys

from techtree_core.canonical import bytes32_hex_from_digest, domain_hash, sha256_prefixed
from techtree_core.compiler import _artifact_header, _review_header, _run_header
from techtree_core.models import ArtifactManifestV1, NodeHeaderV1, PayloadIndexV1, ReviewManifestV1, RunManifestV1

MODELS = {
    "artifact": (ArtifactManifestV1, "TECHTREE-ARTIFACT-V1", _artifact_header),
    "run": (RunManifestV1, "TECHTREE-RUN-V1", _run_header),
    "review": (ReviewManifestV1, "TECHTREE-REVIEW-V1", _review_header),
}

payload = json.load(sys.stdin)
node_type = payload["node_type"]
manifest_cls, domain, header_fn = MODELS[node_type]
manifest = manifest_cls.model_validate(payload["manifest"])
payload_index = PayloadIndexV1.model_validate(payload["payload_index"])
header = NodeHeaderV1.model_validate(payload["header"])

payload_json = payload_index.model_dump(exclude_none=True, mode="json")
payload_hash = sha256_prefixed("TECHTREE-PAYLOAD-V1", payload_json)
manifest_json = manifest.model_dump(exclude_none=True, mode="json")
node_id = bytes32_hex_from_digest(domain_hash(domain, manifest_json))
expected_header = header_fn(manifest, node_id, payload_hash, header.author)

print(json.dumps({
  "ok": True,
  "verified": node_id == header.id and payload_hash == manifest.payload_hash and expected_header.model_dump(exclude_none=True, mode="json") == header.model_dump(exclude_none=True, mode="json"),
  "node_id": node_id,
  "payload_hash": payload_hash,
  "header_matches": expected_header.model_dump(exclude_none=True, mode="json") == header.model_dump(exclude_none=True, mode="json")
}, indent=2, sort_keys=True))
`;
  const { stdout } = await runProcess(
    "uv",
    ["run", "--directory", coreDir, "python", "-c", script],
    `${JSON.stringify(payload)}\n`,
    {},
  );
  return parseJson<JsonRecord>(stdout, entrypoint);
};

const verifyWorkspaceOrFetched = async (input: JsonRecord): Promise<JsonRecord> => {
  const workspacePath = typeof input.workspace_path === "string" ? input.workspace_path : null;
  if (workspacePath) {
    const sourceFiles = [
      path.join(workspacePath, "artifact.source.yaml"),
      path.join(workspacePath, "run.source.yaml"),
      path.join(workspacePath, "review.source.yaml"),
    ];
    const hasSource = await Promise.all(sourceFiles.map(async (filePath) => {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    }));

    if (hasSource.some(Boolean)) {
      const coreDir = await resolveTechtreeCoreDir();
      const { stdout } = await runProcess(
        "uv",
        ["run", "--directory", coreDir, "python", "-m", "techtree_core", "verify", workspacePath],
        undefined,
        { cwd: workspacePath },
      );
      const result = parseJson<JsonRecord>(stdout, "verify");
      return {
        ok: true,
        node_id: result.node_id,
        verified: Boolean(result.ok),
        manifest_hash: null,
        payload_hash: null,
        header_matches: result.header_match,
        details: result,
      };
    }
  }

  const fetched = (input.fetched ?? null) as JsonRecord | null;
  if (!fetched || typeof fetched !== "object") {
    throw new Error("verify requires a workspace with source manifests or a fetched node payload");
  }

  const nodeType = String(fetched.node_type ?? "");
  const manifest = fetched.manifest as JsonRecord | undefined;
  const payloadIndex = fetched.payload_index as JsonRecord | undefined;
  const nodeHeader = fetched.node_header as JsonRecord | undefined;

  if (!manifest || !payloadIndex || !nodeHeader || !nodeType) {
    throw new Error("fetched node payload is missing manifest, payload index, or header");
  }

  const result = await verifyCompiledPayload("verify", {
    node_type: nodeType,
    manifest,
    payload_index: payloadIndex,
    header: toSnakeHeader(nodeHeader),
  });

  return {
    ok: true,
    node_id: result.node_id,
    verified: result.verified,
    manifest_hash: null,
    payload_hash: result.payload_hash,
    header_matches: result.header_matches,
    details: result,
  };
};

export async function runTechtreeCoreJson<T>(
  entrypoint: TechtreeCoreEntrypoint,
  input?: unknown,
  options?: TechtreeCoreInvocationOptions,
): Promise<T> {
  const workspacePath = resolveWorkspacePath(input, options);

  switch (entrypoint) {
    case "artifact.init":
      return (await initArtifactWorkspace(workspacePath)) as T;
    case "run.init":
      return (await initRunWorkspace(workspacePath, (input ?? {}) as JsonRecord)) as T;
    case "review.init":
      return (await initReviewWorkspace(workspacePath, (input ?? {}) as JsonRecord)) as T;
    case "run.exec":
      return (await runExecWorkspace(workspacePath)) as T;
    case "artifact.compile":
    case "run.compile":
    case "review.compile":
      return (await buildCompilePayload(entrypoint, workspacePath, input)) as T;
    case "artifact.verify":
    case "run.verify":
    case "review.verify":
    case "verify":
      return (await verifyWorkspaceOrFetched((input ?? {}) as JsonRecord)) as T;
    case "artifact.exec":
    case "review.exec":
      return ({ ok: true, entrypoint, input, workspace_path: workspacePath } satisfies JsonRecord) as T;
    default:
      throw new Error(`unsupported techtree core entrypoint: ${entrypoint}`);
  }
}

export async function runTechtreeCoreRaw(
  entrypoint: TechtreeCoreEntrypoint,
  input?: unknown,
  options?: TechtreeCoreInvocationOptions,
): Promise<TechtreeCoreProcessResult> {
  const payload = await runTechtreeCoreJson<JsonRecord>(entrypoint, input, options);
  return {
    stdout: `${JSON.stringify(payload, null, 2)}\n`,
    stderr: "",
  };
}
