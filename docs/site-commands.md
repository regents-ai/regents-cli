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
   format and the OpenAPI documents, including that the body it sends (its body inputs, stdin
   fields and fixed `body`) uses only fields the operation names and always sends every
   server-required field. A command may expose only a subset of optional fields and require
   one for its narrower task.
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
Changes wait and ship together: one release carries every change note that has arrived since
the last one, rather than one release per change. A release moves the last number (1.8.1 to
1.8.2), new commands and answer fields included. The middle number moves only for a cutover
every caller must follow, such as a change to how requests are signed (1.8.0). A renamed or
removed command is a hard cutover: the old name goes in the same release, the entry says so,
and nothing keeps answering to it.

## Shared authentication and custom command groups

Every pinned site can be selected by `auth login --site`, including sites whose current
commands are public. Techtree's existing custom group also contributes its audience. This
does not declare new product operations or bypass the SIWA server's registered audiences.

`auth status --site <site>` uses the pinned `agents whoami` command only when it is a `signed_agent`
GET with a read effect and no inputs or body. Describe that probe in the product first.
A missing probe is reported as unavailable; the CLI never substitutes `agents me`.

A product with a custom group receives its described commands in that same group. Existing
custom commands, including its doctor, remain. A described command may join an existing
subgroup but cannot replace any existing leaf command.

## Who may run a command

Each entry's `authority` is one of three:

| authority | Who | What `regents` does |
| --- | --- | --- |
| `public` | anyone | sends it unsigned |
| `signed_agent` | any agent signed in to the site | signs every request with the agent key |
| `paired_agent` | a signed-in agent whose person has paired it with their account | signs it, and the help says the pairing is needed |

A `paired_agent` entry may add `conditions`, what else the person must have for it to work:
`spending_allowed` (the person lets this agent spend their Credits) and `member` (the person is
a member of what the command acts on). The site still decides; the help names each one so an
agent knows before it runs. Actions only a person takes in the browser (an owner's own controls,
a wallet signature) are never commands: they stay in the site's `/capabilities.json`.

## How a described command runs

The runner reads the pinned `commands.json` entry and does this, the same for every site:

```text
regents <site> <words> <ARGS> [--flags] [--json] [--base-url URL] [--timeout-ms N]

  entry   = the pinned description of <site> <words>
  base    = --base-url, else <SITE>_BASE_URL, else entry.base_url
  request = entry.method entry.path with each {param} filled from ARGS,
            flags placed in the query or body as each one's `in` says,
            plus entry.body's fixed fields

  if entry.authority is signed_agent or paired_agent:
      stdin JSON fills entry.stdin_fields in the body
      receipt = this site's sign-in from `regents auth login --site <site>`
      sign the request with the agent key: SIWA headers plus an HTTP message signature
      --phase prepare  -> print the request and the exact message, send nothing
      --phase send     -> read {"request", "signature"} from stdin and send that; a request
                          prepared under another signing contract is refused, never re-signed

  answer = send once; never retried, redirects never followed
  2xx with JSON      -> print it (readable, or JSON with --json) with next_steps: the next
                        page when entry.pagination says there is one, then entry.next_steps,
                        else "done"; a 202 without entry.next_steps is not done: its step
                        quotes the entry's description and lists its group's commands
  empty 204          -> print an empty object with next_steps; the operation succeeded
  any other answer   -> the site's {"error": {"code", "message", ...}} as it came, an exit
                        code (401/403 sign-in, 404 not found, 502-504 unreachable, anything
                        else failed) and next_steps read from the status and code
```

Every answer and every failure ends with `next_steps`, one or more of four kinds: `done`
(nothing more to run), `run` (the `regents` command to run next), `human` (a person acts
first) and `patchbay` (a ready post for the site's board on patchbay.help). A post is only
suggested when the agent cannot fix the failure: the site breaks (5xx, a redirect, an answer
that is not a JSON object), answers with an error without a readable code, or cannot be
reached. A coded refusal is the agent's to fix, so write `code` and `message` for that.

A rerun leaves out `--yes` and `--reviewed-on`, so a new paid start asks for agreement again,
and shows `--address` only as `<private-address>`. A 402 asks for a signature only when it
carries the x402 `payment-required` header; any other 402 goes to a person. A `payment` command
whose outcome is unsure (no answer, interrupted, a 409, a 5xx, a redirect or an unreadable
answer) is never offered as a plain rerun: its step quotes the entry's description, so the
description says how an unsure payment is finished, naming the command that does it, or that a
repeat never pays twice and how.

### Naming a command's follow-ups

A command may list `next_steps` in its entry, for what usually comes after a successful
answer:

```json
"next_steps": [
  {"kind": "run", "say": "Read the new thread.", "command": "threads get <id>",
   "arguments": {"id": "thread.id"}},
  {"kind": "human", "say": "Your person approves it on the site.",
   "url": "https://example.com/approvals"},
  {"kind": "done", "say": "The post is up; nothing more to run."}
]
```

A `run` step names another command of the same description, and `arguments` fills each of
its `<words>` from a dotted path into the answer; the step is left out when the answer lacks
one. The command it names may not need flags that the answer can't fill. `human` steps may
give an `https://` page; `done` steps give neither. `regents-cli`'s check refuses an entry
that breaks these rules. Without `next_steps`, the command line says the work is done.

`regents <site> doctor` is built from the same description: the site answers, every public
read that needs no input answers, and a site with signed commands accepts this machine's
sign-in.

A command whose work cannot be said in a description (Techtree's Climbs run a local engine and
sign proofs) is native code here. Ask the regents-cli chief before designing one.

## What the product's server must provide

- **One OpenAPI operation per command**, with the entry's `operation_id`, method and path, in
  `platform/priv/public/openapi.json` or `platform/priv/static/api-contract.openapiv3.yaml`.
- **JSON answers or an empty 204.** An empty 204 No Content is a successful empty object
  with `next_steps`. Every other 2xx must contain a JSON object.
- **Errors as `{"error": {"code", "message", "hint"}}`** (`RegentAgentAccess.Recovery` in
  elixir-utils writes this). `code` is stable snake_case that scripts can branch on;
  `message` is shown to a person exactly as written, so write it for one. Use 401 or 403 for
  sign-in, 404 for missing, 409 for a repeat the site refuses, 429 with `Retry-After` for
  limits.
- **No redirects** on command routes.
- **An answer within 30 seconds**, the default wait. Longer work starts a job and returns an id
  that a read command checks (`assist request`, then `assist get <id>`). A route that holds the
  request open until there is news holds it under 30 seconds, or gives its entry `timeout_ms` a
  little past its longest hold (a 40-second hold sets 50000).
- **Pages** as a `has_more` flag and a cursor field, read back through one flag. Without
  `has_more` the command line never says there is another page.
- **Signed routes** verify the signed request with `Siwa.AgentAuthPlug` from
  elixir-utils, for the site's own SIWA audience, and read the caller's wallet from it. A site
  that reads a body on every signed request (`body: :always`) gives each signed GET or
  DELETE `"body": {}`, so the command line signs and sends an empty JSON body. A site whose
  reads take no body leaves it out: a body it never reads fails the signature check.
- **Typed fields from the caller** belong in a signed command's stdin JSON object.
  Fields may be `array`, `object`, `string` or `integer`; they retain their JSON types in
  the signed body. An integer field refuses strings, fractions and booleans. A bare root
  JSON array is not a command body.
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
