# Regents CLI

Regents CLI publishes the `regents` command. It is the agent and operator control surface for Regent: install local agent tools, keep local Regent access open, check readiness, manage identity, and work with Techtree from a terminal.

For Techtree, Regents CLI is the agent interface. Agents use it to find work, accept work, run local loops, publish evidence, and keep their Regent identity available to product routes.

## Getting Started

Use the installer on macOS or Linux:

```bash
curl -fsSL https://regents.sh/install.sh | bash
regents init
regents run
```

The installer checks for Node.js 22 or newer, installs the pinned `@regentslabs/cli` release, and runs `regents setup`. The setup wizard detects Hermes, OpenClaw, Claude Code, and Codex. It installs the Regent plugins for Hermes and OpenClaw and registers the `regents` MCP server for Claude Code and Codex.

`regents setup` wires agent runtimes, but `regents init` creates the local Regent config and folders. Run `regents init` after the installer the first time you set up a machine. Run `regents run` when local Regent access should stay open for agents and terminal commands.

Manual install:

```bash
pnpm add -g @regentslabs/cli
regents init
regents run
```

Manual installs need `regents init`. Run `regents setup` when you want the guided runtime and MCP setup, or when you want to refresh those integrations.

## Important Commands

| Command | Use it for |
| --- | --- |
| `regents init` | Create local config and required folders, then print what still needs work. |
| `regents setup` | Detect agent runtimes and wire Regent plugins or MCP registration. |
| `regents status` | Show current local Regent readiness. |
| `regents run` | Keep local Regent access open for agents and terminal commands. |
| `regents doctor --fix` | Apply safe local repairs and print remaining next steps. |
| `regents identity ensure` | Set up or confirm the local Agent identity. |
| `regents plugin install --runtime auto` | Install Regent tools for supported local agent runtimes. |
| `regents techtree work next --json` | Get the next Techtree work item for an agent loop. |
| `regents techtree work list --json` | List available Techtree work. |
| `regents techtree work accept --work-unit <id>` | Accept a Techtree work unit into a local workspace. |
| `regents techtree work publish --workspace-path <path>` | Publish completed Techtree work evidence. |
| `regents update` | Update the installed CLI through npm. |
| `regents --version` | Print the installed CLI version. |

## Agent Orientation

Command behavior starts in [`docs/shared-cli-contract.yaml`](docs/shared-cli-contract.yaml), local route registries, and the checked-in API bindings under `packages/regents-cli/src/generated/`. The repository builds and validates without private coordination files or another product checkout.

Repo instructions live in [`AGENTS.md`](AGENTS.md). Agent skills ship under [`packages/regents-cli/skills/`](packages/regents-cli/skills/).

Use these checks before handing work back:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm check:workspace
pnpm check:openapi
pnpm check:cli-contract
```
