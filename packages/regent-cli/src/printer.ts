import { RegentError } from "./internal-runtime/index.js";

const rgb = (r: number, g: number, b: number): string => `\x1b[38;2;${r};${g};${b}m`;

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  charcoalBlue: rgb(49, 85, 105),
  yaleBlue: rgb(3, 69, 104),
  ivoryMist: rgb(251, 244, 222),
  sunlitClay: rgb(212, 167, 86),
  greyOlive: rgb(132, 128, 120),
} as const;

export const CLI_PALETTE = {
  chrome: ANSI.charcoalBlue,
  title: ANSI.ivoryMist,
  accent: ANSI.sunlitClay,
  primary: ANSI.ivoryMist,
  secondary: ANSI.greyOlive,
  emphasis: ANSI.yaleBlue,
  error: ANSI.sunlitClay,
} as const;

const BORDER = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
} as const;

const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");

export const isHumanTerminal = (): boolean => Boolean(process.stdout.isTTY) && process.env.NO_COLOR !== "1";

export const tone = (value: string, color: string, bold = false): string => {
  const prefix = `${bold ? ANSI.bold : ""}${color}`;
  return `${prefix}${value}${ANSI.reset}`;
};

const padRight = (value: string, width: number): string => {
  const visible = stripAnsi(value).length;
  return visible >= width ? value : `${value}${" ".repeat(width - visible)}`;
};

export const renderPanel = (
  title: string,
  lines: string[],
  options?: { borderColor?: string; titleColor?: string },
): string => {
  const contentWidth = Math.max(stripAnsi(title).length, ...lines.map((line) => stripAnsi(line).length), 24);
  const horizontal = BORDER.horizontal.repeat(contentWidth + 2);
  const borderColor = options?.borderColor ?? CLI_PALETTE.chrome;
  const titleColor = options?.titleColor ?? CLI_PALETTE.title;

  const top = `${borderColor}${BORDER.topLeft}${BORDER.horizontal} ${tone(title, titleColor, true)} ${horizontal.slice(stripAnsi(title).length + 1)}${BORDER.topRight}${ANSI.reset}`;
  const body = lines.map((line) => `${borderColor}${BORDER.vertical}${ANSI.reset} ${padRight(line, contentWidth)} ${borderColor}${BORDER.vertical}${ANSI.reset}`);
  const bottom = `${borderColor}${BORDER.bottomLeft}${horizontal}${BORDER.bottomRight}${ANSI.reset}`;

  return [top, ...body, bottom].join("\n");
};

const highlightJsonLine = (line: string): string => {
  let highlighted = line;
  highlighted = highlighted.replace(/^(\s*)"([^"]+)":/u, (_, indent: string, key: string) =>
    `${indent}${tone(`"${key}"`, CLI_PALETTE.emphasis, true)}${tone(":", CLI_PALETTE.secondary)}`,
  );
  highlighted = highlighted.replace(/: ("(?:[^"\\]|\\.)*")/gu, (_match, value: string) => `: ${tone(value, CLI_PALETTE.primary)}`);
  highlighted = highlighted.replace(/: (-?\d+(?:\.\d+)?)/gu, (_match, value: string) => `: ${tone(value, CLI_PALETTE.accent, true)}`);
  highlighted = highlighted.replace(/: (true|false)\b/gu, (_match, value: string) => `: ${tone(value, CLI_PALETTE.emphasis, true)}`);
  highlighted = highlighted.replace(/: (null)\b/gu, (_match, value: string) => `: ${tone(value, CLI_PALETTE.secondary)}`);
  return highlighted;
};

const jsonTitle = (value: unknown): string => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.error) {
      return "◆ REGENT ERROR DECK";
    }
    if (record.usage) {
      return "◆ REGENT COMMAND DECK";
    }
    if (record.data) {
      return "◆ REGENT DATA DECK";
    }
  }

  return "◆ REGENT OUTPUT DECK";
};

const humanJson = (value: unknown): string => {
  const raw = JSON.stringify(value, null, 2).split("\n");
  const lines = raw.map((line) => (line.length > 0 ? highlightJsonLine(line) : ""));
  return renderPanel(jsonTitle(value), lines, {
    borderColor: CLI_PALETTE.chrome,
    titleColor: CLI_PALETTE.title,
  });
};

const renderUsageGroup = (title: string, commands: string[]): string[] => [
  tone(`▶ ${title}`, CLI_PALETTE.accent, true),
  ...commands.map((command) => `${tone("•", CLI_PALETTE.emphasis)} ${command}`),
  "",
];

export function renderUsageScreen(configPath: string): string {
  const lines = [
    tone("quiet operator shell for Regent", CLI_PALETTE.secondary),
    tone(`default config`, CLI_PALETTE.secondary) + ` ${tone(configPath, CLI_PALETTE.primary, true)}`,
    "",
    ...renderUsageGroup("Core", [
      "regent run",
      "regent create init",
      "regent create wallet",
      "regent doctor",
      "regent config read",
      "regent config write",
    ]),
    ...renderUsageGroup("Auth + Agent", [
      "regent auth siwa login",
      "regent auth siwa status",
      "regent auth siwa logout",
      "regent agent init",
      "regent agent status",
      "regent techtree identities list",
      "regent techtree identities mint",
    ]),
    ...renderUsageGroup("Techtree + BBH", [
      "regent techtree start",
      "regent techtree status",
      "regent techtree activity",
      "regent techtree search",
      "regent techtree nodes list",
      "regent techtree bbh run exec [path] --lane climb|benchmark|challenge",
      "regent techtree bbh submit [path]",
      "regent techtree bbh validate [path]",
      "regent techtree bbh leaderboard --lane benchmark",
      "regent techtree bbh sync",
    ]),
    ...renderUsageGroup("Messaging + Other", [
      "regent xmtp init",
      "regent xmtp status",
      "regent xmtp doctor",
      "regent autolaunch ...",
      "regent agentbook ...",
      "regent gossipsub status",
    ]),
    tone("tip", CLI_PALETTE.secondary, true) + " add " + tone("--config /absolute/path.json", CLI_PALETTE.primary, true) + " to pin a non-default config.",
  ];

  return renderPanel("◆ R E G E N T  S U R F A C E", lines, {
    borderColor: CLI_PALETTE.chrome,
    titleColor: CLI_PALETTE.title,
  });
}

export function printJson(value: unknown): void {
  if (isHumanTerminal()) {
    process.stdout.write(`${humanJson(value)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printText(text: string): void {
  process.stdout.write(`${text}\n`);
}

const renderErrorPanel = (message: string, code?: string): string =>
  renderPanel(
    "◆ REGENT ERROR",
    [
      ...(code
        ? [`${tone("code", CLI_PALETTE.secondary)} ${tone(code, CLI_PALETTE.error, true)}`]
        : []),
      `${tone("message", CLI_PALETTE.secondary)} ${tone(message, CLI_PALETTE.primary, true)}`,
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
