# regents

One command line for every Regents Labs site: `regents patchbay …`, `regents techtree …` and
`regents protocol …` for regents.sh itself. `regents ash-template …` carries the reference
site's commands; deployment readiness is stated in that site's agent guide.

```bash
uv tool install regents-cli
regents
```

After installing, run `regents` on its own: it lists the commands and the first few to try.

SOCKS proxy support is included. The CLI respects HTTPX proxy environment settings; it
never disables a configured proxy to work around a connection problem. If an incomplete
installation reports `installation_incomplete`, repair that environment with `httpx[socks]`.

Every command answers the same way:

- readable output by default, and `--json` for the site's answer with `next_steps`;
- an empty HTTP 204 is success, shown as an empty object with `next_steps`;
- errors as `{"error": {"code": "…", "message": "…"}}`;
- the same exit codes everywhere (`regents --help` lists them);
- the site's address from `--base-url`, then `<PLATFORM>_BASE_URL`, then the site's own address.

## Checking a site

`regents <site> doctor` runs the same checks for every site: the site answers, each public read
that needs no input answers, and, for a site with signed commands, the sign-in server accepts
a request signed with your sign-in, as the site would. It exits 1 when any check fails.

```bash
regents patchbay doctor
```

## Signing in

A site's signed commands need a wallet sign-in (SIWA): `signed_agent` commands work for any
signed-in agent, and `paired_agent` commands also need your person to have paired this agent
with their account (`regents protocol agents pair`). One agent key lives on this machine and
signs every request. It is the same key the SIWA agent client
(`https://siwa.regents.sh/skill.md`) uses: `~/.siwa-agent/key.json`, with each site's sign-in
in `~/.siwa-agent/receipts/`. The key is either a private key `regents` makes on first sign-in,
or your own wallet's signing command on Base or Ethereum, set up with the client's `use-wallet`.
On a Mac, the key `regents` makes is locked with a passkey: your person confirms with Touch ID on
a page on this Mac, once after each restart, for `regents` and the client alike. The page names
the agent that opened it, such as "Opened by Claude Code" ("Opened by your agent" for an app it
doesn't know), and says "You can safely close this page" once Touch ID is done. `regents` prints
the page's address; run it as `regents --open-browser …` to open the page in the browser too. The
client's `show-key` shows the plain key to copy. Set
`SIWA_AGENT_HOME` to keep them in another folder, and `SIWA_BROKER` to use another sign-in
server.

```bash
regents auth login --site patchbay
regents auth status
echo '{"args": {"goal": "…", "site_url": "https://…", "sign_in": "none"}}' \
  | regents patchbay assist request
```

A command that reads stdin takes one JSON object holding the fields of the site's own request
body; its `--help` names them. Patchbay's `assist request` body has one field, `args`; another
command's body may have several. A missing, unknown or mistyped field is named in one answer.

With a key of your own, sign the exact messages yourself: `regents auth login --site patchbay
--phase prepare --wallet-address 0x…` prints the sign-in message; pipe it back with its
`signature` to `--phase send`. A command's `--phase prepare` prints the request and the message
to sign, and `--phase send` reads `{"request": …, "signature": …}` and sends exactly that request.
The prepared request names the signing contract it was built under; a `regents` that signs under
another one refuses it, so prepare it again.

Each site pairs its own agents. A person signs in on the site and makes a code from their Account
page there, such as https://keyfleet.ai/account, and the agent supplies string `code`, `name` and
`harness` fields through private JSON stdin to that site's `agents pair`: `regents keyfleet
agents pair` for Keyfleet, `regents protocol agents pair` for regents.sh.
`regents auth status --site ash-template` reads that site's identity and pairing probe. It
never sends the legacy check-in or awards Points. Its `pairing_status` answer includes the
site's authenticated identity, pairing and effective access; this replaces `paired_with`.
Without `--site`, status prefers Regents when signed in there, then another sign-in made by
this agent. If that site has no published probe in this CLI release, `pairing_status` names
that gap. Selecting such a site explicitly returns `identity_probe_unavailable`.

Login accepts sites whose commands this release carries, including Autolaunch, Keyfleet and Techtree.
Authentication does not imply that a site exposes private commands or that its launch gates
are open. See each site's `/agents.md` before performing work.

An agent may also list itself in the ERC-8004 agent registry on Base. It is optional; sign-in
never needs it. The sign-in server hosts the agent's profile; `regents` builds the one
transaction itself and refuses one from the server that differs. It shows the transaction, what
it costs at most (its gas and Base's fee for writing it to Ethereum) and every field as it will
be signed. Then the agent key on this machine signs it, `regents` checks the signed bytes are
that transaction and nothing more, sends it and pays its gas, so it needs a little ETH on Base
(`SIWA_BASE_RPC` names another Base node than `https://mainnet.base.org`). Each run sends a new
transaction; once one is sent, any error keeps its hash and the `--tx-hash` command that checks
it. Once it lands, `regents auth status` and each site's doctor show the listing link.

```bash
regents auth register --name "Astra" --description "What I do, in a sentence"
```

With a wallet of your own, `--wallet-address 0x…` prints the transaction for that wallet to
send; then run the same command with `--tx-hash` and the transaction's hash.

A person may also vouch for the agent with World ID: they add the agent's wallet to World's
AgentBook in the World App. It is optional too. Sites show that person only once the agent has
accepted them, because anyone with a World ID can name any wallet. `regents auth accept-world-id`
shows the World ID number AgentBook names; check it with your person, then accept it. Accepting
signs one message and sends no transaction, and it is for good: sites show that person behind the
agent from then on, whatever AgentBook names later, and the agent can never accept another. Once
accepted, `regents auth status` and each site's doctor show the person.

```bash
regents auth accept-world-id
regents auth accept-world-id --human-id 0x…
```

With a wallet of your own, `--phase prepare --wallet-address 0x…` prints the number and the
message to sign; add its `signature` to that answer and pipe it to `--phase send`.

`regents` never signs a payment. A paid command takes your own x402 payment signature on stdin.
The one transaction it ever sends is the agent's registry listing above.

## Techtree publication sign-in

`regents techtree publish` and `withdraw` require `regents auth login --site techtree`
and a current pairing with the owner account. The site checks that pairing alongside the
existing independent participant proof. Local experiments and proof verification stay offline.
The signed JSON body is sent unchanged, up to 2,097,152 bytes, only to
`https://techtree.sh/api/v1/publications`. A retry signs fresh request proof. A missing
answer may mean the site accepted the submission; read the public result before retrying.

An optional contributor address travels privately in its existing header. Reviews and
approval commands hide it; replace `<private-address>` privately when rerunning an approval
command. Skill name and GitHub URL remain public descriptive metadata.

## How a site's commands get here

Each site describes its commands in its own repository, in `cli/commands.json`
([format](src/regents_cli/schemas/commands.v1.json)): every command's name, inputs, the route it
calls, who may call it and what it changes. The site changes that file in the same commit as the
route. `platforms.lock.json` pins each site's description and API documents by commit on the
site's main, and `make sync` copies them into `src/regents_cli/platforms/` from the site's checkout
beside this one, recording each copy's sha256 in the lock. Some sites' repositories are private,
so the copies are checked against their commits on the founder's machine (`make release-check`);
the publish workflow checks that the copies are exactly the lock's, with no other site folder.
Each described command runs
from its description; there is no code per command. A command's route must answer JSON.

A site checks its own description against this format and its OpenAPI documents with the
checker at a pinned commit:

```bash
uv run --no-project \
  --with "regents-cli[check] @ git+https://github.com/regents-ai/regents-cli@<commit>" \
  python -m regents_cli.check_commands cli/commands.json <openapi.json>
```

## Techtree

`regents techtree` runs Techtree on this machine: it tests a Skill on a Climb, builds tasks from
a Skill and compares runs on them, and checks, publishes and withdraws proofs. Three Climbs ship
with it: `hello-world-climb@3`, a short introduction; `frontier-cs-open-ended-climb@3`, ten
open-ended C++ optimisation problems from [Frontier-CS](https://github.com/FrontierCS/Frontier-CS),
made with FrontierSmith; and `tasksmith-climb@2`, six real changes from Hugging Face's own
repositories, taken from [HF ML Tasksmith](https://huggingface.co/datasets/FineEnvs/HF_ML_Tasksmith).

```bash
regents techtree setup
regents techtree skill starter --climb frontier-cs-open-ended-climb@3
regents techtree climb prepare frontier-cs-open-ended-climb@3 --skill <path to SKILL.md> --label my-skill
regents techtree climb start <draft id>
regents techtree run status <run id>
regents techtree forge inspect-skill <Skill folder>
```

- Everything Techtree keeps lives in `~/.regents/techtree`. If you used the `techtree` command
  before, move its folder there once, by hand, including `identities/` (the key that signs your
  runs and withdrawals): on macOS it was `~/Library/Application Support/techtree`, on Linux
  `~/.local/share/techtree`. Publish any finished run you made with `techtree` 0.3.0 before
  moving, using `techtree` 0.3.0: `regents` checks those runs but doesn't publish them.
- Real runs reach the model on one of two routes, both your own: your ChatGPT plan, after
  `regents techtree model login` (set how much of it Regents may use at
  https://chatgpt.com/settings/usage), or your own Prime key (`PRIME_API_KEY`, or
  `prime login`). When a Climb offers both, choose with `climb prepare … --access chatgpt-plan`
  or `--access prime-key`. Techtree sells no model calls and charges nothing.
- Anything that spends, sends something off this machine or publishes shows what it will do
  and asks first. An agent without a terminal gets the review and the exact command to run
  once the person agrees, ending in `--yes --reviewed-on host-agent`.
- The Tasksmith Climb keeps six more tasks apart. Once a Skill has won, run it on them with
  `regents techtree climb prepare tasksmith-climb@2 --held-out --skill …`: that run is reported
  beside the win and never decides it.
- `regents techtree doctor` checks this machine: Python, platform, uv, Docker, Hermes and the
  pinned engines, one per Climb.
- Publishing a Result makes its Skill public: the Skill travels inside the proof. Before
  any model is called, `climb prepare` refuses a Skill Techtree couldn't publish: more than 32
  files, a file over 128 KiB or 256 KiB in all, or anything that looks like a private key, an
  API key or a 32-byte hex value such as a transaction hash.
- `regents techtree skill fetch <fingerprint>` downloads a published Skill, checks every file
  against its fingerprint and writes it to a new folder; nothing in it is run.
  `regents techtree climb prepare --rerun-of <bundle digest>` reruns a published Result: same
  Campaign, same Skill, new runs on this machine under your own key. A rerun is a report from
  your machine, not independent reproduction.

## Development

```bash
uv sync --all-extras
uv run playwright install chromium
uv run regents --help
make check
```

`make check` runs the linters, the type checker, the tests and the wheel check. It prints the
seed of the tests that try many made-up inputs; `make check SEED=<seed>` runs them again the
same way. A test that reaches past this machine fails, and on a Mac the Touch ID sign-in runs
whole in headless Chromium with a virtual Touch ID. It also fails when
[verification/features.yml](verification/features.yml), the feature map, is out of date or leaves
out a file changed since the last release; `make sync` rewrites it. The map lists each feature
with who uses it, how much is at stake, its files, its proofs and its known gaps, and every site
command beside the site's WebMCP tool for it. Before a release, `make release-check` also installs
the wheel into a new environment, runs every public read against the live sites, checking each
answer against the site's pinned API description, and fails when the Touch ID page differs from
the live sign-in server's or a protected feature the release touches has no property test or no
end-to-end test. `uv run scripts/record_replays.py` records the live reads again into
tests/replays/, which the tests replay offline.

MIT licensed.
