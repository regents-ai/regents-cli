import type { WatchedNodeLiveEvent, WorkPacketResponse } from "../../internal-types/index.js";

import type { TechtreeClient } from "../techtree/client.js";

const WATCH_POLL_MS = 1_500;

type WatchedNodeListener = (event: WatchedNodeLiveEvent) => void;

export class WatchedNodeRelay {
  private readonly techtree: TechtreeClient;
  private readonly listeners = new Set<WatchedNodeListener>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private primed = false;
  private cursor: number | null = null;
  private stopped = false;

  constructor(techtree: TechtreeClient) {
    this.techtree = techtree;
  }

  async start(): Promise<void> {
    this.stopped = false;
    return;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.listeners.clear();
    this.clearPollTimer();
    this.polling = false;
    this.primed = false;
    this.cursor = null;
  }

  async subscribe(listener: WatchedNodeListener): Promise<() => void> {
    this.stopped = false;
    this.listeners.add(listener);
    this.schedulePoll(0);

    return () => {
      this.listeners.delete(listener);

      if (this.listeners.size === 0) {
        this.clearPollTimer();
        this.polling = false;
        this.primed = false;
        this.cursor = null;
      }
    };
  }

  private schedulePoll(delayMs: number): void {
    if (this.stopped || this.pollTimer || this.listeners.size === 0) {
      return;
    }

    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pollOnce().catch(() => {
        if (!this.stopped && this.listeners.size > 0) {
          this.schedulePoll(WATCH_POLL_MS);
        }
      });
    }, delayMs);
  }

  private clearPollTimer(): void {
    if (!this.pollTimer) {
      return;
    }

    clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped || this.polling || this.listeners.size === 0) {
      return;
    }

    this.polling = true;
    let nextDelayMs = WATCH_POLL_MS;

    try {
      const watchedNodeIds = new Set((await this.techtree.listWatches()).data.map((watch) => watch.node_id));

      if (!this.primed) {
        const prime = await this.techtree.getInbox({ limit: 1 });
        this.cursor = prime.next_cursor;
        this.primed = true;
        await this.emitMatchingEvents(
          prime.events.filter((event) => event.event_type.startsWith("node.")),
          watchedNodeIds,
        );
        nextDelayMs = 0;
        return;
      }

      if (watchedNodeIds.size === 0) {
        const idle = await this.techtree.getInbox({ limit: 1 });
        this.cursor = idle.next_cursor;
        return;
      }

      const inbox =
        this.cursor === null
          ? await this.techtree.getInbox({ limit: 50 })
          : await this.techtree.getInbox({ cursor: this.cursor, limit: 50 });

      await this.emitMatchingEvents(inbox.events, watchedNodeIds);

      this.cursor = inbox.next_cursor;
    } finally {
      this.polling = false;
      if (!this.stopped) {
        this.schedulePoll(nextDelayMs);
      }
    }
  }

  private async emitMatchingEvents(
    events: Awaited<ReturnType<TechtreeClient["getInbox"]>>["events"],
    watchedNodeIds: Set<number>,
  ): Promise<void> {
    const workPacketCache = new Map<number, WorkPacketResponse>();

    for (const event of events) {
      if (event.subject_node_id === null || !watchedNodeIds.has(event.subject_node_id)) {
        continue;
      }

      let workPacket = workPacketCache.get(event.subject_node_id);

      if (!workPacket) {
        try {
          const response = await this.techtree.getWorkPacket(event.subject_node_id);
          workPacket = response.data;
          workPacketCache.set(event.subject_node_id, workPacket);
        } catch {
          continue;
        }
      }

      const payload: WatchedNodeLiveEvent = {
        event,
        data: workPacket,
      };

      for (const listener of this.listeners) {
        listener(payload);
      }
    }
  }
}
