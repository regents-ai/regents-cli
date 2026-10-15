# Regents CLI

This repository owns the `regents` command, published to PyPI as `regents-cli`: one Python
package with every Regent site's commands, each site a namespace (`regents <site> …`).

## Workspace workflow

Follow `/Users/sean/Documents/regent/.agents/skills/regent-workflow/SKILL.md`. One writer owns
this repository: the regents-cli chief engineer, the only agent that changes it or publishes
`regents-cli` (founder, 2026-10-04). Sites never write here. A site's command change starts in
its own `cli/COMMANDS.md`, then its `cli/commands.json` and route; the owner moves the pin,
writes the changelog and releases. `docs/site-commands.md` is the guide for sites.

## Repository contracts

- A site's command description changes in its own repository first, docs before code. Then
  move its pin in `platforms.lock.json` to a commit on that site's GitHub main, run `make sync`,
  try each changed command against the site, and name every changed shape in `CHANGELOG.md`.
- `src/regents_cli/schemas/commands.v1.json` is the description format. Change it here, and
  tell each site's lane in the same change.
- Every described command runs from its description through `src/regents_cli/runner.py`; do not
  add code for one site's command when the description can say it.
- Command names, flags and answers are a public contract. They change only through a release
  whose notes name every changed shape.
- Hard cutover: no aliases, fallbacks, old command names or dual shapes.
- Automated tests stay few; each names the costly failure it protects against. No smoke tests.

## Protected actions

- Never publish to PyPI or npm, deploy, sign, read secrets, or move value without the founder's
  explicit go.
- Never read `.env`, `.env.local`, or `.envrc`; `.env.example` is allowed.

## Required validation

Run `make check` from the repository root.

<!-- BEGIN REGENT ROLLOUT REVIEW -->
## Code Review Rules

### Human and agent guidance drift

For every code review, read `.agents/skills/rollout-guidance-check/SKILL.md` and assess the diff's guidance
impact, even when no prose files changed. Trace affected behavior into public docs,
product/developer Skills, human-to-agent prompts, tooltips and other UI copy,
WebMCP/MCP schemas and descriptions, CLI help/errors/examples, OpenAPI, manifests
and generated or bundled copies. Shared behavior starts in ash-template and its
libraries; inspect affected consumers when available.

Report concrete mismatches introduced or made relevant by this change, with the
failing user/agent action and exact source locations. Distinguish source, packaged,
published and deployed versions; name missing cross-repository or live evidence.
Preserve dated history and avoid cosmetic findings. Do not inflate severity or
claim that no findings proves complete coverage. This is read-only review: never
sign, pay, activate earnings, publish or deploy to test an instruction.
<!-- END REGENT ROLLOUT REVIEW -->
