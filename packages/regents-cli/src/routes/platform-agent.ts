import {
  runAgentConnectHermes,
  runAgentConnectOpenClaw,
  runAgentExecutionPool,
  runAgentLink,
} from "../commands/platform/agent-link.js";
import type { CliHandlerRegistry } from "./shared.js";

export const platformAgentHandlers: CliHandlerRegistry = {
  "agent connect hermes": {
    run: ({ parsedArgs, configPath }) => runAgentConnectHermes(parsedArgs, configPath),
  },
  "agent connect openclaw": {
    run: ({ parsedArgs, configPath }) => runAgentConnectOpenClaw(parsedArgs, configPath),
  },
  "agent link": { run: ({ parsedArgs }) => runAgentLink(parsedArgs) },
  "agent execution-pool": { run: ({ parsedArgs }) => runAgentExecutionPool(parsedArgs) },
};
