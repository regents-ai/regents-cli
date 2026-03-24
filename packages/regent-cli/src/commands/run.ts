import { RegentRuntime } from "../internal-runtime/index.js";

import { printJson } from "../printer.js";

export async function runRuntime(configPath?: string): Promise<void> {
  const runtime = new RegentRuntime(configPath);
  await runtime.start();
  printJson({ ok: true, socketPath: runtime.config.runtime.socketPath });

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const onSignal = (): void => {
      void stop();
    };

    const finish = (error?: unknown): void => {
      if (settled) {
        return;
      }

      settled = true;
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    const stop = async (): Promise<void> => {
      try {
        await runtime.stop();
        finish();
      } catch (error) {
        finish(error);
      }
    };

    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}
