import {
  runRuntimeCheckpoint,
  runRuntimeCreate,
  runRuntimeHealth,
  runRuntimePause,
  runRuntimeRestore,
  runRuntimeResume,
  runRuntimeServices,
  runRuntimeGet,
} from "../commands/runtime.js";
import {
  runRuntimeLocalPolicy,
  runRuntimeLocalStatus,
  runRuntimeLocalTools,
} from "../commands/runtime-local.js";
import { route, type CliRoute } from "./shared.js";

export const runtimeRoutes: readonly CliRoute[] = [
  route("runtime status", async ({ configPath }) => runRuntimeLocalStatus(configPath)),
  route("runtime tools", async () => runRuntimeLocalTools()),
  route("runtime policy", async ({ configPath }) => runRuntimeLocalPolicy(configPath)),
  route("runtime create", async ({ parsedArgs }) => {
    await runRuntimeCreate(parsedArgs);
    return 0;
  }),
  route("runtime get", async ({ parsedArgs }) => {
    await runRuntimeGet(parsedArgs);
    return 0;
  }, { variadicTail: true }),
  route("runtime checkpoint", async ({ parsedArgs }) => {
    await runRuntimeCheckpoint(parsedArgs);
    return 0;
  }, { variadicTail: true }),
  route("runtime restore", async ({ parsedArgs }) => {
    await runRuntimeRestore(parsedArgs);
    return 0;
  }, { variadicTail: true }),
  route("runtime pause", async ({ parsedArgs }) => {
    await runRuntimePause(parsedArgs);
    return 0;
  }, { variadicTail: true }),
  route("runtime resume", async ({ parsedArgs }) => {
    await runRuntimeResume(parsedArgs);
    return 0;
  }, { variadicTail: true }),
  route("runtime services", async ({ parsedArgs }) => {
    await runRuntimeServices(parsedArgs);
    return 0;
  }, { variadicTail: true }),
  route("runtime health", async ({ parsedArgs }) => {
    await runRuntimeHealth(parsedArgs);
    return 0;
  }, { variadicTail: true }),
];
