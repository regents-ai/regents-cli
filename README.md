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
  python -m regents_cli.check_commands cli/commands.json platform/priv/static/openapi.json
```

## Development

```bash
uv sync --all-extras
uv run regents --help
make check
```

MIT licensed.
