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

const padLeft = (value: string, width: number): string => {
  const visible = stripAnsi(value).length;
  return visible >= width ? value : `${" ".repeat(width - visible)}${value}`;
};

const padCenter = (value: string, width: number): string => {
  const visible = stripAnsi(value).length;
  if (visible >= width) {
    return value;
  }

  const totalPadding = width - visible;
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  return `${" ".repeat(leftPadding)}${value}${" ".repeat(rightPadding)}`;
};

const alignCell = (value: string, width: number, align: "left" | "right" | "center" = "left"): string => {
  if (align === "right") {
    return padLeft(value, width);
  }

  if (align === "center") {
    return padCenter(value, width);
  }

  return padRight(value, width);
};

export interface KeyValueRow {
  label: string;
  value: string;
  labelColor?: string;
  valueColor?: string;
}

export interface TableColumn {
  header: string;
  align?: "left" | "right" | "center";
  color?: string;
  minWidth?: number;
}

export interface TableRow {
  cells: readonly string[];
  colors?: readonly (string | undefined)[];
}

export const renderKeyValueLines = (rows: readonly KeyValueRow[]): string[] => {
  const labelWidth = rows.reduce((max, row) => Math.max(max, stripAnsi(row.label).length), 0);
  return rows.map((row) => {
    const label = tone(row.label, row.labelColor ?? CLI_PALETTE.secondary, true);
    const value = tone(row.value, row.valueColor ?? CLI_PALETTE.primary, row.valueColor === CLI_PALETTE.error);
    return `${alignCell(label, labelWidth, "right")}  ${value}`;
  });
};

export const renderKeyValuePanel = (
  title: string,
  rows: readonly KeyValueRow[],
  options?: { borderColor?: string; titleColor?: string },
): string => renderPanel(title, renderKeyValueLines(rows), options);

export const renderTablePanel = (
  title: string,
  columns: readonly TableColumn[],
  rows: readonly TableRow[],
  options?: { borderColor?: string; titleColor?: string },
): string => {
  const widths = columns.map((column, index) => {
    const headerWidth = stripAnsi(column.header).length;
    const rowWidths = rows.map((row) => stripAnsi(row.cells[index] ?? "").length);
    return Math.max(column.minWidth ?? 0, headerWidth, ...rowWidths, 3);
  });

  const header = columns
    .map((column, index) => alignCell(tone(column.header, column.color ?? CLI_PALETTE.title, true), widths[index] ?? 3, column.align))
    .join(" │ ");
  const separator = widths.map((width) => "─".repeat(width)).join("─┼─");
  const body = rows.map((row) =>
    columns
      .map((column, index) => {
        const cell = row.cells[index] ?? "";
        const cellColor = row.colors?.[index] ?? column.color ?? CLI_PALETTE.primary;
        return alignCell(tone(cell, cellColor), widths[index] ?? 3, column.align);
      })
      .join(" │ "),
  );

  return renderPanel(title, [header, separator, ...body], options);
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

const summarizeRecord = (value: unknown): KeyValueRow[] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const record = value as Record<string, unknown>;
  const rows: KeyValueRow[] = [];
  const addRow = (label: string, raw: unknown, options?: { labelColor?: string; valueColor?: string }): void => {
    if (raw === undefined || raw === null) {
      return;
    }

    rows.push({
      label,
      value: typeof raw === "string" ? raw : JSON.stringify(raw),
      ...(options?.labelColor ? { labelColor: options.labelColor } : {}),
      ...(options?.valueColor ? { valueColor: options.valueColor } : {}),
    });
  };

  if (typeof record.ok === "boolean") {
    addRow("ok", record.ok ? "yes" : "no", {
      valueColor: record.ok ? CLI_PALETTE.emphasis : CLI_PALETTE.error,
    });
  }
  addRow("status", typeof record.status === "string" ? record.status : undefined, {
    valueColor:
      record.status === "error" || record.status === "failed"
        ? CLI_PALETTE.error
        : record.status === "ready" || record.status === "ok"
          ? CLI_PALETTE.emphasis
          : CLI_PALETTE.primary,
  });
  addRow("mode", typeof record.mode === "string" ? record.mode : undefined);
  addRow("scope", typeof record.scope === "string" ? record.scope : undefined);
  addRow("state", typeof record.state === "string" ? record.state : undefined);
  addRow("network", typeof record.network === "string" ? record.network : undefined);
  addRow("provider", typeof record.provider === "string" ? record.provider : undefined);
  addRow("address", typeof record.address === "string" ? record.address : undefined);
  addRow("state dir", typeof record.stateDir === "string" ? record.stateDir : undefined);
  addRow("socket", typeof record.socketPath === "string" ? record.socketPath : undefined);
  addRow("socket dir", typeof record.socketDir === "string" ? record.socketDir : undefined);
  addRow("config", typeof record.configPath === "string" ? record.configPath : undefined);
  addRow("config created", typeof record.configCreated === "boolean" ? (record.configCreated ? "yes" : "no") : undefined);
  addRow("keystore dir", typeof record.keystoreDir === "string" ? record.keystoreDir : undefined);
  addRow("gossipsub dir", typeof record.gossipsubDir === "string" ? record.gossipsubDir : undefined);
  addRow("xmtp dir", typeof record.xmtpDir === "string" ? record.xmtpDir : undefined);
  addRow("xmtp policy", typeof record.xmtpPolicyDir === "string" ? record.xmtpPolicyDir : undefined);
  addRow("dev file", typeof record.devFile === "string" ? record.devFile : undefined);
  addRow("session", typeof record.session_id === "string" ? record.session_id : undefined);
  addRow("registry", typeof record.registry_address === "string" ? record.registry_address : undefined);
  addRow("token", typeof record.token_id === "string" ? record.token_id : undefined);
  addRow("chain", typeof record.chain_id === "number" ? String(record.chain_id) : undefined);
  addRow("tx", typeof record.tx_hash === "string" ? record.tx_hash : undefined);
  addRow("export", typeof record.export === "string" ? record.export : undefined);
  addRow("generated", typeof record.generated_at === "string" ? record.generated_at : undefined);
  addRow("created", typeof record.created_at === "string" ? record.created_at : undefined);

  if (record.summary && typeof record.summary === "object" && !Array.isArray(record.summary)) {
    const summary = record.summary as Record<string, unknown>;
    addRow("summary ok", typeof summary.ok === "number" ? String(summary.ok) : undefined);
    addRow("summary warn", typeof summary.warn === "number" ? String(summary.warn) : undefined);
    addRow("summary fail", typeof summary.fail === "number" ? String(summary.fail) : undefined);
    addRow("summary skip", typeof summary.skip === "number" ? String(summary.skip) : undefined);
  }

  if (Array.isArray(record.next_steps) && record.next_steps.length > 0) {
    addRow("next", String(record.next_steps[0]));
  }

  if (record.next_action && typeof record.next_action === "object" && !Array.isArray(record.next_action)) {
    const nextAction = record.next_action as Record<string, unknown>;
    if (typeof nextAction.command === "string") {
      addRow("next", nextAction.command);
    }
    if (typeof nextAction.reason === "string") {
      addRow("reason", nextAction.reason, { labelColor: CLI_PALETTE.secondary });
    }
  }

  if (record.session && typeof record.session === "object" && !Array.isArray(record.session)) {
    const session = record.session as Record<string, unknown>;
    addRow("session status", typeof session.status === "string" ? session.status : undefined);
    addRow("session id", typeof session.session_id === "string" ? session.session_id : undefined);
    addRow("session approval", typeof session.approval_url === "string" ? session.approval_url : undefined);
    addRow("session expires", typeof session.expires_at === "string" ? session.expires_at : undefined);
  }

  if (record.error && typeof record.error === "object" && !Array.isArray(record.error)) {
    const error = record.error as Record<string, unknown>;
    addRow("error code", typeof error.code === "string" ? error.code : undefined, {
      valueColor: CLI_PALETTE.error,
    });
    addRow("error message", typeof error.message === "string" ? error.message : undefined, {
      valueColor: CLI_PALETTE.error,
    });
  }

  return rows;
};

const humanJson = (value: unknown): string => {
  const raw = JSON.stringify(value, null, 2).split("\n");
  const lines = raw.map((line) => (line.length > 0 ? highlightJsonLine(line) : ""));
  const summaryRows = summarizeRecord(value);
  const summaryPanel = summaryRows.length > 0 ? renderKeyValuePanel("◆ REGENT SUMMARY", summaryRows) : undefined;
  const payloadPanel = renderPanel(jsonTitle(value), lines, {
    borderColor: CLI_PALETTE.chrome,
    titleColor: CLI_PALETTE.title,
  });

  return summaryPanel ? `${summaryPanel}\n\n${payloadPanel}` : payloadPanel;
};

export function renderUsageScreen(configPath: string): string {
  const lines = [
    tone("local control layer for Regent", CLI_PALETTE.secondary),
    `${tone("default config", CLI_PALETTE.secondary)} ${tone(configPath, CLI_PALETTE.primary, true)}`,
    "",
    tone("start with the guided path", CLI_PALETTE.accent, true),
    "use regents.sh/services for guided setup, billing, claimed names, and company launch",
    "use regents techtree start for most Techtree setups",
    "it checks local config, the runtime, identity, Techtree readiness, and BBH readiness",
    "",
    tone("if you know the job already", CLI_PALETTE.secondary, true),
    "drop to the lower-level commands only when you need tighter control",
    "if this is not the page you expected, check the command spelling or run `regents --help`",
  ];

  return [
    renderPanel("◆ R E G E N T   C L I", lines, {
      borderColor: CLI_PALETTE.chrome,
      titleColor: CLI_PALETTE.title,
    }),
    renderPanel("◆ START HERE", [
      "regents techtree start",
      "regents run",
      "regents create init",
      "regents create wallet",
      "regents doctor",
      "regents config read",
      "regents config write",
    ]),
    renderPanel("◆ IDENTITY + SETUP", [
      "regents identity ensure",
      "regents agent init",
      "regents agent status",
      "regents techtree identities list",
      "regents techtree identities mint",
    ]),
    renderPanel("◆ TECHTREE", [
      "regents techtree status",
      "regents techtree activity",
      "regents techtree search",
      "regents techtree nodes list",
      "regents techtree node lineage list <id>",
      "regents techtree node lineage claim <id> --input @file.json",
      "regents techtree node lineage withdraw <id> --claim-id <claim-id>",
      "regents techtree node cross-chain-links list <id>",
      "regents techtree node cross-chain-links create <id> --input @file.json",
      "regents techtree node cross-chain-links clear <id>",
      "regents techtree node create ... [--cross-chain-link @file.json] [--paid-payload @file.json]",
      "regents techtree comment add --node-id <id> --body-markdown ...",
      "regents techtree science-tasks list [--limit 20] [--stage draft]",
      "regents techtree science-tasks get <id>",
      "regents techtree science-tasks init --workspace-path ... --title ...",
      "regents techtree science-tasks export --workspace-path ... [--output-path ...]",
      "regents techtree autoskill init skill [path]",
      "regents techtree autoskill notebook pair [path]",
      "regents techtree autoskill publish skill [path]",
      "regents techtree autoskill publish eval [path]",
      "regents techtree autoskill publish result [path] --skill-node-id ... --eval-node-id ...",
      "regents techtree autoskill review --kind community|replicable --skill-node-id ...",
      "regents techtree autoskill listing create --skill-node-id ... --price-usdc ...",
      "regents techtree autoskill buy <node-id>",
      "regents techtree autoskill pull <node-id> [path]",
      "regents chatbox history --webapp|--agent",
      "regents chatbox tail --webapp|--agent",
      "regents chatbox post --body ...",
    ]),
    renderPanel("◆ BBH LOOP", [
      "regents techtree bbh capsules list [--lane climb|benchmark|challenge]",
      "regents techtree bbh capsules get <capsule-id>",
      "regents techtree bbh run exec [path] --capsule <capsule-id> [--lane climb|benchmark|challenge]",
      "regents techtree bbh notebook pair [path]",
      "regents techtree bbh run solve [path] --solver hermes|openclaw|skydiscover",
      "regents techtree bbh draft init [path]",
      "regents techtree bbh draft create [path] --title ...",
      "regents techtree bbh genome init [path] [--lane climb|benchmark|challenge] [--sample-size 3] [--budget 6]",
      "regents techtree bbh genome score [path]",
      "regents techtree bbh genome improve [path]",
      "regents techtree bbh genome propose <capsule-id> [path]",
      "regents techtree reviewer orcid link",
      "regents techtree review list --kind certification",
      "regents techtree certificate verify <capsule-id>",
      "regents techtree bbh submit [path]",
      "regents techtree bbh validate [path]",
      "regents techtree bbh leaderboard --lane benchmark",
      "regents techtree bbh sync",
    ]),
    renderPanel("◆ MESSAGING + ADJACENT WORK", [
      "regents bug --summary \"can't do xyz\" --details \"any more details here\"",
      "regents security-report --summary \"private vuln\" --details \"steps and impact\" --contact \"@xyz on telegram\"",
      "regents xmtp init",
      "regents xmtp status",
      "regents xmtp group permissions <conversation-id>",
      "regents xmtp group update-permission <conversation-id> --type add-member --policy admin",
      "regents xmtp group add-admin <conversation-id> --address <wallet>",
      "regents xmtp doctor",
      "regents autolaunch ...",
      "regents autolaunch safe wizard",
      "regents autolaunch safe create",
      "regents autolaunch trust x-link --agent <id>",
      "regents regent-staking ...",
      "regents agentbook ...",
      "regents gossipsub status",
    ]),
    renderPanel("◆ BBH AFTER SETUP", [
      "run exec -> notebook pair -> run solve --solver ... -> submit -> validate",
      "run exec creates the BBH run folder",
      "SkyDiscover adds the search pass inside the run folder",
      "Hypotest scores the run and checks replay during validation",
    ]),
    tone("tip", CLI_PALETTE.secondary, true) + " add " + tone("--config /absolute/path.json", CLI_PALETTE.primary, true) + " to pin a non-default config.",
  ].join("\n\n");
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
