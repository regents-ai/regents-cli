import type { paths as AutolaunchPaths } from "../../generated/autolaunch-openapi.js";
import type { JsonSuccessResponseFor } from "../../contracts/openapi-helpers.js";

import {
  addChatSubscription,
  listChatSubscriptions,
  listXmtpDms,
  loadConfig,
  removeChatSubscription,
  sendXmtpDm,
} from "../../internal-runtime/index.js";
import { getBooleanFlag, getFlag, parseIntegerFlag, requireArg, type ParsedCliArgs } from "../../parse.js";
import { printJson } from "../../printer.js";
import { resolveChatAuthorFilter } from "../chat-filter.js";
import { CHAT_UNREAD_PAGE_LIMIT } from "../chat-unread.js";
import { collectUnreadForScopes, resolveChatScopes } from "../chat.js";
import { appendQuery, requestTypedJson } from "./shared.js";

const SUBJECT_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;

type ChatChannelListResponse = JsonSuccessResponseFor<AutolaunchPaths, "/v1/chat/channels", "get">;
type ChatListResponse = JsonSuccessResponseFor<AutolaunchPaths, "/v1/chat/messages", "get">;
type ChatPostResponse = JsonSuccessResponseFor<AutolaunchPaths, "/v1/agent/chat/messages", "post">;
type SubjectEnvelope = JsonSuccessResponseFor<AutolaunchPaths, "/v1/app/subjects/{id}", "get">;

const requireScope = (args: ParsedCliArgs): string => requireArg(args.positionals[3], "scope");

const fetchChatMessages = (
  scope: string,
  params: { before?: number; limit?: number },
  configPath?: string,
): Promise<ChatListResponse> =>
  requestTypedJson<ChatListResponse>(
    "GET",
    appendQuery("/v1/chat/messages", {
      scope,
      before: params.before?.toString(),
      limit: params.limit?.toString(),
    }),
    { configPath },
  );

export async function runAutolaunchChatList(configPath?: string): Promise<void> {
  printJson(await requestTypedJson<ChatChannelListResponse>("GET", "/v1/chat/channels", { configPath }));
}

export async function runAutolaunchChatRead(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const scope = requireScope(args);
  const filter = resolveChatAuthorFilter(args, loadConfig(configPath));
  const result = await fetchChatMessages(
    scope,
    {
      before: parseIntegerFlag(args, "before"),
      limit: parseIntegerFlag(args, "limit"),
    },
    configPath,
  );

  printJson(filter ? { ...result, data: result.data.filter(filter) } : result);
}

export async function runAutolaunchChatSend(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const scope = requireScope(args);
  const message = requireArg(getFlag(args, "message"), "--message");

  printJson(
    await requestTypedJson<ChatPostResponse>(
      "POST",
      appendQuery("/v1/agent/chat/messages", { scope }),
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
}

export async function runAutolaunchChatUnread(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const config = loadConfig(configPath);
  const scopes = resolveChatScopes(args.positionals.slice(3), config, "autolaunch");
  const filter = resolveChatAuthorFilter(args, config);
  const peek = getBooleanFlag(args, "peek");

  printJson(
    await collectUnreadForScopes({
      scopes,
      filter,
      peek,
      config,
      product: "autolaunch",
      fetchPage: (scope, before) =>
        fetchChatMessages(scope, { before, limit: CHAT_UNREAD_PAGE_LIMIT }, configPath),
    }),
  );
}

export async function runAutolaunchChatSubscribeAdd(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const scope = requireArg(args.positionals[4], "scope");
  const config = loadConfig(configPath);
  printJson({ ok: true, product: "autolaunch", ...addChatSubscription(config, "autolaunch", scope) });
}

export async function runAutolaunchChatSubscribeRemove(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const scope = requireArg(args.positionals[4], "scope");
  const config = loadConfig(configPath);
  printJson({ ok: true, product: "autolaunch", ...removeChatSubscription(config, "autolaunch", scope) });
}

export async function runAutolaunchChatSubscribeList(configPath?: string): Promise<void> {
  const config = loadConfig(configPath);
  printJson({ ok: true, product: "autolaunch", scopes: listChatSubscriptions(config, "autolaunch") });
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
