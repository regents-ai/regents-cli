import type { RegentConfig, XmtpRecentConversation } from "../../internal-types/index.js";

import { runConnectedXmtpCliJson } from "./cli-adapter.js";
import { normalizeXmtpRecentConversation, syncXmtpConversations } from "./conversations.js";
import { readXmtpRuntimeState, updateXmtpRuntimeState } from "./state.js";

interface XmtpCliConversationRecord {
  id?: string;
  type?: string;
  createdAt?: string;
  peerInboxId?: string;
  name?: string;
}

interface XmtpCliMessageCountResult {
  conversationId?: string;
  messageCount?: number;
}

export interface XmtpInboxConversationSummary extends XmtpRecentConversation {
  newMessages: number;
}

export interface XmtpInboxResult {
  ok: true;
  syncedAt: string;
  totalNewMessages: number;
  conversations: XmtpInboxConversationSummary[];
}

const nowNanoseconds = (): string => (BigInt(Date.now()) * 1_000_000n).toString();

/**
 * Summarize local XMTP conversations with new-message counts since the last
 * locally recorded inbox check, then advance the per-conversation last-seen
 * markers to now.
 */
export const getXmtpInbox = async (
  config: RegentConfig["xmtp"],
  options?: { sync?: boolean },
): Promise<XmtpInboxResult> => {
  if (options?.sync !== false) {
    await syncXmtpConversations(config);
  }

  const records = await runConnectedXmtpCliJson<XmtpCliConversationRecord[]>(config, [
    "conversations",
    "list",
  ]);

  const lastSeenByConversation = readXmtpRuntimeState(config).lastSeenByConversation;
  const checkedAtNs = nowNanoseconds();
  const nextLastSeen: Record<string, string> = { ...lastSeenByConversation };
  const conversations: XmtpInboxConversationSummary[] = [];

  for (const record of records) {
    if (!record.id) {
      continue;
    }

    const lastSeen = lastSeenByConversation[record.id];
    const count = await runConnectedXmtpCliJson<XmtpCliMessageCountResult>(config, [
      "conversation",
      "count-messages",
      record.id,
      ...(lastSeen ? ["--sent-after", lastSeen] : []),
    ]);

    conversations.push({
      ...normalizeXmtpRecentConversation(record),
      newMessages: count.messageCount ?? 0,
    });
    nextLastSeen[record.id] = checkedAtNs;
  }

  updateXmtpRuntimeState(config, (current) => ({
    ...current,
    lastSeenByConversation: nextLastSeen,
  }));

  return {
    ok: true,
    syncedAt: new Date().toISOString(),
    totalNewMessages: conversations.reduce((total, conversation) => total + conversation.newMessages, 0),
    conversations,
  };
};

export interface XmtpStreamedMessage {
  id?: string;
  conversationId?: string;
  senderInboxId?: string;
  contentType?: unknown;
  content?: unknown;
  sentAt?: string;
  deliveryStatus?: unknown;
  kind?: unknown;
  [key: string]: unknown;
}

/** Parse one NDJSON line from `xmtp conversations stream-all-messages --json`. */
export const parseXmtpStreamLine = (line: string): XmtpStreamedMessage | null => {
  const trimmed = line.trim();
  if (trimmed === "") {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  return payload as XmtpStreamedMessage;
};

/** Case-insensitive sender filter for `xmtp tail --from <inbox-id>` (repeatable). */
export const xmtpSenderMatches = (message: XmtpStreamedMessage, froms: readonly string[]): boolean => {
  if (froms.length === 0) {
    return true;
  }

  const sender = typeof message.senderInboxId === "string" ? message.senderInboxId.toLowerCase() : "";
  return froms.some((from) => from.toLowerCase() === sender);
};
