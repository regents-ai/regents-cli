import {
  runTechtreeNotebooksInit,
  runTechtreeNotebooksPair,
} from "../commands/techtree-notebooks.js";
import type { CliHandlerRegistry } from "./shared.js";

export const techtreeHandlers: CliHandlerRegistry = {
  "techtree notebooks init": {
    run: ({ parsedArgs, configPath }) => runTechtreeNotebooksInit(parsedArgs, configPath),
  },
  "techtree notebooks pair": {
    run: ({ parsedArgs, configPath }) => runTechtreeNotebooksPair(parsedArgs, configPath),
  },
};
