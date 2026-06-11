import type {
  RegentConfig,
  XmtpConversationSendResult,
  XmtpDmListResult,
  XmtpDmSendResult,
  XmtpDmTestResult,
  XmtpInboxSyncResult,
  XmtpRecentConversation,
} from "../../internal-types/index.js";

import { RegentError } from "../errors.js";
import { runConnectedXmtpCli, runConnectedXmtpCliJson } from "./cli-adapter.js";
import { recordXmtpRecentConversation, updateXmtpRuntimeState } from "./state.js";

interface XmtpCliConversationRecord {
  id?: string;
  type?: string;
  createdAt?: string;
  peerInboxId?: string;
  name?: string;
}

interface XmtpCliSendTextResult {
  success?: boolean;
  messageId?: string;
  conversationId?: string;
  text?: string;
}

interface XmtpCliCreateDmResult {
  id?: string;
}

export const normalizeXmtpRecentConversation = (payload: XmtpCliConversationRecord): XmtpRecentConversation => ({
  id: payload.id ?? "unknown",
  type: payload.type === "group" || payload.type === "dm" ? payload.type : "unknown",
  createdAt: payload.createdAt,
  peerInboxId: payload.peerInboxId,
  name: payload.name,
});

export const syncXmtpConversations = async (config: RegentConfig["xmtp"]): Promise<XmtpInboxSyncResult> => {
  await runConnectedXmtpCli(config, ["conversations", "sync-all"]);
  const syncedAt = new Date().toISOString();
  updateXmtpRuntimeState(config, (current) => ({
    ...current,
    metrics: {
      ...current.metrics,
      lastSyncAt: syncedAt,
    },
  }));

  return {
    ok: true,
    syncedAt,
  };
};

export const listXmtpDms = async (
  config: RegentConfig["xmtp"],
  options?: { sync?: boolean },
): Promise<XmtpDmListResult> => {
  const payload = await runConnectedXmtpCliJson<XmtpCliConversationRecord[]>(config, [
    "conversations",
    "list",
    "--type",
    "dm",
    ...(options?.sync ? ["--sync"] : []),
  ]);

  return {
    ok: true,
    conversations: payload.map(normalizeXmtpRecentConversation),
  };
};

export const sendXmtpConversationText = async (
  config: RegentConfig["xmtp"],
  conversationId: string,
  message: string,
): Promise<XmtpConversationSendResult> => {
  const sendResult = await runConnectedXmtpCliJson<XmtpCliSendTextResult>(config, [
    "conversation",
    "send-text",
    conversationId,
    message,
  ]);

  if (!sendResult.success || !sendResult.messageId) {
    updateXmtpRuntimeState(config, (current) => ({
      ...current,
      metrics: {
        ...current.metrics,
        sendFailures: current.metrics.sendFailures + 1,
      },
    }));
    throw new RegentError("xmtp_cli_error", "conversation send did not return a message id");
  }

  updateXmtpRuntimeState(config, (current) => ({
    ...current,
    metrics: {
      ...current.metrics,
      sentMessages: current.metrics.sentMessages + 1,
    },
  }));

  return {
    ok: true,
    conversationId,
    messageId: sendResult.messageId,
    text: message,
  };
};

export const sendXmtpDm = async (
  config: RegentConfig["xmtp"],
  to: string,
  message: string,
): Promise<XmtpDmSendResult> => {
  const dm = await runConnectedXmtpCliJson<XmtpCliCreateDmResult>(config, [
    "conversations",
    "create-dm",
    to.toLowerCase(),
  ]);

  if (!dm.id) {
    throw new RegentError("xmtp_cli_error", "DM create did not return a conversation id");
  }

  const sendResult = await sendXmtpConversationText(config, dm.id, message);

  recordXmtpRecentConversation(config, {
    id: dm.id,
    type: "dm",
  });

  return {
    ok: true,
    to,
    conversationId: dm.id,
    messageId: sendResult.messageId,
    text: message,
  };
};

export const testXmtpDm = async (
  config: RegentConfig["xmtp"],
  to: `0x${string}`,
  message: string,
): Promise<XmtpDmTestResult> => {
  const result = await sendXmtpDm(config, to, message);
  return {
    ...result,
    to,
  };
};
