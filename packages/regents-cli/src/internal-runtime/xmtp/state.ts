import fs from "node:fs";
import path from "node:path";

import type {
  RegentConfig,
  XmtpRecentConversation,
  XmtpRecentError,
  XmtpRuntimeMetrics,
} from "../../internal-types/index.js";

import { errorMessage } from "../errors.js";
import { writeJsonFileAtomicSync } from "../paths.js";

export const MAX_RECENT_ERRORS = 10;
export const MAX_RECENT_CONVERSATIONS = 20;

export interface XmtpRuntimeState {
  connected: boolean;
  metrics: XmtpRuntimeMetrics;
  recentErrors: XmtpRecentError[];
  recentConversations: XmtpRecentConversation[];
}

export const defaultXmtpMetrics = (): XmtpRuntimeMetrics => ({
  startedAt: null,
  stoppedAt: null,
  lastSyncAt: null,
  lastMessageAt: null,
  receivedMessages: 0,
  sentMessages: 0,
  sendFailures: 0,
  groupsCreated: 0,
  membersAdded: 0,
  installationsRevoked: 0,
  walletRotations: 0,
  dbKeyRotations: 0,
  restarts: 0,
});

export const defaultXmtpRuntimeState = (): XmtpRuntimeState => ({
  connected: false,
  metrics: defaultXmtpMetrics(),
  recentErrors: [],
  recentConversations: [],
});

export const xmtpRuntimeStatePath = (config: RegentConfig["xmtp"]): string => {
  return path.join(path.dirname(config.dbPath), "runtime-state.json");
};

const parseRuntimeState = (raw: string): XmtpRuntimeState => {
  const parsed = JSON.parse(raw) as Partial<XmtpRuntimeState>;
  return {
    connected: parsed.connected === true,
    metrics: {
      ...defaultXmtpMetrics(),
      ...(parsed.metrics ?? {}),
    },
    recentErrors: Array.isArray(parsed.recentErrors)
      ? parsed.recentErrors
          .filter((item): item is XmtpRecentError => {
            return !!item && typeof item.at === "string" && typeof item.code === "string" && typeof item.message === "string";
          })
          .slice(0, MAX_RECENT_ERRORS)
      : [],
    recentConversations: Array.isArray(parsed.recentConversations)
      ? parsed.recentConversations
          .filter((item): item is XmtpRecentConversation => !!item && typeof item.id === "string")
          .slice(0, MAX_RECENT_CONVERSATIONS)
      : [],
  };
};

export const readXmtpRuntimeState = (config: RegentConfig["xmtp"]): XmtpRuntimeState => {
  const statePath = xmtpRuntimeStatePath(config);
  if (!fs.existsSync(statePath)) {
    return defaultXmtpRuntimeState();
  }

  try {
    return parseRuntimeState(fs.readFileSync(statePath, "utf8"));
  } catch (error) {
    return {
      ...defaultXmtpRuntimeState(),
      recentErrors: [
        {
          at: new Date().toISOString(),
          code: "runtime_state_invalid",
          message: errorMessage(error),
        },
      ],
    };
  }
};

export const writeXmtpRuntimeState = (config: RegentConfig["xmtp"], state: XmtpRuntimeState): XmtpRuntimeState => {
  const statePath = xmtpRuntimeStatePath(config);
  writeJsonFileAtomicSync(statePath, state);
  return state;
};

export const updateXmtpRuntimeState = (
  config: RegentConfig["xmtp"],
  updater: (current: XmtpRuntimeState) => XmtpRuntimeState,
): XmtpRuntimeState => {
  const next = updater(readXmtpRuntimeState(config));
  return writeXmtpRuntimeState(config, next);
};

export const recordXmtpRuntimeError = (
  config: RegentConfig["xmtp"],
  code: string,
  message: string,
): XmtpRuntimeState => {
  return updateXmtpRuntimeState(config, (current) => ({
    ...current,
    recentErrors: [
      {
        at: new Date().toISOString(),
        code,
        message,
      },
      ...current.recentErrors,
    ].slice(0, MAX_RECENT_ERRORS),
  }));
};

export const recordXmtpRecentConversation = (
  config: RegentConfig["xmtp"],
  conversation: XmtpRecentConversation,
): XmtpRuntimeState => {
  return updateXmtpRuntimeState(config, (current) => ({
    ...current,
    recentConversations: [
      conversation,
      ...current.recentConversations.filter((item) => item.id !== conversation.id),
    ].slice(0, MAX_RECENT_CONVERSATIONS),
  }));
};
