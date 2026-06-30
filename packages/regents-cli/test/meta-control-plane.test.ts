import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const readYaml = (path: string) => YAML.parse(fs.readFileSync(path, "utf8"));

describe("Regent meta control plane", () => {
  it("requires active repos to have repo.yaml", () => {
    const stack = readYaml(resolve(workspaceRoot, "meta/stack.yaml"));
    const activeRepos = Object.entries(stack.repos).filter(([, repo]) => (repo as { active?: boolean }).active !== false);

    for (const [name, repo] of activeRepos) {
      const repoPath = resolve(workspaceRoot, (repo as { path: string }).path, "repo.yaml");
      expect(fs.existsSync(repoPath), `${name} repo.yaml`).toBe(true);
    }
  });

  it("rejects the retired Platform CLI contract shape", () => {
    const contract = readYaml(resolve(workspaceRoot, "platform/contracts/platform/cli-contract.yaml"));

    expect(contract.version).toBe(1);
    expect(contract.openapi).toBeUndefined();
    expect(Array.isArray(contract.commands)).toBe(false);
    expect(Array.isArray(contract.command_groups)).toBe(true);
  });

  it("keeps chain manifest prepared actions attached to ABI functions", () => {
    for (const manifestPath of [
      resolve(workspaceRoot, "platform/contracts/chain-contracts.yaml"),
      resolve(workspaceRoot, "techtree/contracts/chain-contracts.yaml"),
    ]) {
      const manifest = readYaml(manifestPath);
      for (const contract of manifest.contracts) {
        const artifactPath = resolve(dirname(manifestPath), contract.artifact);
        const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
        const functions = new Set(
          artifact.abi
            .filter((entry: { type?: string }) => entry.type === "function")
            .map((entry: { name: string }) => entry.name),
        );

        for (const action of contract.prepared_actions) {
          expect(functions.has(action.function), `${contract.id}.${action.id}`).toBe(true);
        }
      }
    }
  });
});
