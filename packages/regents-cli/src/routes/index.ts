import { agentbookRoutes } from "./agentbook.js";
import { agentPlatformRoutes } from "./agent-platform.js";
import { autolaunchRoutes } from "./autolaunch.js";
import { chatboxRoutes } from "./chatbox.js";
import { coreRoutes } from "./core.js";
import { platformRoutes } from "./platform.js";
import { regentStakingRoutes } from "./regent-staking.js";
import { reportingRoutes } from "./reporting.js";
import { runtimeRoutes } from "./runtime.js";
import { assertRouteRegistryMatches, type CliRoute } from "./shared.js";
import { techtreeRoutes } from "./techtree.js";
import { walletIdentityAuthRoutes } from "./wallet-identity-auth.js";
import { workRoutes } from "./work.js";
import { xmtpRoutes } from "./xmtp.js";

export { dispatchRoute, type CliRouteContext } from "./shared.js";

export const cliRoutes: readonly CliRoute[] = [
  ...coreRoutes,
  ...workRoutes,
  ...runtimeRoutes,
  ...agentPlatformRoutes,
  ...reportingRoutes,
  ...walletIdentityAuthRoutes,
  ...platformRoutes,
  ...techtreeRoutes,
  ...regentStakingRoutes,
  ...xmtpRoutes,
  ...agentbookRoutes,
  ...chatboxRoutes,
  ...autolaunchRoutes,
] as const;

assertRouteRegistryMatches(cliRoutes);
