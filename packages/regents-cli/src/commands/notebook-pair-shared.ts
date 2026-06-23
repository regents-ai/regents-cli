import { spawn } from "node:child_process";
import { buildSafeSubprocessEnv } from "../internal-runtime/safe-subprocess-env.js";
import { getBooleanFlag, type ParsedCliArgs } from "../parse.js";
import { isHumanTerminal } from "../printer.js";

export interface NotebookPairLaunchable {
  workspace_path: string;
  launch_argv: string[];
}

export async function maybeLaunchNotebook(
  args: ParsedCliArgs,
  result: NotebookPairLaunchable,
): Promise<void> {
  if (!isHumanTerminal() || getBooleanFlag(args, "no-open")) {
    return;
  }

  const [command, ...commandArgs] = result.launch_argv;

  if (!command) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: result.workspace_path,
      stdio: "inherit",
      env: buildSafeSubprocessEnv(),
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `unable to launch marimo editor: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });

    child.on("close", (code) => {
      if ((code ?? 0) === 0) {
        resolve();
        return;
      }

      reject(new Error(`marimo editor exited with code ${code ?? 1}`));
    });
  });
}
