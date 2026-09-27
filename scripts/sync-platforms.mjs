#!/usr/bin/env node
// Copies each platform's pinned files into platforms/, from the platform's
// public repository at the commit platforms.lock.json names. A platform's
// command descriptions and contracts live in its own repository; this is how
// the CLI reads them. Pin a commit that is on the platform's GitHub main.
//
//   node scripts/sync-platforms.mjs          # write the copies
//   node scripts/sync-platforms.mjs --check  # fail when a copy differs from its pin
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const check = args.length === 1 && args[0] === "--check";
if (args.length > 0 && !check) {
  console.error(`unknown arguments: ${args.join(" ")}`);
  process.exit(2);
}

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(resolve(root, "platforms.lock.json"), "utf8"));
const drifted = [];

for (const [name, { repository, commit, files }] of Object.entries(lock)) {
  for (const [source, copy] of Object.entries(files)) {
    const url = `https://raw.githubusercontent.com/${repository}/${commit}/${source}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`${name}: ${source} at ${commit.slice(0, 12)} answered ${response.status} (${url})`);
      process.exit(1);
    }
    const pinned = Buffer.from(await response.arrayBuffer());
    const target = resolve(root, copy);

    if (check) {
      if (!existsSync(target) || !readFileSync(target).equals(pinned)) drifted.push(copy);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, pinned);
      console.log(`${name}: ${source} -> ${copy}`);
    }
  }
}

if (drifted.length > 0) {
  console.error(`differs from its pinned commit: ${drifted.join(", ")}. Run node scripts/sync-platforms.mjs`);
  process.exit(1);
}
if (check) console.log("platform copies match their pinned commits");
