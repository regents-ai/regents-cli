import {
  runRuntimeCheckpoint,
  runRuntimeCreate,
  runRuntimeHealth,
  runRuntimePause,
  runRuntimeRestore,
  runRuntimeResume,
  runRuntimeServices,
  runRuntimeShow,
} from "../commands/runtime.js";
import { route, type CliRoute } from "./shared.js";

export const runtimeRoutes: readonly CliRoute[] = [
  route("runtime create", async ({ parsedArgs }) => {
    await runRuntimeCreate(parsedArgs);
    return 0;
  }),
  route("runtime show", async ({ parsedArgs }) => {
    await runRuntimeShow(parsedArgs);
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
