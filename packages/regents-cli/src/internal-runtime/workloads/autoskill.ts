import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
};

const shortHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 16);

const sha256Hex = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");

const ensureDir = async (targetPath: string): Promise<void> => {
  await fs.mkdir(targetPath, { recursive: true });
};

const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const readOptionalText = async (targetPath: string): Promise<string | null> => {
  if (!(await fileExists(targetPath))) {
    return null;
  }

  return fs.readFile(targetPath, "utf8");
};

const readOptionalJson = async (targetPath: string): Promise<Record<string, unknown>> => {
  if (!(await fileExists(targetPath))) {
    return {};
  }

  return JSON.parse(await fs.readFile(targetPath, "utf8")) as Record<string, unknown>;
};

const DEFAULT_SKILL_MANIFEST = `type: skill
access_mode: public_free
marimo_entrypoint: session.marimo.py
metadata:
  version: 0.1.0
`;

const DEFAULT_EVAL_MANIFEST = `type: eval
access_mode: public_free
marimo_entrypoint: session.marimo.py
metadata:
  version: 0.1.0
`;

const DEFAULT_SKILL_MARIMO = `import marimo as mo
app = mo.App()

@app.cell
def _():
    # Interactive "try this skill" surface for this bundle.
    return

if __name__ == "__main__":
    app.run()
`;

const DEFAULT_EVAL_MARIMO = `import marimo as mo
app = mo.App()

@app.cell
def _():
    # Interactive eval dashboard and grader inspection surface.
    return

if __name__ == "__main__":
    app.run()
`;

const DEFAULT_MARIMO_PYPROJECT = `[tool.marimo.runtime]
watcher_on_save = "autorun"
`;

const DEFAULT_RESULT = {
  runtime_kind: "local",
  status: "complete",
  trial_count: 1,
  raw_score: 0,
  normalized_score: 0,
  grader_breakdown: {},
};

const AUTOSKILL_BUNDLE_SCHEMA_VERSION = "techtree.autoskill.bundle.v1";
const MANIFEST_FILENAME = "bundle.manifest.json";
const MAX_BUNDLE_FILE_COUNT = 512;
const MAX_BUNDLE_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_BUNDLE_TOTAL_SIZE_BYTES = 25 * 1024 * 1024;

const parseManifestText = (source: string): Record<string, unknown> => {
  const lines = source.split(/\r?\n/);
  const root: Record<string, unknown> = {};
  let currentSection: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = line.length - line.trimStart().length;
    const [rawKey, ...rawValueParts] = trimmed.split(":");
    const key = rawKey?.trim();
    const valueText = rawValueParts.join(":").trim();

    if (!key) {
      continue;
    }

    if (indent === 0) {
      if (valueText === "") {
        currentSection = key;
        root[key] = {};
      } else {
        currentSection = null;
        root[key] = valueText;
      }

      continue;
    }

    if (currentSection) {
      const section = root[currentSection];
      if (section && typeof section === "object" && !Array.isArray(section)) {
        (section as Record<string, unknown>)[key] = valueText;
      }
    }
  }

  return root;
};

const listWorkspaceFiles = async (workspacePath: string): Promise<string[]> => {
  const entries: string[] = [];

  const walk = async (relativePath: string): Promise<void> => {
    const absolutePath = path.join(workspacePath, relativePath);
    const stat = await fs.stat(absolutePath);

    if (stat.isDirectory()) {
      const name = path.basename(absolutePath);
      if ([".git", "node_modules", "dist"].includes(name)) {
        return;
      }

      const children = await fs.readdir(absolutePath);
      for (const child of children.sort()) {
        await walk(path.join(relativePath, child));
      }
      return;
    }

    entries.push(relativePath.split(path.sep).join("/"));
  };

  await walk(".");

  return entries
    .filter((entry) => entry !== ".")
    .map((entry) => entry.replace(/^\.\//, ""))
    .sort();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const canonicalBundlePath = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("autoskill bundle file path is invalid");
  }

  if (
    value.includes("\0") ||
    value.includes("\\") ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    value.startsWith("//") ||
    value === MANIFEST_FILENAME
  ) {
    throw new Error(`unsafe autoskill bundle path: ${value}`);
  }

  const normalized = path.posix.normalize(value);
  const parts = normalized.split("/");

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`unsafe autoskill bundle path: ${value}`);
  }

  return normalized;
};

const decodeBase64 = (value: unknown, relativePath: string): Buffer => {
  if (typeof value !== "string" || value.trim() === "" || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`autoskill bundle file content is invalid: ${relativePath}`);
  }

  return Buffer.from(value, "base64");
};

const requireManifestFiles = (manifest: Record<string, unknown>): Map<string, { sha256: string; size: number }> => {
  if (!Array.isArray(manifest.files)) {
    throw new Error("autoskill bundle manifest is missing files");
  }

  if (manifest.files.length > MAX_BUNDLE_FILE_COUNT) {
    throw new Error("autoskill bundle has too many files");
  }

  const files = new Map<string, { sha256: string; size: number }>();
  const seen = new Set<string>();

  for (const entry of manifest.files) {
    if (!isRecord(entry)) {
      throw new Error("autoskill bundle manifest file entry is invalid");
    }

    const relativePath = canonicalBundlePath(entry.path);
    const duplicateKey = relativePath.toLowerCase();
    if (seen.has(duplicateKey)) {
      throw new Error(`duplicate autoskill bundle path: ${relativePath}`);
    }

    if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
      throw new Error(`autoskill bundle manifest hash is invalid: ${relativePath}`);
    }

    const size = entry.size;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      throw new Error(`autoskill bundle manifest size is invalid: ${relativePath}`);
    }
    if (size > MAX_BUNDLE_FILE_SIZE_BYTES) {
      throw new Error(`autoskill bundle file is too large: ${relativePath}`);
    }

    seen.add(duplicateKey);
    files.set(relativePath, { sha256: entry.sha256.toLowerCase(), size });
  }

  return files;
};

const compareManifest = (actual: Record<string, unknown>, expected: Record<string, unknown> | undefined): void => {
  if (expected && stableStringify(actual) !== stableStringify(expected)) {
    throw new Error("autoskill bundle does not match the published manifest");
  }
};

const verifyBundleHash = (
  parsed: Record<string, unknown>,
  manifest: Record<string, unknown>,
): void => {
  const expectedHash = manifest.bundle_hash;
  if (expectedHash === undefined || expectedHash === null) {
    throw new Error("autoskill bundle manifest is missing bundle_hash");
  }

  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
    throw new Error("autoskill bundle manifest bundle_hash is invalid");
  }

  const hashManifest = { ...manifest };
  delete hashManifest.bundle_hash;
  const computed = sha256Hex(stableStringify({ ...parsed, manifest: hashManifest }));

  if (computed !== expectedHash.toLowerCase()) {
    throw new Error("autoskill bundle hash does not match the manifest");
  }
};

const readBundleFiles = (
  bundleText: string,
  expectedManifest?: Record<string, unknown>,
): { manifest: Record<string, unknown>; files: Array<{ path: string; bytes: Buffer }> } => {
  const parsed = JSON.parse(bundleText) as unknown;
  if (!isRecord(parsed) || parsed.schema_version !== AUTOSKILL_BUNDLE_SCHEMA_VERSION || !isRecord(parsed.manifest)) {
    throw new Error("invalid autoskill bundle payload");
  }

  const manifest = parsed.manifest;
  compareManifest(manifest, expectedManifest);
  const manifestFiles = requireManifestFiles(manifest);

  if (!Array.isArray(parsed.files)) {
    throw new Error("invalid autoskill bundle payload");
  }

  const totalSize = manifest.total_size;
  if (typeof totalSize !== "number" || !Number.isSafeInteger(totalSize) || totalSize < 0) {
    throw new Error("autoskill bundle manifest total_size is invalid");
  }
  if (totalSize > MAX_BUNDLE_TOTAL_SIZE_BYTES) {
    throw new Error("autoskill bundle total_size is too large");
  }

  const seen = new Set<string>();
  const files: Array<{ path: string; bytes: Buffer }> = [];
  let observedTotalSize = 0;

  for (const file of parsed.files) {
    if (!isRecord(file)) {
      throw new Error("autoskill bundle file entry is invalid");
    }

    const relativePath = canonicalBundlePath(file.path);
    const duplicateKey = relativePath.toLowerCase();
    if (seen.has(duplicateKey)) {
      throw new Error(`duplicate autoskill bundle path: ${relativePath}`);
    }

    const manifestEntry = manifestFiles.get(relativePath);
    if (!manifestEntry) {
      throw new Error(`autoskill bundle file is missing from manifest: ${relativePath}`);
    }

    const bytes = decodeBase64(file.content_b64, relativePath);
    const actualSize = bytes.byteLength;
    const actualHash = sha256Hex(bytes);

    if (actualSize !== manifestEntry.size || actualHash !== manifestEntry.sha256) {
      throw new Error(`autoskill bundle file failed verification: ${relativePath}`);
    }

    seen.add(duplicateKey);
    observedTotalSize += actualSize;
    files.push({ path: relativePath, bytes });
  }

  if (files.length !== manifestFiles.size) {
    throw new Error("autoskill bundle files do not match the manifest");
  }

  if (observedTotalSize !== totalSize) {
    throw new Error("autoskill bundle total_size does not match the files");
  }

  verifyBundleHash(parsed, manifest);

  return { manifest, files };
};

const ensureNotSymlink = async (targetPath: string, label: string): Promise<void> => {
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`autoskill bundle ${label} must not be a symlink`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }

    throw error;
  }
};

const materializeDirectory = async (
  workspacePath: string,
  files: Array<{ path: string; bytes: Buffer }>,
  manifest: Record<string, unknown>,
): Promise<string[]> => {
  const resolved = path.resolve(workspacePath);
  const parent = path.dirname(resolved);
  const base = path.basename(resolved);
  await ensureDir(parent);
  await ensureNotSymlink(parent, "parent directory");
  await ensureNotSymlink(resolved, "target directory");

  const temporaryPath = path.join(parent, `.${base}.tmp-${randomUUID()}`);
  const backupPath = path.join(parent, `.${base}.backup-${randomUUID()}`);
  const written: string[] = [];
  let movedExisting = false;

  await ensureDir(temporaryPath);

  try {
    for (const file of files) {
      const targetPath = path.join(temporaryPath, file.path);
      await ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, file.bytes);
      written.push(file.path);
    }

    await fs.writeFile(path.join(temporaryPath, MANIFEST_FILENAME), jsonText(manifest), "utf8");
    written.push(MANIFEST_FILENAME);

    if (await fileExists(resolved)) {
      await fs.rename(resolved, backupPath);
      movedExisting = true;
    }

    await fs.rename(temporaryPath, resolved);

    if (movedExisting) {
      await fs.rm(backupPath, { recursive: true, force: true });
    }

    return written.sort();
  } catch (error) {
    await fs.rm(temporaryPath, { recursive: true, force: true });

    if (movedExisting && !(await fileExists(resolved)) && (await fileExists(backupPath))) {
      await fs.rename(backupPath, resolved);
    }

    throw error;
  }
};

export interface AutoskillBundleBuildResult {
  archiveBase64: string;
  archiveHash: string;
  manifest: Record<string, unknown>;
  marimoEntrypoint: string;
  primaryFile: string | null;
  previewMd: string | null;
}

export const initAutoskillSkillWorkspace = async (workspacePath: string): Promise<string[]> => {
  const resolved = path.resolve(workspacePath);
  await ensureDir(resolved);
  await ensureDir(path.join(resolved, "prompts"));
  await ensureDir(path.join(resolved, "examples"));
  await fs.writeFile(path.join(resolved, "manifest.yaml"), DEFAULT_SKILL_MANIFEST, "utf8");
  await fs.writeFile(path.join(resolved, "session.marimo.py"), DEFAULT_SKILL_MARIMO, "utf8");
  await fs.writeFile(path.join(resolved, "pyproject.toml"), DEFAULT_MARIMO_PYPROJECT, "utf8");
  await fs.writeFile(path.join(resolved, "SKILL.md"), "# Skill\n\nDescribe the skill preview here.\n", "utf8");

  return ["manifest.yaml", "session.marimo.py", "pyproject.toml", "SKILL.md", "prompts/", "examples/"];
};

export const initAutoskillEvalWorkspace = async (workspacePath: string): Promise<string[]> => {
  const resolved = path.resolve(workspacePath);
  await ensureDir(resolved);
  await ensureDir(path.join(resolved, "tasks"));
  await ensureDir(path.join(resolved, "graders"));
  await ensureDir(path.join(resolved, "fixtures"));
  await fs.writeFile(path.join(resolved, "scenario.yaml"), DEFAULT_EVAL_MANIFEST, "utf8");
  await fs.writeFile(path.join(resolved, "session.marimo.py"), DEFAULT_EVAL_MARIMO, "utf8");
  await fs.writeFile(path.join(resolved, "pyproject.toml"), DEFAULT_MARIMO_PYPROJECT, "utf8");
  await fs.writeFile(path.join(resolved, "README.md"), "# Eval\n\nDescribe the eval scenario preview here.\n", "utf8");

  return ["scenario.yaml", "session.marimo.py", "pyproject.toml", "README.md", "tasks/", "graders/", "fixtures/"];
};

export const buildAutoskillBundlePayload = async (
  workspacePath: string,
  kind: "skill" | "eval",
  overrides?: {
    accessMode?: "public_free" | "gated_paid";
    marimoEntrypoint?: string;
    primaryFile?: string | null;
    version?: string;
    previewMd?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<AutoskillBundleBuildResult> => {
  const resolved = path.resolve(workspacePath);
  const manifestPath = path.join(resolved, kind === "skill" ? "manifest.yaml" : "scenario.yaml");
  const manifestText = (await readOptionalText(manifestPath)) ?? "";
  const parsedManifest = parseManifestText(manifestText);
  const metadataFromFile =
    parsedManifest.metadata && typeof parsedManifest.metadata === "object" && !Array.isArray(parsedManifest.metadata)
      ? (parsedManifest.metadata as Record<string, unknown>)
      : {};
  const marimoEntrypoint =
    overrides?.marimoEntrypoint ??
    (typeof parsedManifest.marimo_entrypoint === "string" ? parsedManifest.marimo_entrypoint : "session.marimo.py");

  if (!(await fileExists(path.join(resolved, marimoEntrypoint)))) {
    throw new Error(`missing required marimo entrypoint: ${marimoEntrypoint}`);
  }

  const primaryFile =
    overrides?.primaryFile === undefined
      ? kind === "skill"
        ? "SKILL.md"
        : "scenario.yaml"
      : overrides.primaryFile;

  const previewMd =
    overrides?.previewMd ??
    (kind === "skill"
      ? await readOptionalText(path.join(resolved, "SKILL.md"))
      : (await readOptionalText(path.join(resolved, "README.md"))) ?? manifestText);

  const files = await listWorkspaceFiles(resolved);
  const encodedFiles = await Promise.all(
    files.map(async (relativePath) => {
      const bytes = await fs.readFile(path.join(resolved, relativePath));
      return {
        path: relativePath,
        sha256: sha256Hex(bytes),
        size: bytes.byteLength,
        content_b64: bytes.toString("base64"),
      };
    }),
  );

  const fileManifest = encodedFiles.map((entry) => ({
    path: entry.path,
    sha256: entry.sha256,
    size: entry.size,
  }));
  const baseManifest = {
    type: kind,
    access_mode:
      overrides?.accessMode ??
      ((typeof parsedManifest.access_mode === "string" ? parsedManifest.access_mode : "public_free") as
        | "public_free"
        | "gated_paid"),
    marimo_entrypoint: marimoEntrypoint,
    primary_file: primaryFile,
    metadata: {
      ...metadataFromFile,
      ...(overrides?.metadata ?? {}),
      ...(kind === "eval"
        ? { version: overrides?.version ?? String(metadataFromFile.version ?? "0.1.0") }
        : {}),
    },
    total_size: encodedFiles.reduce((total, entry) => total + entry.size, 0),
    files: fileManifest,
  };

  const bundleHash = sha256Hex(
    stableStringify({
      schema_version: AUTOSKILL_BUNDLE_SCHEMA_VERSION,
      manifest: baseManifest,
      files: encodedFiles,
    }),
  );
  const manifest = {
    ...baseManifest,
    bundle_hash: bundleHash,
  };
  const bundleDocument = {
    schema_version: AUTOSKILL_BUNDLE_SCHEMA_VERSION,
    manifest,
    files: encodedFiles,
  };

  const serialized = stableStringify(bundleDocument);

  return {
    archiveBase64: Buffer.from(serialized, "utf8").toString("base64"),
    archiveHash: bundleHash,
    manifest: manifest as Record<string, unknown>,
    marimoEntrypoint,
    primaryFile,
    previewMd,
  };
};

export const loadAutoskillResultPayload = async (
  workspacePath: string,
): Promise<Record<string, unknown>> => {
  const resolved = path.resolve(workspacePath);
  const result = { ...DEFAULT_RESULT, ...(await readOptionalJson(path.join(resolved, "result.json"))) };
  const artifacts = await readOptionalJson(path.join(resolved, "artifacts.json"));
  const reproManifest = await readOptionalJson(path.join(resolved, "repro-manifest.json"));

  return {
    ...result,
    artifacts,
    repro_manifest: reproManifest,
  };
};

export const materializeAutoskillBundle = async (
  workspacePath: string,
  bundleText: string,
  expectedManifest?: Record<string, unknown>,
): Promise<string[]> => {
  const bundle = readBundleFiles(bundleText, expectedManifest);
  return materializeDirectory(workspacePath, bundle.files, bundle.manifest);
};

export const defaultSkillSlug = (workspacePath: string): string =>
  path.basename(path.resolve(workspacePath)).toLowerCase().replace(/[^a-z0-9]+/g, "-");

export const defaultTitle = (workspacePath: string): string => {
  const base = path.basename(path.resolve(workspacePath)).replace(/[-_]+/g, " ").trim();
  return base ? `${base[0]!.toUpperCase()}${base.slice(1)}` : "Autoskill bundle";
};

export const defaultVersion = (workspacePath: string): string =>
  `0.1.${Number.parseInt(shortHash(path.resolve(workspacePath)).slice(0, 2), 16) % 1000}`;

export const writeDefaultResultFiles = async (workspacePath: string): Promise<void> => {
  const resolved = path.resolve(workspacePath);
  await fs.writeFile(path.join(resolved, "result.json"), jsonText(DEFAULT_RESULT), "utf8");
  await fs.writeFile(path.join(resolved, "artifacts.json"), jsonText({}), "utf8");
  await fs.writeFile(path.join(resolved, "repro-manifest.json"), jsonText({}), "utf8");
};
