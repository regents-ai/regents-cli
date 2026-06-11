import {
  runAutolaunchChatJoin,
  runAutolaunchChatList,
  runAutolaunchChatRead,
  runAutolaunchChatSend,
  runAutolaunchDm,
  runAutolaunchDmList,
} from "../commands/autolaunch/chat.js";
import {
  runTechtreeChatJoin,
  runTechtreeChatList,
  runTechtreeChatRead,
  runTechtreeChatSend,
  runTechtreeChatTail,
  runTechtreeDm,
  runTechtreeDmList,
} from "../commands/chat.js";
import type { CliHandlerRegistry } from "./shared.js";

export const chatHandlers: CliHandlerRegistry = {
  "techtree chat list": { run: ({ configPath }) => runTechtreeChatList(configPath) },
  "techtree chat read <scope>": { run: ({ parsedArgs, configPath }) => runTechtreeChatRead(parsedArgs, configPath) },
  "techtree chat tail <scope>": { run: ({ parsedArgs, configPath }) => runTechtreeChatTail(parsedArgs, configPath) },
  "techtree chat send <scope>": { run: ({ parsedArgs, configPath }) => runTechtreeChatSend(parsedArgs, configPath) },
  "techtree chat join <node-id>": { run: ({ parsedArgs, configPath }) => runTechtreeChatJoin(parsedArgs, configPath) },
  "techtree dm <node-id|address>": { run: ({ parsedArgs, configPath }) => runTechtreeDm(parsedArgs, configPath) },
  "techtree dm list": { run: ({ parsedArgs, configPath }) => runTechtreeDmList(parsedArgs, configPath) },
  "autolaunch chat list": { run: ({ configPath }) => runAutolaunchChatList(configPath) },
  "autolaunch chat read <scope>": { run: ({ parsedArgs, configPath }) => runAutolaunchChatRead(parsedArgs, configPath) },
  "autolaunch chat send <scope>": { run: ({ parsedArgs, configPath }) => runAutolaunchChatSend(parsedArgs, configPath) },
  "autolaunch chat join <subject-id>": { run: ({ parsedArgs, configPath }) => runAutolaunchChatJoin(parsedArgs, configPath) },
  "autolaunch dm <subject-id|address>": { run: ({ parsedArgs, configPath }) => runAutolaunchDm(parsedArgs, configPath) },
  "autolaunch dm list": { run: ({ parsedArgs, configPath }) => runAutolaunchDmList(parsedArgs, configPath) },
};
