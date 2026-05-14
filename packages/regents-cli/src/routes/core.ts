import {
  runAgentHarnessList,
  runAgentInit,
  runAgentProfileList,
  runAgentProfileGet,
  runAgentStatus,
} from "../commands/agent.js";
import { runAgentContext } from "../commands/agent-context.js";
import { runBudgetGrant, runBudgetLedger, runBudgetRevoke, runBudgetStatus } from "../commands/budget.js";
import { runConfigGet, runConfigWrite } from "../commands/config.js";
import { runCreateInit, runCreateWallet } from "../commands/create.js";
import { runDoctorCommand, runDoctorContractsCommand, runDoctorWorkspaceCommand } from "../commands/doctor.js";
import { runGossipsubStatus } from "../commands/gossipsub.js";
import {
  runMcpDoctor,
  runMcpExportCodex,
  runMcpExportHermes,
  runMcpServe,
  runMcpToolsList,
} from "../commands/mcp.js";
import {
  runOperatorBalance,
  runOperatorInit,
  runOperatorSearch,
  runOperatorStatus,
  runOperatorWhoami,
} from "../commands/operator.js";
import { runPluginDoctor, runPluginInstall, runPluginStatus } from "../commands/plugin.js";
import { runReceiptCreate, runReceiptGet, runReceiptList, runReceiptShareDraft } from "../commands/receipt.js";
import { runRuntime } from "../commands/run.js";
import { runSetup } from "../commands/setup.js";
import { runSetupSkills } from "../commands/setup-skills.js";
import {
  runX402Details,
  runX402Fetch,
  runX402Pay,
  runX402Prepare,
  runX402Quote,
  runX402ReceiptsGet,
  runX402Refund,
  runX402Search,
} from "../commands/x402.js";
import { route, type CliRoute } from "./shared.js";

export const coreRoutes: readonly CliRoute[] = [
  route("init", async ({ parsedArgs, configPath }) => runOperatorInit(parsedArgs, configPath)),
  route("status", async ({ parsedArgs, configPath }) => runOperatorStatus(parsedArgs, configPath)),
  route("whoami", async ({ parsedArgs, configPath }) => runOperatorWhoami(parsedArgs, configPath)),
  route("balance", async ({ parsedArgs, configPath }) => runOperatorBalance(parsedArgs, configPath)),
  route("agent-context", async ({ configPath }) => {
    await runAgentContext(configPath);
    return 0;
  }),
  route("setup", async ({ parsedArgs }) => {
    await runSetup(parsedArgs);
    return 0;
  }),
  route("plugin status", async ({ parsedArgs }) => {
    await runPluginStatus(parsedArgs);
    return 0;
  }),
  route("plugin install", async ({ parsedArgs }) => {
    await runPluginInstall(parsedArgs);
    return 0;
  }),
  route("plugin doctor", async ({ parsedArgs }) => {
    await runPluginDoctor(parsedArgs);
    return 0;
  }),
  route("setup skills", async ({ parsedArgs }) => {
    await runSetupSkills(parsedArgs);
    return 0;
  }),
  route("search", async ({ parsedArgs, configPath }) => runOperatorSearch(parsedArgs, configPath), { variadicTail: true }),
  route("run", async ({ parsedArgs, configPath }) => {
    await runRuntime(parsedArgs, configPath);
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
  route("config get", async ({ parsedArgs }) => {
    await runConfigGet(parsedArgs);
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
  route("doctor workspace", async ({ parsedArgs, configPath }) => runDoctorWorkspaceCommand(parsedArgs, configPath)),
  route("doctor", async ({ parsedArgs, configPath }) => runDoctorCommand(parsedArgs, configPath), { variadicTail: true }),
  route("mcp export hermes", async ({ parsedArgs }) => {
    await runMcpExportHermes(parsedArgs);
    return 0;
  }),
  route("mcp export codex", async () => runMcpExportCodex()),
  route("mcp tools list", async () => runMcpToolsList()),
  route("mcp doctor", async ({ parsedArgs, configPath }) => runMcpDoctor(parsedArgs, configPath)),
  route("mcp serve", async ({ parsedArgs, configPath }) => runMcpServe(parsedArgs, configPath)),
  route("x402 search", async ({ parsedArgs }) => runX402Search(parsedArgs), { variadicTail: true }),
  route("x402 details", async ({ parsedArgs, configPath }) => runX402Details(parsedArgs, configPath)),
  route("x402 quote", async ({ parsedArgs, configPath }) => runX402Quote(parsedArgs, configPath)),
  route("x402 prepare", async ({ parsedArgs, configPath }) => runX402Prepare(parsedArgs, configPath)),
  route("x402 fetch", async ({ parsedArgs, configPath }) => runX402Fetch(parsedArgs, configPath)),
  route("x402 refund", async ({ parsedArgs, configPath }) => runX402Refund(parsedArgs, configPath)),
  route("x402 pay", async ({ parsedArgs, configPath }) => runX402Pay(parsedArgs, configPath), { pattern: "x402 pay <url>" }),
  route("x402 receipts get", async ({ parsedArgs, configPath }) => runX402ReceiptsGet(parsedArgs, configPath)),
  route("budget grant", async ({ parsedArgs, configPath }) => runBudgetGrant(parsedArgs, configPath)),
  route("budget status", async ({ parsedArgs, configPath }) => runBudgetStatus(parsedArgs, configPath)),
  route("budget ledger", async ({ parsedArgs, configPath }) => runBudgetLedger(parsedArgs, configPath)),
  route("budget revoke", async ({ parsedArgs, configPath }) => runBudgetRevoke(parsedArgs, configPath)),
  route("receipt create", async ({ parsedArgs, configPath }) => runReceiptCreate(parsedArgs, configPath)),
  route("receipt get", async ({ parsedArgs, configPath }) => runReceiptGet(parsedArgs, configPath)),
  route("receipt list", async ({ parsedArgs, configPath }) => runReceiptList(parsedArgs, configPath)),
  route("receipt share-draft", async ({ parsedArgs, configPath }) => runReceiptShareDraft(parsedArgs, configPath)),
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
  route("agent profile get", async ({ parsedArgs, configPath }) => {
    await runAgentProfileGet(parsedArgs, configPath);
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
