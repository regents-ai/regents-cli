import { RegentError } from "../internal-runtime/index.js";

import { renderPanel } from "./panel.js";
import { CLI_PALETTE, escapeTerminalText, isHumanTerminal, tone } from "./palette.js";

const renderErrorPanel = (message: string, code?: string): string =>
  renderPanel(
    "◆ REGENT ERROR",
    [
      ...(code
        ? [`${tone("code", CLI_PALETTE.secondary)} ${tone(escapeTerminalText(code), CLI_PALETTE.error, true)}`]
        : []),
      `${tone("message", CLI_PALETTE.secondary)} ${tone(escapeTerminalText(message), CLI_PALETTE.primary, true)}`,
      `${tone("next", CLI_PALETTE.secondary)} ${tone("regents --help", CLI_PALETTE.emphasis, true)}`,
    ],
    { borderColor: CLI_PALETTE.error, titleColor: CLI_PALETTE.title },
  );

const errorPayload = (message: string, code?: string): Record<string, { code?: string; message: string }> => ({
  error: {
    ...(code ? { code } : {}),
    message,
  },
});

export function printError(error: unknown): void {
  if (error instanceof RegentError) {
    if (isHumanTerminal()) {
      process.stderr.write(`${renderErrorPanel(error.message, error.code)}\n`);
      return;
    }

    process.stderr.write(`${JSON.stringify(errorPayload(error.message, error.code), null, 2)}\n`);
    return;
  }

  if (error instanceof Error) {
    if (isHumanTerminal()) {
      process.stderr.write(`${renderErrorPanel(error.message)}\n`);
      return;
    }

    process.stderr.write(`${JSON.stringify(errorPayload(error.message), null, 2)}\n`);
    return;
  }

  const fallbackMessage = String(error);
  if (isHumanTerminal()) {
    process.stderr.write(`${renderErrorPanel(fallbackMessage)}\n`);
    return;
  }

  process.stderr.write(`${JSON.stringify(errorPayload(fallbackMessage), null, 2)}\n`);
}
