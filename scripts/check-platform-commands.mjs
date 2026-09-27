// Checks site command descriptions (cli/commands.json) against schemas/commands.v1.json
// and against the site's own OpenAPI documents.
//
//   node scripts/check-platform-commands.mjs
//     every platforms/<name>/commands.json, with the OpenAPI documents pinned beside it
//   node scripts/check-platform-commands.mjs <commands.json> <openapi file>...
//     one site's description, for the site's own checks
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadYaml } from "./dependency-preflight.mjs";

const root = path.resolve(import.meta.dirname, "..");
const YAML = await loadYaml(root);
const { default: Ajv } = await import("ajv/dist/2020.js");

const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/commands.v1.json"), "utf8"));
const validate = new Ajv({ allErrors: true }).compile(schema);

// Flags every command takes from regents-cli itself.
const sharedFlags = new Set(["json", "help", "version", "base-url", "timeout-ms", "phase"]);
const methods = ["get", "put", "post", "patch", "delete"];

const readDocument = (file) => {
  const text = fs.readFileSync(file, "utf8");
  return file.endsWith(".json") ? JSON.parse(text) : YAML.parse(text);
};

const operationsIn = (documents) => {
  const operations = new Map();
  for (const document of documents) {
    for (const [route, item] of Object.entries(document.paths ?? {})) {
      for (const method of methods) {
        const id = item?.[method]?.operationId;
        if (id) operations.set(id, { method: method.toUpperCase(), path: route });
      }
    }
  }
  return operations;
};

const placeholders = (command) =>
  command.split(" ").filter((word) => word.startsWith("<")).map((word) => word.slice(1, -1));

const pathParameters = (route) => [...route.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1]);

const sameSet = (left, right) =>
  left.length === right.length && [...left].sort().join("\n") === [...right].sort().join("\n");

const duplicates = (values) => values.filter((value, index) => values.indexOf(value) !== index);

function problemsIn(description, operations) {
  if (!validate(description)) {
    return validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`);
  }

  const problems = [];
  const shapes = description.commands.map((entry) => entry.command.replace(/<[^>]+>/gu, "<>"));
  for (const shape of new Set(duplicates(shapes))) problems.push(`two commands have the shape "${shape}"`);

  for (const entry of description.commands) {
    const say = (message) => problems.push(`${entry.command}: ${message}`);
    const args = entry.arguments ?? [];
    const flags = entry.flags ?? [];
    const flagNames = flags.map((flag) => flag.name);
    const inputs = [...args, ...flags];

    if (placeholders(entry.command).join(" ") !== args.map((arg) => arg.name).join(" ")) {
      say("arguments must match the <words> in the command, in order");
    }
    for (const name of new Set(duplicates(inputs.map((input) => input.name)))) say(`input ${name} is listed twice`);
    for (const name of flagNames.filter((flag) => sharedFlags.has(flag))) say(`--${name} is a shared flag`);

    const pathFields = inputs.filter((input) => input.in === "path").map((input) => input.field);
    if (!sameSet(pathFields, pathParameters(entry.path))) {
      say(`path inputs (${pathFields.join(", ") || "none"}) must fill exactly ${entry.path}`);
    }
    for (const input of inputs) {
      if (input.enum && input.type !== "string") say(`${input.name}: only string inputs take enum`);
      if ((input.minimum !== undefined || input.maximum !== undefined) && input.type !== "integer") {
        say(`${input.name}: only integer inputs take minimum and maximum`);
      }
    }

    const sendsBody =
      inputs.some((input) => input.in === "body") || entry.body !== undefined || entry.stdin_fields !== undefined;
    if (sendsBody && ["GET", "DELETE"].includes(entry.method)) say(`${entry.method} sends no body`);
    if (entry.stdin_fields && entry.authority !== "wallet-proof") say("only wallet-proof commands read body fields from stdin");

    for (const name of entry.required_one_of ?? []) {
      if (!flagNames.includes(name)) say(`required_one_of names --${name}, which is not a flag`);
    }
    if (entry.pagination && !flagNames.includes(entry.pagination.flag)) {
      say(`pagination passes the cursor as --${entry.pagination.flag}, which is not a flag`);
    }

    const operation = operations.get(entry.operation_id);
    if (!operation) {
      say(`operation ${entry.operation_id} is not in the site's OpenAPI documents`);
    } else if (operation.method !== entry.method || operation.path !== entry.path) {
      say(`operation ${entry.operation_id} is ${operation.method} ${operation.path}, not ${entry.method} ${entry.path}`);
    }
  }
  return problems;
}

function pinnedSites() {
  const lock = JSON.parse(fs.readFileSync(path.join(root, "platforms.lock.json"), "utf8"));
  return Object.values(lock)
    .map((pin) => Object.values(pin.files).map((file) => path.join(root, file)))
    .filter((files) => files.some((file) => path.basename(file) === "commands.json"))
    .map((files) => ({
      commands: files.find((file) => path.basename(file) === "commands.json"),
      openapi: files.filter((file) => path.basename(file) !== "commands.json"),
    }));
}

const [commandsFile, ...openapiFiles] = process.argv.slice(2);
const sites = commandsFile ? [{ commands: path.resolve(commandsFile), openapi: openapiFiles.map((file) => path.resolve(file)) }] : pinnedSites();

let failed = false;
for (const site of sites) {
  const problems = problemsIn(readDocument(site.commands), operationsIn(site.openapi.map(readDocument)));
  const label = path.relative(process.cwd(), site.commands);
  if (problems.length > 0) {
    failed = true;
    console.error(`${label}:\n  ${problems.join("\n  ")}`);
  } else {
    console.log(`${label}: ok`);
  }
}

if (sites.length === 0) console.log("No pinned site describes its commands yet.");
if (failed) process.exit(1);
