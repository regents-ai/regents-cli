import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }

  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}

export function defaultStateDir(): string {
  return path.join(os.homedir(), ".regent", "state");
}

export function defaultSocketPath(): string {
  return path.join(os.homedir(), ".regent", "run", "regent.sock");
}

export function defaultConfigPath(): string {
  return path.join(os.homedir(), ".regent", "config.json");
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
