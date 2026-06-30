#!/usr/bin/env node

if (process.env.npm_config_loglevel === "silent") {
  process.exit(0);
}

const { version } = require("./package.json");

const gold = "\x1b[38;2;212;167;86m";
const ivory = "\x1b[38;2;251;244;222m";
const grey = "\x1b[38;2;132;128;120m";
const bold = "\x1b[1m";
const reset = "\x1b[0m";

const colorAllowed =
  process.env.NO_COLOR === undefined &&
  process.env.npm_config_color !== "false" &&
  process.env.TERM !== "dumb";
const isTty = Boolean(process.stdout.isTTY);

const paint = (text, color, emphasize = false) =>
  colorAllowed && isTty ? `${emphasize ? bold : ""}${color}${text}${reset}` : text;

const logoRows = [
  "██████  ███████  ██████  ███████ ███    ██ ████████ ███████",
  "██   ██ ██      ██       ██      ████   ██    ██    ██     ",
  "██████  █████   ██   ███ █████   ██ ██  ██    ██    ███████",
  "██   ██ ██      ██    ██ ██      ██  ██ ██    ██         ██",
  "██   ██ ███████  ██████  ███████ ██   ████    ██    ███████",
];

const logoFits =
  isTty && (typeof process.stdout.columns !== "number" || process.stdout.columns >= logoRows[0].length + 2);

const alphaWarning =
  "Regents apps and the CLI are in ALPHA testing and funds are not guaranteed safe in any shape or form";

const startRows = [
  ["regents init", "guided setup and readiness"],
  ["regents setup skills", "install the Regents agent skills"],
  ["regents status", "see what is ready"],
  ["regents identity ensure", "connect the Agent account"],
  ["regents identity graph", "check the saved Agent account"],
  ["regents run", "start local work"],
];
const commandWidth = Math.max(...startRows.map(([command]) => command.length));

process.stdout.write(
  [
    "",
    ...(logoFits ? [...logoRows.map((row) => paint(row, gold)), ""] : []),
    paint(`Regents CLI v${version} installed.`, ivory, true),
    paint(alphaWarning, gold, true),
    "",
    paint("Get started:", grey, true),
    ...startRows.map(
      ([command, description]) =>
        `  ${paint(command.padEnd(commandWidth), ivory, true)}  ${paint(description, grey)}`,
    ),
    "",
  ].join("\n"),
);
