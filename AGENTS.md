# Regents CLI

This repository owns the `regents` command, published to PyPI as `regents-cli`: one Python
package with every Regent site's commands, each site a namespace (`regents <site> …`).

## Workspace workflow

Follow `/Users/sean/Documents/regent/.agents/skills/regent-workflow/SKILL.md`. One writer owns
this repository: the regents-cli chief engineer. Sites never write here; they change their own
`cli/commands.json` and the owner moves the pin.

## Repository contracts

- A site's command description changes in its own repository first. Then move its pin in
  `platforms.lock.json` to a commit on that site's GitHub main and run `make sync`.
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
