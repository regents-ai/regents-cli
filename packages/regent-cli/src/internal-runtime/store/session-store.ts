import type { SiwaSession } from "../../internal-types/index.js";

import { StateStore } from "./state-store.js";

export class SessionStore {
  readonly stateStore: StateStore;

  constructor(stateStore: StateStore) {
    this.stateStore = stateStore;
  }

  getSiwaSession(): SiwaSession | null {
    return this.stateStore.read().siwa ?? null;
  }

  setSiwaSession(session: SiwaSession): void {
    this.stateStore.patch({ siwa: session });
  }

  clearSiwaSession(): void {
    const current = this.stateStore.read();
    this.stateStore.write({ ...current, siwa: undefined });
  }

  isReceiptExpired(nowUnixSeconds = Math.floor(Date.now() / 1000)): boolean {
    const session = this.getSiwaSession();
    if (!session) {
      return true;
    }

    const expiresAtUnixSeconds = Math.floor(Date.parse(session.receiptExpiresAt) / 1000);
    if (!Number.isFinite(expiresAtUnixSeconds)) {
      return true;
    }

    return expiresAtUnixSeconds <= nowUnixSeconds;
  }
}
