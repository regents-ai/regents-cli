import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import type { LocalAgentIdentity, RegentAgentRuntimeState, SiwaSession } from "../../internal-types/index.js";

import { ensureParentDir } from "../paths.js";

export interface PersistentState {
  siwa?: SiwaSession;
  agent?: LocalAgentIdentity;
  agentRuntime?: RegentAgentRuntimeState;
  lastUsedNodeIdempotencyKey?: string;
  lastUsedCommentIdempotencyKey?: string;
}

const emptyState = (): PersistentState => ({});

export class StateStore {
  readonly stateFilePath: string;

  constructor(stateFilePath: string) {
    this.stateFilePath = path.resolve(stateFilePath);
  }

  read(): PersistentState {
    if (!fs.existsSync(this.stateFilePath)) {
      return emptyState();
    }

    const raw = fs.readFileSync(this.stateFilePath, "utf8");
    if (raw.trim() === "") {
      return emptyState();
    }

    const parsed = JSON.parse(raw) as PersistentState;
    return parsed && typeof parsed === "object" ? parsed : emptyState();
  }

  write(next: PersistentState): void {
    ensureParentDir(this.stateFilePath);

    const tempPath = `${this.stateFilePath}.${crypto.randomUUID()}.tmp`;
    const payload = `${JSON.stringify(next, null, 2)}\n`;
    fs.writeFileSync(tempPath, payload, "utf8");

    const fileHandle = fs.openSync(tempPath, "r");
    try {
      fs.fsyncSync(fileHandle);
    } finally {
      fs.closeSync(fileHandle);
    }

    fs.renameSync(tempPath, this.stateFilePath);
  }

  patch(patch: Partial<PersistentState>): void {
    const current = this.read();
    const next: PersistentState = {
      ...current,
      ...patch,
      agent: patch.agent === undefined ? current.agent : { ...(current.agent ?? {}), ...patch.agent },
      agentRuntime:
        patch.agentRuntime === undefined
          ? current.agentRuntime
          : { ...(current.agentRuntime ?? {}), ...patch.agentRuntime },
    };

    this.write(next);
  }

  clear(): void {
    this.write(emptyState());
  }
}
