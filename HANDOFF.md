# Regents CLI handoff

`regents-ai/regents-cli` holds the one `regents` command. On 2026-09-27 the founder chose
Python for it: PyPI `regents-cli`, installed with `uv tool install regents-cli`. The TypeScript
package left `main` the same day; its history is in git and on npm as `@regentslabs/cli` 0.5.0.
The founder also asked for the command set to be designed from how agents use the sites today,
using the old 135 commands only as a reference.

## Layout

- `src/regents_cli/app.py`: the `regents` root, with one namespace per pinned site.
- `src/regents_cli/runner.py`: builds a site's commands from its description and runs them.
- `src/regents_cli/http.py`: the base-address rule, one request, and how an answer or error
  is read.
- `src/regents_cli/siwa.py`: the agent key, each site's sign-in, and signed requests, matching
  what `siwa-server` checks (`elixir-utils/siwa/.../request_auth.ex`).
- `src/regents_cli/auth.py`: `regents auth login | status | logout`.
- `src/regents_cli/output.py`: readable output, `--json`, and the shared error shape.
- `src/regents_cli/errors.py`: the exit codes.
- `src/regents_cli/platforms/`: each site's pinned files, copied by `make sync` from
  `platforms.lock.json`.
- `src/regents_cli/schemas/commands.v1.json`: the description format.
- `src/regents_cli/check_commands.py`: the description checker (also run by each site).

## Where the steps stand

1. Repository cut, and 2. description format: done (TypeScript era, `457df04`, `25e1868`).
3. Patchbay and Autolaunch: all ten Patchbay commands work from its pinned description
   (Patchbay `2bd83fa`), including sign-in and signed requests, checked end to end against
   `siwa-server`'s own verifier on this machine. Autolaunch has no `cli/commands.json` yet.
4. KeyFleet, 5. Techtree, 6. publishing 1.0.0 (founder go), 7. parking `repos/regents-cli-v2`
   and `repos/monorepo-template`'s Python host: not started.

## Checks

Run `make check`. Do not publish, deploy, sign, access production, or move value without the
founder's explicit go.
