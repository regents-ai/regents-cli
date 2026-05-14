import {
  runAuthSiwaLogin,
  runAuthSiwaLogout,
  runAuthSiwaStatus,
} from "../commands/auth.js";
import { runEnsSetPrimary } from "../commands/ens.js";
import { runIdentityEnsure, runIdentityGraph, runIdentityStatus } from "../commands/identity.js";
import {
  runWalletAgenticAddress,
  runWalletAgenticBalance,
  runWalletAgenticFund,
  runWalletAgenticGet,
  runWalletAgenticLogin,
  runWalletAgenticStatus,
  runWalletAgenticVerify,
} from "../commands/wallet-agentic.js";
import { runWalletSetup, runWalletStatus } from "../commands/wallet.js";
import { route, type CliRoute } from "./shared.js";

export const walletIdentityAuthRoutes: readonly CliRoute[] = [
  route("auth login", async ({ parsedArgs, configPath }) => {
    await runAuthSiwaLogin(parsedArgs, configPath);
    return 0;
  }),
  route("auth status", async ({ configPath }) => {
    await runAuthSiwaStatus(configPath);
    return 0;
  }),
  route("auth logout", async ({ configPath }) => {
    await runAuthSiwaLogout(configPath);
    return 0;
  }),
  route("identity ensure", async ({ parsedArgs, configPath }) => runIdentityEnsure(parsedArgs, configPath)),
  route("identity status", async ({ parsedArgs, configPath }) => runIdentityStatus(parsedArgs, configPath)),
  route("identity graph", async ({ parsedArgs }) => runIdentityGraph(parsedArgs)),
  route("wallet status", async ({ parsedArgs, configPath }) => runWalletStatus(parsedArgs, configPath)),
  route("wallet setup", async ({ parsedArgs, configPath }) => runWalletSetup(parsedArgs, configPath)),
  route("wallet agentic status", async ({ parsedArgs }) => runWalletAgenticStatus(parsedArgs)),
  route("wallet agentic login", async ({ parsedArgs }) => runWalletAgenticLogin(parsedArgs)),
  route("wallet agentic verify", async ({ parsedArgs }) => runWalletAgenticVerify(parsedArgs)),
  route("wallet agentic address", async ({ parsedArgs }) => runWalletAgenticAddress(parsedArgs)),
  route("wallet agentic balance", async ({ parsedArgs }) => runWalletAgenticBalance(parsedArgs)),
  route("wallet agentic get", async ({ parsedArgs }) => runWalletAgenticGet(parsedArgs)),
  route("wallet agentic fund", async ({ parsedArgs }) => runWalletAgenticFund(parsedArgs)),
  route("ens set-primary", async ({ parsedArgs, configPath }) => {
    await runEnsSetPrimary(parsedArgs, configPath);
    return 0;
  }),
];
