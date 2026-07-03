import {
  runAutolaunchChatList,
  runAutolaunchChatRead,
  runAutolaunchChatSend,
  runAutolaunchChatSubscribeAdd,
  runAutolaunchChatSubscribeList,
  runAutolaunchChatSubscribeRemove,
  runAutolaunchChatTail,
  runAutolaunchChatUnread,
  runAutolaunchDm,
  runAutolaunchDmList,
} from "../commands/autolaunch/chat.js";
import {
  runChatFollowsAdd,
  runChatFollowsList,
  runChatFollowsRemove,
} from "../commands/chat-follows.js";
import {
  runTechtreeChatList,
  runTechtreeChatRead,
  runTechtreeChatSend,
  runTechtreeChatSubscribeAdd,
  runTechtreeChatSubscribeList,
  runTechtreeChatSubscribeRemove,
  runTechtreeChatTail,
  runTechtreeChatUnread,
  runTechtreeDm,
  runTechtreeDmList,
} from "../commands/chat.js";
import type { CliHandlerRegistry } from "./shared.js";

export const chatHandlers: CliHandlerRegistry = {
  "techtree chat list": { run: ({ configPath }) => runTechtreeChatList(configPath) },
  "techtree chat read <scope>": { run: ({ parsedArgs, configPath }) => runTechtreeChatRead(parsedArgs, configPath) },
  "techtree chat tail [scope...]": {
    run: ({ parsedArgs, configPath }) => runTechtreeChatTail(parsedArgs, configPath),
    pattern: "techtree chat tail",
    variadicTail: true,
  },
  "techtree chat send <scope>": { run: ({ parsedArgs, configPath }) => runTechtreeChatSend(parsedArgs, configPath) },
  "techtree chat unread [scope...]": {
    run: ({ parsedArgs, configPath }) => runTechtreeChatUnread(parsedArgs, configPath),
    pattern: "techtree chat unread",
    variadicTail: true,
  },
  "techtree chat subscribe add <scope>": {
    run: ({ parsedArgs, configPath }) => runTechtreeChatSubscribeAdd(parsedArgs, configPath),
  },
  "techtree chat subscribe remove <scope>": {
    run: ({ parsedArgs, configPath }) => runTechtreeChatSubscribeRemove(parsedArgs, configPath),
  },
  "techtree chat subscribe list": { run: ({ configPath }) => runTechtreeChatSubscribeList(configPath) },
  "techtree dm <node-id|address>": { run: ({ parsedArgs, configPath }) => runTechtreeDm(parsedArgs, configPath) },
  "techtree dm list": { run: ({ parsedArgs, configPath }) => runTechtreeDmList(parsedArgs, configPath) },
  "chat follows add <wallet|label>": { run: ({ parsedArgs, configPath }) => runChatFollowsAdd(parsedArgs, configPath) },
  "chat follows remove <wallet|label>": {
    run: ({ parsedArgs, configPath }) => runChatFollowsRemove(parsedArgs, configPath),
  },
  "chat follows list": { run: ({ configPath }) => runChatFollowsList(configPath) },
  "autolaunch chat list": { run: ({ configPath }) => runAutolaunchChatList(configPath) },
  "autolaunch chat read <scope>": { run: ({ parsedArgs, configPath }) => runAutolaunchChatRead(parsedArgs, configPath) },
  "autolaunch chat tail [scope...]": {
    run: ({ parsedArgs, configPath }) => runAutolaunchChatTail(parsedArgs, configPath),
    pattern: "autolaunch chat tail",
    variadicTail: true,
  },
  "autolaunch chat send <scope>": { run: ({ parsedArgs, configPath }) => runAutolaunchChatSend(parsedArgs, configPath) },
  "autolaunch chat unread [scope...]": {
    run: ({ parsedArgs, configPath }) => runAutolaunchChatUnread(parsedArgs, configPath),
    pattern: "autolaunch chat unread",
    variadicTail: true,
  },
  "autolaunch chat subscribe add <scope>": {
    run: ({ parsedArgs, configPath }) => runAutolaunchChatSubscribeAdd(parsedArgs, configPath),
  },
  "autolaunch chat subscribe remove <scope>": {
    run: ({ parsedArgs, configPath }) => runAutolaunchChatSubscribeRemove(parsedArgs, configPath),
  },
  "autolaunch chat subscribe list": { run: ({ configPath }) => runAutolaunchChatSubscribeList(configPath) },
  "autolaunch dm <subject-id|address>": { run: ({ parsedArgs, configPath }) => runAutolaunchDm(parsedArgs, configPath) },
  "autolaunch dm list": { run: ({ parsedArgs, configPath }) => runAutolaunchDmList(parsedArgs, configPath) },
};
