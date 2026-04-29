import {
  runWorkCreate,
  runWorkList,
  runWorkLocalLoop,
  runWorkRun,
  runWorkShow,
  runWorkWatch,
} from "../commands/work.js";
import { route, type CliRoute } from "./shared.js";

export const workRoutes: readonly CliRoute[] = [
  route("work create", async ({ parsedArgs }) => {
    await runWorkCreate(parsedArgs);
    return 0;
  }),
  route("work list", async ({ parsedArgs }) => {
    await runWorkList(parsedArgs);
    return 0;
  }),
  route("work local-loop", async ({ parsedArgs }) => {
    await runWorkLocalLoop(parsedArgs);
    return 0;
  }),
  route("work show", async ({ parsedArgs }) => {
    await runWorkShow(parsedArgs);
    return 0;
  }, { variadicTail: true }),
  route("work run", async ({ parsedArgs }) => {
    await runWorkRun(parsedArgs);
    return 0;
  }, { variadicTail: true }),
  route("work watch", async ({ parsedArgs }) => {
    await runWorkWatch(parsedArgs);
    return 0;
  }, { variadicTail: true }),
];
