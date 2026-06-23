import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildAutoskillBundlePayload,
  initAutoskillEvalWorkspace,
  initAutoskillSkillWorkspace,
  materializeAutoskillBundle,
} from "../../src/internal-runtime/workloads/autoskill.js";

const tempRoots: string[] = [];

const makeTempDir = async (prefix: string): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

const refreshBundleHash = (bundle: Record<string, unknown>): void => {
  const manifest = { ...(bundle.manifest as Record<string, unknown>) };
  delete manifest.bundle_hash;
  (bundle.manifest as Record<string, unknown>).bundle_hash = sha256Hex(
    stableStringify({ ...bundle, manifest }),
  );
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

describe("autoskill workload helpers", () => {
  it("scaffolds a skill workspace and produces a deterministic bundle payload", async () => {
    const workspace = await makeTempDir("autoskill-skill-");
    await initAutoskillSkillWorkspace(workspace);
    await fs.writeFile(path.join(workspace, "examples", "sample.txt"), "hello\n", "utf8");

    const first = await buildAutoskillBundlePayload(workspace, "skill");
    const second = await buildAutoskillBundlePayload(workspace, "skill");

    expect(first.archiveBase64).toBe(second.archiveBase64);
    expect(first.archiveHash).toBe(second.archiveHash);
    expect(first.marimoEntrypoint).toBe("session.marimo.py");
    expect(first.primaryFile).toBe("SKILL.md");
    expect(first.manifest.bundle_hash).toBe(first.archiveHash);
    expect(first.manifest.total_size).toBeTypeOf("number");
    expect(await fs.readFile(path.join(workspace, "pyproject.toml"), "utf8")).toContain("watcher_on_save = \"autorun\"");
    expect(first.manifest).toMatchObject({
      type: "skill",
      access_mode: "public_free",
      marimo_entrypoint: "session.marimo.py",
    });
  });

  it("scaffolds an eval workspace and materializes a pulled bundle", async () => {
    const source = await makeTempDir("autoskill-eval-source-");
    const target = await makeTempDir("autoskill-eval-target-");

    await initAutoskillEvalWorkspace(source);
    await fs.writeFile(path.join(source, "tasks", "task.txt"), "score this run\n", "utf8");

    const bundle = await buildAutoskillBundlePayload(source, "eval", {
      version: "0.2.0",
    });

    const restoredFiles = await materializeAutoskillBundle(
      target,
      Buffer.from(bundle.archiveBase64, "base64").toString("utf8"),
      bundle.manifest,
    );

    expect(restoredFiles).toContain("bundle.manifest.json");
    expect(restoredFiles).toContain("session.marimo.py");
    expect(restoredFiles).toContain("pyproject.toml");
    expect(restoredFiles).toContain("scenario.yaml");
    expect(restoredFiles).toContain("tasks/task.txt");
    expect(await fs.readFile(path.join(target, "tasks", "task.txt"), "utf8")).toBe("score this run\n");
    expect(JSON.parse(await fs.readFile(path.join(target, "bundle.manifest.json"), "utf8"))).toEqual(bundle.manifest);
  });

  it("rejects autoskill bundles that try to write outside the workspace", async () => {
    const source = await makeTempDir("autoskill-traversal-source-");
    const target = path.join(await makeTempDir("autoskill-traversal-parent-"), "pulled");

    await initAutoskillSkillWorkspace(source);
    const bundle = await buildAutoskillBundlePayload(source, "skill");
    const parsed = JSON.parse(Buffer.from(bundle.archiveBase64, "base64").toString("utf8"));
    parsed.files[0].path = "../outside.txt";

    await expect(
      materializeAutoskillBundle(target, JSON.stringify(parsed), parsed.manifest),
    ).rejects.toThrow(/unsafe autoskill bundle path/);

    await expect(fs.access(path.join(path.dirname(target), "outside.txt"))).rejects.toThrow();
  });

  it("rejects autoskill bundles with duplicate paths after normalization", async () => {
    const source = await makeTempDir("autoskill-duplicate-source-");
    const target = path.join(await makeTempDir("autoskill-duplicate-parent-"), "pulled");

    await initAutoskillSkillWorkspace(source);
    const bundle = await buildAutoskillBundlePayload(source, "skill");
    const parsed = JSON.parse(Buffer.from(bundle.archiveBase64, "base64").toString("utf8"));
    const duplicate = {
      ...parsed.files[0],
      path: `./${parsed.files[0].path}`,
    };
    parsed.files.push(duplicate);
    parsed.manifest.files.push({
      path: duplicate.path,
      sha256: parsed.manifest.files[0].sha256,
      size: parsed.manifest.files[0].size,
    });
    parsed.manifest.total_size += parsed.manifest.files[0].size;
    refreshBundleHash(parsed);

    await expect(
      materializeAutoskillBundle(target, JSON.stringify(parsed), parsed.manifest),
    ).rejects.toThrow(/duplicate autoskill bundle path/);
  });

  it("rejects autoskill bundles whose bytes do not match the published manifest", async () => {
    const source = await makeTempDir("autoskill-tamper-source-");
    const target = path.join(await makeTempDir("autoskill-tamper-parent-"), "pulled");

    await initAutoskillSkillWorkspace(source);
    const bundle = await buildAutoskillBundlePayload(source, "skill");
    const parsed = JSON.parse(Buffer.from(bundle.archiveBase64, "base64").toString("utf8"));
    parsed.files[0].content_b64 = Buffer.from("changed\n", "utf8").toString("base64");

    await expect(
      materializeAutoskillBundle(target, JSON.stringify(parsed), parsed.manifest),
    ).rejects.toThrow(/hash does not match|failed verification/);
  });

  it("rejects autoskill bundles with too many files", async () => {
    const source = await makeTempDir("autoskill-too-many-source-");
    const target = path.join(await makeTempDir("autoskill-too-many-parent-"), "pulled");

    await initAutoskillSkillWorkspace(source);
    const bundle = await buildAutoskillBundlePayload(source, "skill");
    const parsed = JSON.parse(Buffer.from(bundle.archiveBase64, "base64").toString("utf8"));
    parsed.files = [];
    parsed.manifest.files = Array.from({ length: 513 }, (_entry, index) => ({
      path: `files/${index}.txt`,
      sha256: "0".repeat(64),
      size: 0,
    }));
    parsed.manifest.total_size = 0;

    await expect(
      materializeAutoskillBundle(target, JSON.stringify(parsed), parsed.manifest),
    ).rejects.toThrow(/too many files/);
  });

  it("rejects autoskill bundles with oversized files or total size", async () => {
    const source = await makeTempDir("autoskill-oversized-source-");
    const target = path.join(await makeTempDir("autoskill-oversized-parent-"), "pulled");

    await initAutoskillSkillWorkspace(source);
    const bundle = await buildAutoskillBundlePayload(source, "skill");
    const parsed = JSON.parse(Buffer.from(bundle.archiveBase64, "base64").toString("utf8"));
    parsed.manifest.files[0].size = 5 * 1024 * 1024 + 1;

    await expect(
      materializeAutoskillBundle(target, JSON.stringify(parsed), parsed.manifest),
    ).rejects.toThrow(/file is too large/);

    const totalParsed = JSON.parse(Buffer.from(bundle.archiveBase64, "base64").toString("utf8"));
    totalParsed.manifest.total_size = 25 * 1024 * 1024 + 1;

    await expect(
      materializeAutoskillBundle(target, JSON.stringify(totalParsed), totalParsed.manifest),
    ).rejects.toThrow(/total_size is too large/);
  });
});
