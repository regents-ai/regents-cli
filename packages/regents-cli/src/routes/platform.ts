import {
  runPlatformAuthLogin,
  runPlatformAuthLogout,
  runPlatformAuthStatus,
  runPlatformBillingAccount,
  runPlatformBillingSpendControlsSet,
  runPlatformBillingUsage,
  runPlatformCompanyRuntime,
  runPlatformFormationDoctor,
  runPlatformFormationStatus,
  runPlatformProjection,
} from "../commands/platform.js";
import type { CliHandlerRegistry } from "./shared.js";

export const platformHandlers: CliHandlerRegistry = {
  "platform auth login": { run: ({ parsedArgs }) => runPlatformAuthLogin(parsedArgs) },
  "platform auth status": { run: ({ parsedArgs }) => runPlatformAuthStatus(parsedArgs) },
  "platform auth logout": { run: ({ parsedArgs }) => runPlatformAuthLogout(parsedArgs) },
  "platform formation status": { run: ({ parsedArgs }) => runPlatformFormationStatus(parsedArgs) },
  "platform formation doctor": { run: ({ parsedArgs }) => runPlatformFormationDoctor(parsedArgs) },
  "platform projection": { run: ({ parsedArgs }) => runPlatformProjection(parsedArgs) },
  "platform billing account": { run: ({ parsedArgs }) => runPlatformBillingAccount(parsedArgs) },
  "platform billing usage": { run: ({ parsedArgs }) => runPlatformBillingUsage(parsedArgs) },
  "platform billing spend-controls set": { run: ({ parsedArgs }) => runPlatformBillingSpendControlsSet(parsedArgs) },
  "platform company runtime": { run: ({ parsedArgs }) => runPlatformCompanyRuntime(parsedArgs) },
};
