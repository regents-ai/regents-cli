import { runAgentbookLookup, runAgentbookRegister, runAgentbookSessionsWatch } from "../commands/agentbook.js";
import { route, type CliRoute } from "./shared.js";

export const agentbookRoutes: readonly CliRoute[] = [
  route("agentbook register", async ({ parsedArgs, configPath }) => {
    await runAgentbookRegister(parsedArgs, configPath);
    return 0;
  }),
  route("agentbook sessions watch", async ({ parsedArgs, configPath }) => {
    await runAgentbookSessionsWatch(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("agentbook lookup", async ({ parsedArgs, configPath }) => {
    await runAgentbookLookup(parsedArgs, configPath);
    return 0;
  }),
];
