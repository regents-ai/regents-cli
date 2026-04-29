import {
  runAgentHarnessList,
  runAgentInit,
  runAgentProfileList,
  runAgentProfileShow,
  runAgentStatus,
} from "../commands/agent.js";
import { runConfigRead, runConfigWrite } from "../commands/config.js";
import { runCreateInit, runCreateWallet } from "../commands/create.js";
import { runDoctorCommand, runDoctorContractsCommand } from "../commands/doctor.js";
import { runGossipsubStatus } from "../commands/gossipsub.js";
import { runMcpExportHermes } from "../commands/mcp.js";
import {
  runOperatorBalance,
  runOperatorInit,
  runOperatorSearch,
  runOperatorStatus,
  runOperatorWhoami,
} from "../commands/operator.js";
import { runRuntime } from "../commands/run.js";
import { route, type CliRoute } from "./shared.js";

export const coreRoutes: readonly CliRoute[] = [
  route("init", async ({ parsedArgs, configPath }) => runOperatorInit(parsedArgs, configPath)),
  route("status", async ({ parsedArgs, configPath }) => runOperatorStatus(parsedArgs, configPath)),
  route("whoami", async ({ parsedArgs, configPath }) => runOperatorWhoami(parsedArgs, configPath)),
  route("balance", async ({ parsedArgs, configPath }) => runOperatorBalance(parsedArgs, configPath)),
  route("search", async ({ parsedArgs, configPath }) => runOperatorSearch(parsedArgs, configPath), { variadicTail: true }),
  route("run", async ({ configPath }) => {
    await runRuntime(configPath);
    return 0;
  }),
  route("create init", async ({ parsedArgs }) => {
    await runCreateInit(parsedArgs);
    return 0;
  }),
  route("create wallet", async ({ parsedArgs }) => {
    await runCreateWallet(parsedArgs);
    return 0;
  }),
  route("config read", async ({ parsedArgs }) => {
    await runConfigRead(parsedArgs);
    return 0;
  }),
  route("config write", async ({ parsedArgs }) => {
    await runConfigWrite(parsedArgs);
    return 0;
  }),
  route("doctor runtime", async ({ parsedArgs, configPath }) => runDoctorCommand(parsedArgs, configPath)),
  route("doctor auth", async ({ parsedArgs, configPath }) => runDoctorCommand(parsedArgs, configPath)),
  route("doctor techtree", async ({ parsedArgs, configPath }) => runDoctorCommand(parsedArgs, configPath)),
  route("doctor transports", async ({ parsedArgs, configPath }) => runDoctorCommand(parsedArgs, configPath)),
  route("doctor xmtp", async ({ parsedArgs, configPath }) => runDoctorCommand(parsedArgs, configPath)),
  route("doctor contracts", async ({ parsedArgs, configPath }) => runDoctorContractsCommand(parsedArgs, configPath)),
  route("doctor", async ({ parsedArgs, configPath }) => runDoctorCommand(parsedArgs, configPath), { variadicTail: true }),
  route("mcp export hermes", async ({ parsedArgs }) => {
    await runMcpExportHermes(parsedArgs);
    return 0;
  }),
  route("agent init", async ({ configPath }) => {
    await runAgentInit(configPath);
    return 0;
  }),
  route("agent status", async ({ configPath }) => {
    await runAgentStatus(configPath);
    return 0;
  }),
  route("agent profile list", async ({ configPath }) => {
    await runAgentProfileList(configPath);
    return 0;
  }),
  route("agent profile show", async ({ parsedArgs, configPath }) => {
    await runAgentProfileShow(parsedArgs, configPath);
    return 0;
  }),
  route("agent harness list", async ({ configPath }) => {
    await runAgentHarnessList(configPath);
    return 0;
  }),
  route("gossipsub status", async ({ configPath }) => {
    await runGossipsubStatus(configPath);
    return 0;
  }),
];
