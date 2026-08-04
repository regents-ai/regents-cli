import {
  runTechtreeForgeFamilyShow,
  runTechtreeForgeFamilyValidate,
} from "../commands/techtree-forge.js";
import {
  runTechtreeNotebooksInit,
  runTechtreeNotebooksPair,
} from "../commands/techtree-notebooks.js";
import type { CliHandlerRegistry } from "./shared.js";

export const techtreeHandlers: CliHandlerRegistry = {
  "techtree forge family show": { run: () => runTechtreeForgeFamilyShow() },
  "techtree forge family validate": {
    run: ({ parsedArgs }) => runTechtreeForgeFamilyValidate(parsedArgs),
  },
  "techtree notebooks init": {
    run: ({ parsedArgs, configPath }) => runTechtreeNotebooksInit(parsedArgs, configPath),
  },
  "techtree notebooks pair": {
    run: ({ parsedArgs, configPath }) => runTechtreeNotebooksPair(parsedArgs, configPath),
  },
};
