# Changelog

All notable changes to `@regentslabs/cli` should be recorded here.

## Unreleased

## 0.2.0 - 2026-04-29

### Added

- Added Regent work commands for creating work, starting runs, watching run events, and connecting local worker agents.
- Added Platform-facing agent commands for Hermes, OpenClaw, agent links, execution pools, formation status, formation doctor, projection, and runtime operations.
- Added Techtree Science Tasks, BBH draft, BBH run, Autoskill, reviewer, certificate, watch, chatbox, and guided `techtree start` flows.
- Added Regent staking commands for account views, staking, unstaking, claiming USDC, claiming Regent rewards, and claiming plus restaking.
- Added reporting commands for bug and security reports from the CLI.
- Added structured product request logging, transport doctor checks, route contract coverage, and packed-install release checks.
- Added generated CLI command metadata from the YAML contracts so shipped commands, help, and release checks use the same command list.
- XMTP group management now covers the full operator path from the CLI. Agents and humans can view group members, view current group rules, change group rules, view admins and super admins, add or remove admins and super admins, and remove group members.

### Changed

- Split large command and runtime areas into focused modules: command routing, Autolaunch commands, Techtree runtime handlers, Techtree clients, XMTP runtime helpers, doctor checks, and terminal presenters.
- Moved CLI configuration to explicit service base URLs for SIWA, Platform, Autolaunch, and Techtree.
- Replaced duplicated product request helpers with a shared product HTTP client and a shared Base contract client.
- Refreshed generated OpenAPI bindings for Platform, Autolaunch, Techtree, and shared Regent services.
- Aligned shared SIWA signing and audience handling across auth, doctor, Techtree, Autolaunch, Platform, Regent staking, Agentbook, and reports.
- Improved human terminal output for status, doctor, Techtree, Autolaunch, Regent staking, Agentbook, and work-runtime flows while preserving JSON output for scripts.
- Made command tests run serially with realistic timeouts because the CLI suite uses global mocks, local sockets, and local HTTP servers.
- XMTP group commands now reject bad inputs before trying the action. Unsupported rule names, unsupported policy names, and metadata values passed to the wrong rule now fail immediately with clearer feedback.

### Fixed

- Fixed Techtree command contract drift for id-taking commands such as `techtree node get <id>`, `techtree watch <id>`, and `techtree star <id>`.
- Fixed route and command metadata checks so exact shipped command names must match the route table.
- Fixed product service URL selection so Platform, Autolaunch, Techtree, and shared Regent service calls use their configured owners.
- Fixed chatbox stream failures so failed streams surface as failures instead of being hidden.
- Made runtime state, XMTP state, and local secure writes safer under repeated command runs.
- Removed stale JavaScript doctor files and other old-shape handling that no longer matches the current contracts.

### Removed

- Removed older public-beta Autolaunch command paths and compatibility routes that are not part of the current contracts.
- Removed duplicated shared-services request code in favor of the shared product HTTP client.
- Removed stale command metadata that omitted required positional ids.
