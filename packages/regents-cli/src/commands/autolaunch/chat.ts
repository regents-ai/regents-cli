import type { paths as AutolaunchPaths } from "../../generated/autolaunch-openapi.js";
import type { JsonSuccessResponseFor } from "../../contracts/openapi-helpers.js";

import {
  errorMessage,
  listXmtpDms,
  loadConfig,
  sendXmtpConversationText,
  sendXmtpDm,
} from "../../internal-runtime/index.js";
import { getBooleanFlag, getFlag, parseIntegerFlag, requireArg, type ParsedCliArgs } from "../../parse.js";
import { printJson } from "../../printer.js";
import { resolveLocalXmtpInboxId } from "../chat.js";
import { appendQuery, requestTypedJson } from "./shared.js";

const TOKEN_SCOPE_PREFIX = "token:";

const SUBJECT_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;

type ChatChannelListResponse = JsonSuccessResponseFor<AutolaunchPaths, "/v1/chat/channels", "get">;
type ChatListResponse = JsonSuccessResponseFor<AutolaunchPaths, "/v1/chat/{scope}/messages", "get">;
type ChatPostResponse = JsonSuccessResponseFor<AutolaunchPaths, "/v1/agent/chat/{scope}/messages", "post">;
type TokenRoomMembershipResponse = JsonSuccessResponseFor<
  AutolaunchPaths,
  "/v1/agent/chat/token/{subject_id}/membership",
  "post"
>;
type SubjectEnvelope = JsonSuccessResponseFor<AutolaunchPaths, "/v1/app/subjects/{id}", "get">;

const requireScope = (args: ParsedCliArgs): string => requireArg(args.positionals[3], "scope");

const parseSubjectIdFromScope = (scope: string): string => {
  const subjectId = scope.slice(TOKEN_SCOPE_PREFIX.length);
  if (!SUBJECT_ID_PATTERN.test(subjectId)) {
    throw new Error(`invalid token scope: ${scope}; expected token:<64-hex subject id>`);
  }

  return subjectId;
};

const requireSubjectIdPositional = (args: ParsedCliArgs): string => {
  const subjectId = requireArg(args.positionals[3], "subject-id");
  if (!SUBJECT_ID_PATTERN.test(subjectId)) {
    throw new Error(`invalid subject-id: ${subjectId}; expected a 0x-prefixed 64-hex revenue subject id`);
  }

  return subjectId;
};

const fetchChatChannels = async (configPath?: string): Promise<ChatChannelListResponse> =>
  requestTypedJson<ChatChannelListResponse>("GET", "/v1/chat/channels", { configPath });

export async function runAutolaunchChatList(configPath?: string): Promise<void> {
  printJson(await fetchChatChannels(configPath));
}

export async function runAutolaunchChatRead(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const scope = requireScope(args);
  printJson(
    await requestTypedJson<ChatListResponse>(
      "GET",
      appendQuery(`/v1/chat/${encodeURIComponent(scope)}/messages`, {
        before: parseIntegerFlag(args, "before")?.toString(),
        limit: parseIntegerFlag(args, "limit")?.toString(),
      }),
      { configPath },
    ),
  );
}

export async function runAutolaunchChatSend(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const scope = requireScope(args);
  const message = requireArg(getFlag(args, "message"), "--message");

  if (!scope.startsWith(TOKEN_SCOPE_PREFIX)) {
    printJson(
      await requestTypedJson<ChatPostResponse>(
        "POST",
        `/v1/agent/chat/${encodeURIComponent(scope)}/messages`,
        {
          body: {
            body: message,
            reply_to_message_id: parseIntegerFlag(args, "reply-to"),
            client_message_id: getFlag(args, "client-message-id"),
          },
          requireAgentAuth: true,
          configPath,
        },
      ),
    );
    return;
  }

  const subjectId = parseSubjectIdFromScope(scope);
  const joinHint = `run \`regents autolaunch chat join ${subjectId}\` to join the token room`;
  const channels = await fetchChatChannels(configPath);
  const room = channels.data.find((channel) => channel.scope === scope);

  if (!room) {
    throw new Error(`token room ${scope} does not exist yet; ${joinHint}`);
  }

  if (!room.xmtp_group_id) {
    throw new Error(`token room ${scope} has no XMTP group yet; ${joinHint}`);
  }

  const config = loadConfig(configPath);

  try {
    const result = await sendXmtpConversationText(config.xmtp, room.xmtp_group_id, message);
    printJson({ ...result, scope });
  } catch (error) {
    throw new Error(
      `unable to send to ${scope} over the local XMTP runtime (${errorMessage(error)}); if you are not a member yet, ${joinHint}`,
    );
  }
}

export async function runAutolaunchChatJoin(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const subjectId = requireSubjectIdPositional(args);
  const xmtpInboxId = await resolveLocalXmtpInboxId(configPath);

  printJson(
    await requestTypedJson<TokenRoomMembershipResponse>(
      "POST",
      `/v1/agent/chat/token/${encodeURIComponent(subjectId)}/membership`,
      {
        body: { xmtp_inbox_id: xmtpInboxId },
        requireAgentAuth: true,
        configPath,
      },
    ),
  );
}

export async function runAutolaunchDm(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const target = requireArg(args.positionals[2], "subject-id or address");
  const message = requireArg(getFlag(args, "message"), "--message");

  let wallet: string;
  if (SUBJECT_ID_PATTERN.test(target)) {
    const envelope = await requestTypedJson<SubjectEnvelope>(
      "GET",
      `/v1/app/subjects/${encodeURIComponent(target)}`,
      { configPath },
    );
    const creatorWallet = envelope.subject.creator_address;
    if (!creatorWallet) {
      throw new Error(`revenue subject ${target} has no creator wallet to DM`);
    }

    wallet = creatorWallet;
  } else if (/^0x[0-9a-fA-F]{40}$/.test(target)) {
    wallet = target;
  } else {
    throw new Error(`invalid DM target: ${target}; expected a 64-hex revenue subject id or a 0x wallet address`);
  }

  const config = loadConfig(configPath);
  printJson(await sendXmtpDm(config.xmtp, wallet, message));
}

export async function runAutolaunchDmList(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const config = loadConfig(configPath);
  printJson(await listXmtpDms(config.xmtp, { sync: getBooleanFlag(args, "sync") }));
}
