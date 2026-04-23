import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const tempDir = mkdtempSync(join(tmpdir(), "platform-openapi-"));
const tempFile = join(tempDir, "platform-openapi.ts");

try {
  const generate = spawnSync(
    "pnpm",
    [
      "exec",
      "openapi-typescript",
      resolve(root, "../platform/api-contract.openapiv3.yaml"),
      "-o",
      tempFile,
    ],
    { cwd: root, stdio: "inherit" },
  );

  if (generate.status !== 0) {
    process.exit(generate.status ?? 1);
  }

  const diff = spawnSync(
    "diff",
    [
      "-u",
      resolve(root, "packages/regents-cli/src/generated/platform-openapi.ts"),
      tempFile,
    ],
    { cwd: root, stdio: "inherit" },
  );

  process.exitCode = diff.status ?? 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
