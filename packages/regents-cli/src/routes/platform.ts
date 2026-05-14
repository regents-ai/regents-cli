import {
  runPlatformAuthLogin,
  runPlatformAuthLogout,
  runPlatformAuthStatus,
  runPlatformBillingAccount,
  runPlatformBillingUsage,
  runPlatformCompanyRuntime,
  runPlatformFormationDoctor,
  runPlatformFormationStatus,
  runPlatformProjection,
} from "../commands/platform.js";
import { route, type CliRoute } from "./shared.js";

export const platformRoutes: readonly CliRoute[] = [
  route("platform auth login", async ({ parsedArgs }) => {
    await runPlatformAuthLogin(parsedArgs);
    return 0;
  }),
  route("platform auth status", async ({ parsedArgs }) => {
    await runPlatformAuthStatus(parsedArgs);
    return 0;
  }),
  route("platform auth logout", async ({ parsedArgs }) => {
    await runPlatformAuthLogout(parsedArgs);
    return 0;
  }),
  route("platform formation status", async ({ parsedArgs }) => {
    await runPlatformFormationStatus(parsedArgs);
    return 0;
  }),
  route("platform formation doctor", async ({ parsedArgs }) => {
    await runPlatformFormationDoctor(parsedArgs);
    return 0;
  }),
  route("platform projection", async ({ parsedArgs }) => {
    await runPlatformProjection(parsedArgs);
    return 0;
  }),
  route("platform billing account", async ({ parsedArgs }) => {
    await runPlatformBillingAccount(parsedArgs);
    return 0;
  }),
  route("platform billing usage", async ({ parsedArgs }) => {
    await runPlatformBillingUsage(parsedArgs);
    return 0;
  }),
  route("platform company runtime", async ({ parsedArgs }) => {
    await runPlatformCompanyRuntime(parsedArgs);
    return 0;
  }),
];
