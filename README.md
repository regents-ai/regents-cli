# regents

One command line for every Regents Labs site: `regents patchbay …`, `regents autolaunch …`,
`regents techtree …`, `regents keyfleet …`.

```bash
uv tool install regents-cli
regents --help
regents patchbay threads search --query webmcp
```

Every command answers the same way:

- readable output by default, and `--json` for exactly the site's answer;
- errors as `{"error": {"code": "…", "message": "…"}}`;
- the same exit codes everywhere (`regents --help` lists them);
- the site's address from `--base-url`, then `<PLATFORM>_BASE_URL`, then the site's own address.

## Checking a site

`regents <site> doctor` runs the same checks for every site: the site answers, each public read
that needs no input answers, and, for a site with wallet-proof commands, the sign-in server
accepts a request signed with your sign-in, as the site would. It exits 1 when any check fails.

```bash
regents patchbay doctor
```

## Signing in

A site's wallet-proof commands need a wallet sign-in (SIWA). One agent key lives on this
machine, in `~/.regents/agent-key.json`, and signs every request:

```bash
regents auth login --site patchbay
regents auth status
echo '{"args": {"goal": "…", "site_url": "https://…", "sign_in": "none"}}' \
  | regents patchbay assist request
```

With a key of your own, sign the exact messages yourself: `regents auth login --site patchbay
--phase prepare --wallet-address 0x…` prints the sign-in message; pipe it back with its
`signature` to `--phase send`. A command's `--phase prepare` prints the request and the message
to sign, and `--phase send` reads `{"request": …, "signature": …}`.

`regents` never signs a payment. A paid command takes your own x402 payment signature on stdin.

## How a site's commands get here

Each site describes its commands in its own repository, in `cli/commands.json`
([format](src/regents_cli/schemas/commands.v1.json)): every command's name, inputs, the route it
calls, who may call it and what it changes. The site changes that file in the same commit as the
route. `platforms.lock.json` pins each site's description and API documents by commit, and
`make sync` copies them into `src/regents_cli/platforms/`. Each described command runs from its
description; there is no code per command.

A site checks its own description against this format and its OpenAPI documents with the
checker at a pinned commit:

```bash
uv run --no-project \
  --with "regents-cli[check] @ git+https://github.com/regents-ai/regents-cli@<commit>" \
  python -m regents_cli.check_commands cli/commands.json <openapi.json>
```

## Techtree

`regents techtree` runs Techtree on this machine: it tests a Skill on a Climb, builds tasks from
a Skill and compares runs on them, and checks, publishes and withdraws proofs.

```bash
regents techtree setup
regents techtree skill starter
regents techtree climb prepare hello-world-climb@1 --skill <path to SKILL.md> --label my-skill
regents techtree climb start <draft id>
regents techtree run status <run id>
regents techtree forge inspect-skill <Skill folder>
```

- Everything Techtree keeps lives in `~/.regents/techtree`. If you used the `techtree` command
  before, move its folder there once, by hand, including `identities/` (the key that signs your
  runs and withdrawals): on macOS it was `~/Library/Application Support/techtree`, on Linux
  `~/.local/share/techtree`. Publish any finished run you made with `techtree` 0.3.0 before
  moving, using `techtree` 0.3.0: `regents` checks those runs but doesn't publish them.
- Real runs call the model through your Prime sign-in, `~/.prime/config.json`. The provider
  bills those calls to your own account.
- Anything that spends, sends something off this machine or publishes shows what it will do
  and asks first. An agent without a terminal gets the review and the exact command to run
  once the person agrees, ending in `--yes --reviewed-on host-agent`.
- `regents techtree doctor` checks this machine: Python, platform, uv, Docker, Hermes and the
  pinned engine.

## Development

```bash
uv sync --all-extras
uv run regents --help
make check
```

MIT licensed.
