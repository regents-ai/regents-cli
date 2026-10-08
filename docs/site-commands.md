# Site commands: how a product's commands reach `regents`

Every Regent product's commands run from one package, `regents-cli`, as `regents <site> …`.
The product describes its commands; this repository runs them. This page is what a product
repository needs: who changes what, how a change travels, how a described command runs, and
what the product's server must provide. ash-template's `cli/` folder is the worked example.

## Who changes what

| Who | Owns | Never |
| --- | --- | --- |
| The product's lane | `cli/COMMANDS.md`, `cli/commands.json`, the routes and the OpenAPI document in its own repository | Edits regents-cli, or asks another agent to |
| The regents-cli chief | This repository: the pins, the format, the runner, the changelog and every release | Writes a product's command, route or docs for it |

The regents-cli chief is the only agent that changes this repository or publishes `regents-cli`.

## How a change travels

1. **Docs first, in the product repository.** Write the change in `cli/COMMANDS.md`: the
   command, what it does for a person, the server-side pseudo-code, what the server needs, and
   what changes for anyone already calling it. A command that is not in the docs does not
   exist yet.
2. **Build it in the same commit.** The route, its OpenAPI operation and the
   `cli/commands.json` entry go in together. `make check-cli` checks the entry against the
   format and the OpenAPI documents.
3. **Ship the route.** The product's own rules decide when it reaches its GitHub main and its
   live site. The command line follows; it never holds a product back.
4. **Tell the regents-cli chief**, with a command change note (below).
5. **The regents-cli chief** moves the pin in `platforms.lock.json` to that commit, runs
   `make sync` and `make check`, tries each changed command against the site, writes the
   changelog entry, and releases on the founder's go. The note back to the product names the
   version that carries the change.

### Command change note

```text
Site: patchbay
Commit on main: e7b143cf70e9591dafba2603c01d031c748d5019 (live: yes, Fly v156)
Added: none
Changed: known-fixes report <decision-id> - one report per answer; a second is refused with
  409 already_reported, "You already reported on this fix; your first report stands."
Removed: none
For callers: a repeated report now exits non-zero with that answer instead of replacing.
Docs: cli/COMMANDS.md#known-fixes-report
```

### What the release says

Each release's `CHANGELOG.md` entry names every changed command and shape in plain words.
Wording or answer fixes are a patch release (1.3.4); new commands or new answer fields are a
minor release (1.4.0). A renamed or removed command is a hard cutover: the old name goes in the
same release, the entry says so, and nothing keeps answering to it.

## How a described command runs

The runner reads the pinned `commands.json` entry and does this, the same for every site:

```text
regents <site> <words> <ARGS> [--flags] [--json] [--base-url URL] [--timeout-ms N]

  entry   = the pinned description of <site> <words>
  base    = --base-url, else <SITE>_BASE_URL, else entry.base_url
  request = entry.method entry.path with each {param} filled from ARGS,
            flags placed in the query or body as each one's `in` says,
            plus entry.body's fixed fields

  if entry.authority == "wallet-proof":
      stdin JSON fills entry.stdin_fields in the body
      receipt = this site's sign-in from `regents auth login --site <site>`
      sign the request with the agent key: SIWA headers plus an HTTP message signature
      --phase prepare  -> print the request and the exact message, send nothing
      --phase send     -> read {"request", "signature"} from stdin and send that

  answer = send once; never retried, redirects never followed
  2xx with JSON      -> print it (readable, or JSON with --json); a next-page hint when
                        entry.pagination says there is one
  any other answer   -> the site's {"error": {"code", "message", ...}} as it came, and an
                        exit code: 401/403 sign-in, 404 not found, 502-504 unreachable,
                        anything else failed
```

`regents <site> doctor` is built from the same description: the site answers, every public
read that needs no input answers, and a wallet-proof site accepts this machine's sign-in.

A command whose work cannot be said in a description (Techtree's Climbs run a local engine and
sign proofs) is native code here. Ask the regents-cli chief before designing one.

## What the product's server must provide

- **One OpenAPI operation per command**, with the entry's `operation_id`, method and path, in
  `platform/priv/public/openapi.json` or `platform/priv/static/api-contract.openapiv3.yaml`.
- **JSON answers.** A 2xx without JSON is reported as an invalid answer.
- **Errors as `{"error": {"code", "message", "hint"}}`** (`RegentAgentAccess.Recovery` in
  elixir-utils writes this). `code` is stable snake_case that scripts can branch on;
  `message` is shown to a person exactly as written, so write it for one. Use 401 or 403 for
  sign-in, 404 for missing, 409 for a repeat the site refuses, 429 with `Retry-After` for
  limits.
- **No redirects** on command routes.
- **An answer within 30 seconds**, the default wait. Longer work starts a job and returns an id
  that a read command checks (`assist request`, then `assist get <id>`). A route that holds the
  request open until there is news gives its entry `timeout_ms` a little past its longest hold
  (Keyfleet's rooms sync holds 25 seconds and sets 35000).
- **Pages** as a `has_more` flag and a cursor field, read back through one flag. Without
  `has_more` the command line never says there is another page.
- **Wallet-proof routes** verify the signed request with `Siwa.AgentAuthPlug` from
  elixir-utils, for the site's own SIWA audience, and read the caller's wallet from it. A site
  that reads a body on every signed request (`body: :always`) gives each wallet-proof GET or
  DELETE `"body": {}`, so the command line signs and sends an empty JSON body. A site whose
  reads take no body leaves it out: a body it never reads fails the signature check.
- **A list from the caller** (several rooms at once, say) is a wallet-proof command's stdin
  field of type `array`.
- **Payments**: a `prepare` route freezes the terms; the paying route answers 402 with the
  terms and an x402 `payment-required` header. The site names its own payee; the command line
  never names one, and a person's own wallet signs.
- **Repeats are the site's call.** The command line never retries, but a person can run a
  command twice; each write route decides what a second call does and says so in its answer.
- **Public reads that need no input stay cheap and always up**: doctor calls each one.

## The product's `cli/` folder

```text
cli/
  commands.json   every `regents <site>` command, in the format
                  src/regents_cli/schemas/commands.v1.json describes
  COMMANDS.md     one section per command: what it does, who may run it, what it changes,
                  route, inputs, answer, refusals, server pseudo-code, server needs, history
  README.md       how to change a command, ending with the change note for the regents-cli chief
```

Write command words as a noun, then a verb (`auctions list`, `assist get <id>`), and
descriptions in plain words for a person, never internal or implementation terms.
