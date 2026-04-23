import { renderPanel } from "./panel.js";
import { alignCell, CLI_PALETTE, escapeTerminalText, stripAnsi, tone } from "./palette.js";
import { renderTablePanel } from "./table.js";

export interface KeyValueRow {
  label: string;
  value: string;
  labelColor?: string;
  valueColor?: string;
}

export const renderKeyValueLines = (rows: readonly KeyValueRow[]): string[] => {
  const safeRows = rows.map((row) => ({
    ...row,
    label: escapeTerminalText(row.label),
    value: escapeTerminalText(row.value),
  }));
  const labelWidth = safeRows.reduce((max, row) => Math.max(max, stripAnsi(row.label).length), 0);
  return safeRows.map((row) => {
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

export function renderUsageScreen(configPath: string): string {
  const lines = [
    tone("local control layer for Regent", CLI_PALETTE.secondary),
    `${tone("default config", CLI_PALETTE.secondary)} ${tone(escapeTerminalText(configPath), CLI_PALETTE.primary, true)}`,
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
      "regents init",
      "regents status",
      "regents whoami",
      "regents balance",
      "regents search <query>",
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
      "regents techtree science-tasks checklist --workspace-path ...",
      "regents techtree science-tasks evidence --workspace-path ...",
      "regents techtree science-tasks export --workspace-path ... [--output-path ...]",
      "regents techtree science-tasks submit --workspace-path ... --pr-url ...",
      "regents techtree science-tasks review-update --workspace-path ... --pr-url ...",
      "regents techtree science-tasks review-loop --workspace-path ... --pr-url ...",
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

export function printText(text: string): void {
  process.stdout.write(`${text}\n`);
}
