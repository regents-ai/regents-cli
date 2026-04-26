import { ANSI, CLI_PALETTE, escapePresentationLine, escapeTerminalText, isHumanTerminal, padRight, stripAnsi, tone } from "./palette.js";

const BORDER = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
} as const;

export const renderPanel = (
  title: string,
  lines: string[],
  options?: { borderColor?: string; titleColor?: string },
): string => {
  const safeTitle = escapeTerminalText(title);
  const safeLines = lines.map(escapePresentationLine);
  if (!isHumanTerminal()) {
    return [safeTitle, ...safeLines].join("\n");
  }

  const contentWidth = Math.max(stripAnsi(safeTitle).length, ...safeLines.map((line) => stripAnsi(line).length), 24);
  const horizontal = BORDER.horizontal.repeat(contentWidth + 2);
  const borderColor = options?.borderColor ?? CLI_PALETTE.chrome;
  const titleColor = options?.titleColor ?? CLI_PALETTE.title;

  const top = `${borderColor}${BORDER.topLeft}${BORDER.horizontal} ${tone(safeTitle, titleColor, true)} ${horizontal.slice(stripAnsi(safeTitle).length + 1)}${BORDER.topRight}${ANSI.reset}`;
  const body = safeLines.map((line) => `${borderColor}${BORDER.vertical}${ANSI.reset} ${padRight(line, contentWidth)} ${borderColor}${BORDER.vertical}${ANSI.reset}`);
  const bottom = `${borderColor}${BORDER.bottomLeft}${horizontal}${BORDER.bottomRight}${ANSI.reset}`;

  return [top, ...body, bottom].join("\n");
};
