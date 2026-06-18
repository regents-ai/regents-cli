import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeContext } from "../../../src/internal-runtime/runtime.js";

const runTechtreeCoreJsonMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/internal-runtime/techtree/core.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/internal-runtime/techtree/core.js")>();
  return {
    ...actual,
    runTechtreeCoreJson: runTechtreeCoreJsonMock,
  };
});

const { handleTechtreeWorkPublish } = await import("../../../src/internal-runtime/handlers/techtree/work.js");

const tempDirs: string[] = [];

const makeTempDir = async (prefix: string): Promise<string> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
};

const nodeHeader = {
  id: `0x${"11".repeat(32)}`,
  subjectId: `0x${"22".repeat(32)}`,
  auxId: `0x${"00".repeat(32)}`,
  payloadHash: `sha256:${"ab".repeat(32)}`,
  nodeType: 1,
  schemaVersion: 1,
  flags: 0,
  author: `0x${"33".repeat(20)}`,
};

const compiledFor = (workspacePath: string, entrypoint: string) => ({
  ok: true,
  entrypoint,
  workspace_path: workspacePath,
  dist_path: path.join(workspacePath, "dist"),
  manifest_path: path.join(workspacePath, "dist", "manifest.json"),
  payload_index_path: path.join(workspacePath, "dist", "payload.index.json"),
  node_header_path: path.join(workspacePath, "dist", "node-header.json"),
  checksums_path: path.join(workspacePath, "dist", "checksums.txt"),
  node_id: nodeHeader.id,
  manifest_hash: `sha256:${"cd".repeat(32)}`,
  payload_hash: nodeHeader.payloadHash,
  manifest: { schema_version: "techtree.artifact.v1", title: "Synthetic artifact" },
  payload_index: { schema_version: "techtree.payload-index.v1", files: [] },
  node_header: nodeHeader,
});

const makeContext = () => {
  const publishNode = vi.fn(async (input: { node_type: string }) => ({
    ok: true as const,
    node_id: nodeHeader.id,
    manifest_cid: null,
    payload_cid: null,
    tx_hash: null,
    node_type: input.node_type,
  }));
  const createNode = vi.fn(async () => ({ ok: true, data: { node_id: 42 } }));
  const ctx = {
    techtreePublisher: { publishNode },
    techtree: { createNode },
  } as unknown as RuntimeContext;
  return { ctx, publishNode, createNode };
};

beforeEach(() => {
  runTechtreeCoreJsonMock.mockReset();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
});

describe("handleTechtreeWorkPublish", () => {
  it("compiles and submits a v1 artifact workspace in one call", async () => {
    const workspacePath = await makeTempDir("regents-work-publish-artifact-");
    await fs.writeFile(path.join(workspacePath, "artifact.source.yaml"), "schema_version: techtree.artifact-source.v1\n");
    runTechtreeCoreJsonMock.mockImplementation(async (entrypoint: string) =>
      compiledFor(workspacePath, entrypoint));

    const { ctx, publishNode, createNode } = makeContext();
    const result = (await handleTechtreeWorkPublish(ctx, { workspace_path: workspacePath })) as Record<string, unknown>;

    expect(runTechtreeCoreJsonMock).toHaveBeenCalledWith(
      "artifact.compile",
      { workspace_path: workspacePath },
      { cwd: workspacePath },
    );
    expect(publishNode).toHaveBeenCalledTimes(1);
    expect(publishNode).toHaveBeenCalledWith({
      node_type: "artifact",
      workspace_path: workspacePath,
      dist_path: path.join(workspacePath, "dist"),
      header: nodeHeader,
      manifest: { schema_version: "techtree.artifact.v1", title: "Synthetic artifact" },
      payload_index: { schema_version: "techtree.payload-index.v1", files: [] },
    });
    expect(createNode).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, tree: "main", node_id: nodeHeader.id });
  });

  it("compiles and submits a v1 run workspace in one call", async () => {
    const workspacePath = await makeTempDir("regents-work-publish-run-");
    await fs.writeFile(path.join(workspacePath, "run.source.yaml"), "schema_version: techtree.run-source.v1\n");
    runTechtreeCoreJsonMock.mockImplementation(async (entrypoint: string) =>
      compiledFor(workspacePath, entrypoint));

    const { ctx, publishNode } = makeContext();
    await handleTechtreeWorkPublish(ctx, { workspace_path: workspacePath });

    expect(runTechtreeCoreJsonMock).toHaveBeenCalledWith(
      "run.compile",
      { workspace_path: workspacePath },
      { cwd: workspacePath },
    );
    expect(publishNode).toHaveBeenCalledWith(expect.objectContaining({ node_type: "run" }));
  });

  it("publishes a notebook workspace through the notebook path unchanged", async () => {
    const workspacePath = await makeTempDir("regents-work-publish-notebook-");
    await fs.writeFile(
      path.join(workspacePath, "notebook.json"),
      `${JSON.stringify({
        schema: "regents.techtree.notebook.v1",
        kind: "freeform",
        title: "Notebook title",
        source: null,
        summary: "Notebook summary.",
        notebook_file: "analysis.py",
        created_at: "2026-06-11T00:00:00.000Z",
      })}\n`,
    );
    await fs.writeFile(path.join(workspacePath, "analysis.py"), "print('notebook')\n");

    const { ctx, publishNode, createNode } = makeContext();
    const result = (await handleTechtreeWorkPublish(ctx, { workspace_path: workspacePath })) as Record<string, unknown>;

    expect(createNode).toHaveBeenCalledTimes(1);
    expect(publishNode).not.toHaveBeenCalled();
    expect(runTechtreeCoreJsonMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, workspace_path: workspacePath });
  });

  it("returns workspace instructions when no publishable manifest is present", async () => {
    const workspacePath = await makeTempDir("regents-work-publish-other-");

    const { ctx, publishNode, createNode } = makeContext();
    const result = (await handleTechtreeWorkPublish(ctx, { workspace_path: workspacePath })) as {
      ok: boolean;
      next: string[];
    };

    expect(publishNode).not.toHaveBeenCalled();
    expect(createNode).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.next.join("\n")).toContain("specialized publish command");
  });
});
