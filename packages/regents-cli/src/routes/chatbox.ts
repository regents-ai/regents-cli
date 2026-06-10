import { runChatboxHistory, runChatboxPost, runChatboxTail } from "../commands/chatbox.js";
import type { CliHandlerRegistry } from "./shared.js";

export const chatboxHandlers: CliHandlerRegistry = {
  "chatbox history": { run: ({ parsedArgs, configPath }) => runChatboxHistory(parsedArgs, configPath) },
  "chatbox tail": { run: ({ parsedArgs, configPath }) => runChatboxTail(parsedArgs, configPath) },
  "chatbox post": { run: ({ parsedArgs, configPath }) => runChatboxPost(parsedArgs, configPath) },
};
