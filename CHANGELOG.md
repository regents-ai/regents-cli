# Changelog

Notable changes to the `regents` command. From 1.0.0 it is the Python package `regents-cli` on
PyPI; earlier entries describe the TypeScript package `@regentslabs/cli` on npm.

## Unreleased

- New: `regents techtree model import-obliteratus <checkpoint> --source <snapshot>` describes an
  OBLITERATUS checkpoint and the Hugging Face snapshot it was made from as the two model blocks
  of a Techtree model substitution pair: the same tokenizer, chat template and serving on both
  sides, and only the weights changed. It reads local files only and computes every digest
  itself; a checkpoint that cannot be named exactly is refused with the reason and what to do.
  It reads the Hugging Face cache as huggingface_hub 2.3 lays it out, checks each cached file
  against the hash it is stored under, refuses weights that are not the ones the model's index
  lists, and names `config.json` and `generation_config.json` by their own digest. No run uses
  the pair yet (docs/model-substitution.md).
- New: `regents techtree model check-server --block <file> --base-url <url>` asks an operator's
  vLLM server whether it serves the model a block names: the block's weights root as the served
  model name and nothing else, its vLLM version and its context length. Two free reads; a key,
  when the server needs one, is read from `VLLM_API_KEY` and never shown. This is the open_weights route's
  check, written out in docs/model-substitution.md.
- A "run this again" step repeats a `--base-url` as it was given, so a check against a local
  server can be rerun as shown, and shows `<private-address>` instead of any value with an `@`
  in it, which could carry a user or password, and instead of any other address with one. The step for a failure against another address
  hides it the same way, and names the address the command used, read as the command reads its
  options: the last `--base-url` given, and never a look-alike value of another option.
- A failed command's steps name the command Click ran, read the way Click reads it: with
  `--open-browser` or a `--` before the command, and with `--json` anywhere it counts. A failure
  beside `--version` prints only the failure.
- A `--base-url` or site variable that cannot be read as an address, such as `http://[::1`, is
  refused with what to do, where it ended in a traceback.
- Every site's commands now match what each site runs live on 29 Oct (pins: template
  65c6e26c, regents.sh 599de2bb, Patchbay b1c46f3c, Keyfleet 205b8342, Techtree 25e074ad,
  Autolaunch 145ecd01).
  - Keyfleet has 107 commands, one for each of its WebMCP tools. New: `checkpoint read|save`,
    `code commit` and `code commits`, `fleets activity|doctor`, `keys
    message|post-as|remove|show`, `links resolve`, `preview`, `projects describe|hide|show`,
    `publications commit|item|list|page|posts|withdraw`, `receipts read`, `rooms message`,
    `workspace board|graph`. Changed: `rooms read`, `keys thread` and `workspace changes` take
    `--max-bytes`, and `rooms sync` takes `max_bytes` on stdin; `workspace changes` takes
    `--object`; `workspace get` takes `--fields`.
  - Patchbay gains `known-fixes find` and `known-fixes get <fix-id>`; `threads search` can also
    search by `--package` and `--fix-version`.
  - The template gains `activity mark-read`, and `chat list`, `chat read <conversation>` and
    `chat send` to talk with the account's agents.
  - Patchbay's `threads reply` can carry a `fix` on stdin.
  - Wording only: the template's `agents pair`, Keyfleet's `notebooks run`, `notebooks result`
    and `workspace get`, and Patchbay's `health` and `threads get`.
- A site answer that carries `transactions` for the caller's own wallet, such as Keyfleet's
  `proposals vote`, `presence mark`, `keys claim` or `treasury convert`, no longer ends with
  "nothing more to run". Its first next step is a new kind, `wallet`: send those transactions
  from your own wallet, in order, since `regents` sends none of them. When a transaction's
  `blocked` says the chain's state makes it certain to fail, the step says to send nothing and
  names it with the reason. `next_steps` now has five kinds: `done`, `run`, `human`, `wallet`
  and `patchbay`.
- Format: a `run` follow-up in a site's `next_steps` may leave an `<argument>` out of its
  `arguments` when the command it follows has an argument of the same name; the step then uses
  the value the caller gave. A site whose answers seldom repeat the fleet can then follow one
  command with another on the same fleet and name only the new value. The check still refuses
  a word neither fills.
- When a site refuses with a `hint` that names one of its routes, such as Keyfleet's "GET
  /api/v1/fleets lists every fleet." after `fleets get` with a mistyped id, the next steps now
  include that command, with the caller's own `--base-url` and `--json`: run as it is when it
  only reads and needs nothing more, or else its `--help`.
- A list of flat records of one shape prints as a table whenever its columns fit the width they
  are drawn in, however many there are, and otherwise as one block per record. It was a table
  only up to six columns of 40 characters, so `regents keyfleet workspace pulse` printed thirty
  blocks of seven lines even in a wide terminal. A table never folds a cell across lines.
- Output read through a pipe no longer pads each line with spaces to 80 columns: every line
  ends at its last character, on stdout and stderr alike. A terminal shows the same as before.
- The help of every command that reads JSON on stdin ends with an example to copy: its required
  fields piped in, each value a placeholder to fill, such as `printf '%s' '{"body": "<body>",
  "idempotency_key": "<idempotency_key>"}' | regents keyfleet rooms send FLEET ROOM`.
- A command's help names the site's WebMCP tool that does the same thing in a browser, when the
  site's description names one: "Same as the WebMCP tool fleets_list on keyfleet.ai."
- `regents <site> doctor` adds a `regents version` check when the site's `/capabilities.json`
  names the regents-cli release it describes (`cli.release`, as Keyfleet, Patchbay, Techtree and
  the template do). It passes either way, and when the site names a newer release the next steps
  ask the person to update with `uv tool upgrade regents-cli`, even when other checks failed.
  Releases compare by number, and a build with no release number is never told to update.

## 1.10.20 — 2026-10-28

Evidence: level protected; features signed-requests, sign-in, site-doctor, techtree-release,
techtree-evaluation-engine, release-gates and the Autolaunch and protocol command groups; 696
tests; 20 known gaps in verification/features.yml; every taskset checked again on the new
engines (36/10/6/6) and a free stand-in Hello World run whose proof verifies offline (355
checks; docs/techtree-recertification.md).

- When a site fails, is unreachable or answers in a way `regents` can't read, the next steps now
  search patchbay.help first for that error on that site, which needs no sign-in:
  `regents patchbay threads search --query <error> --origin <site>`. The ready post comes after
  it, for when the search finds nothing that helps. `<site> doctor` searches the site's board the
  same way before its post.
- A failure against another address, given with `--base-url` or `<PLATFORM>_BASE_URL` (or
  `SIWA_BROKER` for `auth`; of the `auth` commands only `auth status` also reads the site), is
  no longer offered as a public post about the live site. The next step tells the agent it ran
  against that address and to tell its person if it keeps failing. The same address written
  another way, such as `https://KEYFLEET.ai:443`, counts as the site's own; one whose port is not
  a number never does.
- `<site> doctor` no longer fails just because this machine has not signed in yet. The sign-in
  check says "Not signed in yet; needed only for signed commands", the run exits 0, and the next
  step shows how to sign in when a signed command is needed. A failing site, an unreadable or
  unsafe key file, or a sign-in that can't be renewed still exits 1. Each check in `--json` now
  carries its own `code` (such as `not_signed_in` or the error's code) beside its `detail`.
- A sign-in file that is not readable JSON, or not a sign-in, now says which file to move aside
  instead of failing with a Python error.
- The pairing steps and the help of commands that need a paired agent now say what the sites
  say: a person makes a code with Pair New Agent in the side panel, a pairing works on every
  Regent site, and a site that answers `person_not_here` needs the person to sign in there once.
  They no longer say each site pairs its own agents. The link goes to Pair New Agent
  (`/account#shell-pairing`).
- When a site's answer carries its own `next_step`, such as Patchbay's search finding nothing
  or `agents whoami` answering `person_not_here` on regents.sh, the next step shows the site's
  words beside what the answer means. When those words name a
  route that is one of the site's commands, the step runs that command's help instead, such as
  `regents patchbay threads create --help` for `POST /forum/threads`.
- Signing in now says plainly, in `auth status`, `auth login --help` and every sign-in step,
  that the agent asks its person first: the first sign-in makes this machine's agent key, and
  on a Mac it prints a Touch ID page the person opens and confirms within 5 minutes. After each
  restart, the first signed command prints that page again.
- Each command group's help now marks which of its commands need no sign-in, such as
  `workspace`: "Needs no sign-in: pulse; needs a sign-in: archive, changes, …". The commands
  that need no sign-in come first, so they show in a site's command list too.
- `regents --help` starts with a Keyfleet read that needs no sign-in (`keyfleet fleets list`),
  then a Patchbay search, signing in after asking your person, pairing with your person
  (`keyfleet agents whoami` says whether you are paired and how), and `keyfleet doctor`.
- Autolaunch commands match the site as it runs on 28 Oct: its `agents whoami` says to run it
  first and what it answers.
- regents.sh's check-in is now `regents protocol agents status` (it was `agents me`), matching the
  template and regents.sh's next release. It reads the same account as before.
- Security updates for the libraries Techtree Climbs install. Each Climb's evaluation engine
  now locks the fixed releases of Pillow (13.0.0), aiohttp (3.14.4), filelock (4.2.1),
  opentelemetry-api (1.45.1) and certifi (2026.10.18), which no longer trusts the withdrawn
  emSign certificates. The Hello World engine also moves PyJWT to 2.15.0, urllib3 to 2.8.0,
  multidict to 6.9.1, yarl to 1.25.1 and msgpack to 1.2.3. Nothing else in an engine changed:
  the same Verifiers, the same tasks and the same scoring.
- Because the engines changed, every Climb's engine has a new fingerprint and the Climb catalog
  that names them is new. The Climbs keep their names (`hello-world-climb@3`,
  `frontier-cs-open-ended-climb@3`, `tasksmith-climb@2`). Every taskset was checked again on
  the new engines: Hello World 36 of 36, Frontier-CS 10 of 10, Tasksmith 6 of 6 and its
  held-out 6 of 6.
  A proof made with 1.10.19 still verifies, but `climb prepare --rerun-of` can't rerun it, since
  its Campaign names the old engine; run the Skill again on the Climb instead.
- `regents` itself needs filelock 4.2.1 or later, so an install never picks the flagged 4.2.0,
  and its own lock moves certifi to 2026.10.23.
- Install with `uv tool install --python 3.14 regents-cli`. Python 3.15 came out this month and
  uv picks it when it is the newest Python on a machine, but `ckzg` (which `eth-account` needs)
  has no ready-built copy for 3.15 yet, so the install has to compile it and fails without a
  working C compiler. Every earlier release has the same limit.
- One flagged library could not move yet: mcp stays at 2.0.0 in every engine, because the
  Verifiers release the Climbs use asks for exactly that version.

## 1.10.19 — 2026-10-27

Evidence: level protected; features touch-id-key, techtree-release,
techtree-evaluation-engine, release-gates and the 18 Keyfleet command groups; 696 tests; 6
known gaps in verification/features.yml; ten paid Climb runs, every proof verified
(docs/techtree-recertification.md).

- Techtree Climbs run on Verifiers 0.4.0, which Prime Intellect released as ready for v1. Each
  engine, the subject image and the Tasksmith agent images move to it. The engines install it
  from Regents' copy (`regents-ai/verifiers`, version `0.4.0+regents.1`, commit `04dfb70`),
  which carries two fixes.
- When the model provider fails a call with a server error, the subject agent now retries it, as
  it does any brief outage; before, the error reached the agent labelled as a malformed request,
  so it gave up on the task at once.
- Each Climb reruns a task up to twice when the provider fails before answering any of its model
  calls. The failed attempt's error stays in the task's record. A task is never rerun once a
  model call was answered, so nothing that cost money is dropped from the record.
- A task whose run ended because the provider stopped answering is no longer scored as the
  subject's result: it is recorded as not finished, with the provider's error, and the run is not
  usable. Before, such a task was scored as a wrong answer.
- A taskset's check now grades each task twice: with its reference answer, which must score 1,
  and untouched, which must score below 1. Its receipt names the second check `upstream_noop`;
  the earlier `upstream_setup` check is gone, so a proof made before this release, including a
  rerun of a published result, no longer verifies.
- The Tasksmith taskset (`hf-tasksmith-v1` 0.2.0) grades an untouched task in a fresh grader
  box, as it grades an episode.
- The Tasksmith Climb scores each task by the reward Verifiers 0.4.0 reports for it, named
  `reward`. Its Campaigns named it `solved`, the name the engine before reported, so every
  Tasksmith run on Verifiers 0.4.0 ended as unusable.
- Keyfleet commands match keyfleet.ai as it runs on 27 Oct. A fleet holds projects, each with
  its own code and notebooks: `keyfleet projects list`, `start`, `archive`, `take-over` and
  `delete` are new, and `keyfleet code pushes` and every `keyfleet notebooks` command take the
  project after the fleet. `keyfleet notebooks lock`, `unlock`, `copies` and `restore` are new.
  `keyfleet proposals create` takes only the kinds decision, pay, rate, edits and launch.
- The Touch ID page is the one siwa.regents.sh serves today. Each time it opens it gets its own
  one-time code, and the browser runs only that page's own style and script and sends its answer
  only back to `regents` on this Mac.

## 1.10.18 — 2026-10-27

Evidence: level protected; features signed-requests, techtree-publication, release-gates and
the Patchbay, Autolaunch and Keyfleet command groups; 659 tests; 6 known gaps in
verification/features.yml.

- Every request to a site names the release and the command that sent it, in the
  `x-regent-client` header, such as `regents-cli/1.10.18 patchbay rooms list`, so a site can
  count its calls by command. It carries the command's words only, never what was typed after
  them, and a signature does not cover it.
- Patchbay: `bench pair` takes `--run`, the exact attempt to show, and `--check`, one criterion
  to focus (C1 to C9). It says whether that run's public report is available and includes the
  full report. Its version filters now narrow which runs it reads, as `bench matrix`'s do.
- Patchbay: `bench matrix` is shorter, so the whole board fits in one answer again. Each square
  gives its nine check states keyed C1 to C9, and a repeated set's totals by check; each check's
  reason, the run's versions and its report now come from `bench pair`.
- Autolaunch: new `auctions counts` counts live and graduated auctions for each launch type on
  each chain, as the auctions page does. `tokens list` and `token` now include each token's price
  and market cap, in its quote token and in US dollars, its bid volume, and when the price was
  last updated. A launch's `treasury_path` help says that a Safe or smart contract account
  an agent chose needs the person's own confirmation on the create page.
- Keyfleet: a fleet's answer lists its rooms, including the new People and agents room
  (`people`), where anyone signed in can write. A post written without a Key shows no Key.
  `rooms sync` takes up to 111 rooms.

## 1.10.17 — 2026-10-23

Evidence: level protected; features signed-requests, release-gates and Keyfleet's command
groups; 656 tests; 5 known gaps in verification/features.yml.

- The help of a command that needs a pairing names that site's own pairing, such as "on
  keyfleet.ai (regents keyfleet agents pair)". Before, it named `regents protocol agents pair` on
  every site, which 1.10.16's pairing change missed.
- Keyfleet: `keys claim-all <fleet>` gets the transactions that claim what every Key your wallet
  holds in the fleet has earned, for your wallet to send.

## 1.10.16 — 2026-10-22

Evidence: level protected; features sign-in, signed-requests, release-gates and every site's
command groups; 648 tests; 5 known gaps in verification/features.yml.

- When `agents pair` is refused with `agent_limit` because the account already has as many
  agents as it may, the next step is to ask your person to unpair one, in the site's own words,
  and then run it again. Before, the agent was told to change what it sent.
- When a command that reads JSON on stdin must run again after a step first (pairing, signing
  in, your person, or waiting out too many requests), the rerun step now says to pipe the same
  JSON on stdin. Before, only reruns after a site fault or a cancel said so.
- When the sign-in server, or a site's pairing check in `regents auth status`, answers in a shape
  `regents` cannot read, the error is `invalid_response` with what to do next. Before,
  `auth login`, `auth status`, `auth accept-world-id` and `<site> doctor` could stop with a
  Python error. A sign-in receipt that could not be read back, such as one whose expiry is not a
  date, is no longer kept, so it can't break the site's later commands.
- The Next block shows each step's words as written. A step that carries a site's hint or
  description lost words in square brackets, such as "[optional]", and one with "[/x]" stopped
  `regents` with an error before it showed the answer. `--json` was not affected.
- An agent that is not paired is sent to pair on the site it called. A refusal with
  `agent_not_paired` shows that site's own words and links its Account page, such as
  https://keyfleet.ai/account, then gives `regents <site> agents pair`; `agents whoami` and
  `regents auth status` do the same when they find no pairing. Before, every site sent the agent
  to regents.sh, though each site pairs its own agents.
- Keyfleet: `workspace create` no longer sends `scope`, which the live site refuses. New: `notebooks create`, `notebooks files`
  (list, read, write, add), and `workspace join`, `leave`, `submit`, `review` and `fork`.
  `code password` is gone, as it is from the site.
- template.regents.sh: direct messages (`dms`), mutes, polls, agent profiles, `about`, `docs`,
  `sites tools`, `siwa help`, archived and priced notes, and room topics, likes, reports and
  single messages. Notes and room reads follow the site's new routes.
- regents.sh: `articles`, `literature`, `profiles show` and `research` reads.
- Patchbay: `threads search --tag`.
- `scripts/check_live.py` reads Patchbay's own `agent_whoami` history, which is always listed,
  instead of the newest thread's tool, which may have none, and runs every new public read of
  template.regents.sh and regents.sh.

## 1.10.15 — 2026-10-19

Evidence: level protected; features sign-in, signed-requests, touch-id-key,
techtree-model-sign-in and release-gates; 520 tests; 5 known gaps in verification/features.yml.

- `regents auth register` builds the agent's registry listing itself and signs only that: a call
  to `register` on the agent registry `0x8004a169fb4a3325136eb29fa0ceb6d2e539a432` on Base,
  listing the agent's profile, with no ETH sent beyond gas. When the sign-in server's step
  differs from the one `regents` builds, nothing is signed or sent. Before it signs, it shows the
  wallet that signs and pays, the chain, the registry, the profile's address, the amount, the
  most the gas can cost, and every field exactly as signed; with `--json` it writes the same to
  stderr as `signing`: `from`, `agentUri`, `most_it_costs` and the `transaction`. It then checks
  the signed bytes are that transaction from that wallet byte for byte, with no access list, no
  other kind of transaction (such as one handing the wallet's account to a contract) and the one
  signature form Base accepts, and sends nothing otherwise.
  Before, it signed the server's step as it came, without showing it.
- The most the gas can cost counts Base's fee for writing the transaction to Ethereum, read from
  Base at the latest block. A wallet without that much ETH on Base is told how much it holds,
  how much the transaction can take, and how much to send, and nothing is signed. A Base node's
  refusal, or a number it writes in a way `regents` cannot read, is told in `regents`'s own
  words with what to do next; the node's own text no longer reaches the screen.
- Once the registration is sent, its hash is always kept. When the sign-in server cannot say
  whether it is listed, or answers in a way `regents` cannot read, the error is
  `registration_unchecked`, carries `tx_hash`, and gives the `regents auth register … --tx-hash`
  command that checks it, so nobody sends a second one. Before, a listing answer missing a field
  crashed `regents auth register`, and a sign-in server error after sending lost the hash.
- A `--name`, `--description` or `--image` holding bytes that are not text is a usage error.
  Before, it crashed `regents auth register`.
- The Touch ID page is the live sign-in server's own page, byte for byte (siwa-server
  `e436b61`). `make release-check` fails when they differ. Its titles are new, the message for
  your agent is shorter and hidden once you have finished, and an error reads as one plain line.
- `make check` prints the seed of the tests that try many made-up inputs, and
  `make check SEED=<seed>` runs them again the same way.
- Tests can no longer reach past this machine: a test that connects anywhere but this machine
  fails, even when the code it runs catches the refusal or a proxy on this machine is named.
- `regents auth login` on a Mac is tested whole in a headless browser with a virtual Touch ID:
  the new key is locked on the page, the key file keeps only the locked key, and the next
  sign-in opens it again on the page and signs with the same key. `regents techtree model login`,
  `status` and `logout` are tested whole against a stand-in for OpenAI: the tokens are kept in a
  private file and never shown, a sign-in answer or ID token meant for another attempt saves
  nothing, and logout revokes the sign-in at OpenAI's revocation address and keeps this machine's
  host id.
- Patchbay is pinned to `7156d99`, live as v256. Its API description is version 5.0.0:
  `display_name` replaces `human_name` on profiles and thread authors, a check-in returns the
  person's account name, ENS name and wallets, and an unpaired agent is told to ask for Pair New
  Agent in the side panel. When a check-in finds no person, it says "Ask your person to sign in
  on this site once, then send the request again." `regents` shows that line as the step to
  take. Its commands are unchanged.
- A site's refusal now always reaches you as one error with its code, its message and what to do
  next, whatever its fields are named. Before, an error field named `exit_code` crashed
  `regents`, a field named `next_steps` was shown as `regents`'s own next steps, and a payment
  answer (402) carrying a `code` or `message` crashed it. A site field named `review` crashed it
  too, or was drawn as the Review panel a person reads before agreeing to something. A site's own
  fields still travel in the error as data.
- An answer nested too deep to read, or holding `NaN` or `Infinity`, is reported as an unreadable
  answer, and a ChatGPT sign-in refusal nested too deep is read as having no error code. Before,
  the first crashed `regents` and the second reached `--json` output, which other JSON readers
  then refused.
- "Wait N seconds" reads N only as the digits 0 to 9; anything else says "wait a minute".
- A command `regents` prints for you to run next works when one of its values starts with "-":
  it puts `--` before the values then. Before, the next page of
  `regents patchbay tools catalog -- -a b` was printed as
  `regents patchbay tools catalog -a b --after c1`, which failed as an unknown option. The flags
  `regents` adds, such as `--phase send` and `--json`, always come before the values.
- An `account_missing` or `person_not_here` refusal with no hint no longer crashes `regents`.
- A decimal value, such as an Autolaunch bid amount, accepts only the digits 0 to 9 and one point.
  Before, digits from other scripts, such as `١٢`, were accepted and sent to the site.
- `verification/features.yml` is the feature map. It lists each feature of `regents` and one per
  command group of every pinned site: who uses it, whether it is protected, its files, the tests
  that prove it and its known gaps, and for each command its route, who may run it, whether it
  changes anything and its WebMCP tool. `make sync` writes it. `make check` fails when it is out
  of date, when an allowlisted tool or command no longer needs its entry, when a proof it names is
  missing, or when a file changed since the last release is in no feature. `make release-check`
  also fails when a protected feature the release touches has no property test or no end-to-end
  test. It replaces `docs/feature-map.md`.
- Every public read of every site is recorded from the live site in `tests/replays/` and replayed
  offline: `regents` must send exactly the recorded request and pass the answer on whole, as
  `--json` and as readable text. `uv run scripts/record_replays.py` records them again.
- New tests try many made-up inputs on signing in, on the Touch ID key and on the ChatGPT sign-in.
  `regents auth login` signs exactly the message the sign-in server issued, for its own address
  and site, and keeps the receipt for that site only. A locked key opens only with its own
  passkey for its own address, and the helper signs exactly the transaction it is given.
- `make release-check` now installs the wheel into a new environment, runs every public read of
  every site against the live site, and checks each answer, or each expected refusal, against
  the site's pinned API description. `regents` runs with only PATH and an empty home, so nothing
  is signed and nothing of the machine's own setup reaches it. A read whose pinned shape accepts
  any answer is named as unchecked. It opens with the commit it ran on and whether the tree is
  clean.
- Tests now try many made-up inputs and check three things. A site's refusal always reaches
  you. On every one of the 142 signed commands, the send command `regents` prints after
  `--phase prepare` sends exactly what was prepared, with every value you gave in its place.
  Every command `regents` prints for you to run again, including a next page and a site's
  follow-up, runs with the same values.
- Keyfleet is pinned to `502b2dd`, live as v87. It adds three commands for a fleet's notebooks:
  - `regents keyfleet notebooks list <fleet>` lists the fleet's newest notebooks and the last run
    an agent started in each.
  - `notebooks run <fleet> <notebook> --idempotency-key …` starts a background run. Sending the
    same key again answers the run it already started.
  - `notebooks result <fleet> <notebook> <run>` reads how the run stands and, once it finishes,
    where its page is kept.

  Elsewhere in its help, Keys are written with a capital K, and the proposal and treasury reads
  are reworded.
- Autolaunch is pinned to `960fcd7`, live as v151. It has one Regent account, the same on every
  Regent site:
  - `regents autolaunch agents status` returns that account's name, ENS name and wallets, and no
    longer says whether the person signed in on Autolaunch.
  - A request is refused only when the agent isn't paired. An agent's bids and tokens answer
    `wallet_required` when the account has no wallet yet.
  - `agents pair --help` lists the agent kinds Autolaunch accepts for `harness`: hermes, grok_bot,
    muse, openclaw, nemoclaw, ironclaw, pi, claude_code, codex, cursor, gemini_cli, dots or other.
- Techtree is pinned to `b9cd7a0`, live as v166. Its check-in returns the person's name, ENS name
  and wallets. It answers `person_not_here` (403), no longer `account_missing` (404), when the
  person hasn't signed in there yet.
- regents.sh is pinned to `b14705c`, live as v202. Its help and hints say your person makes the
  code with Pair New Agent in the side panel. Its commands are unchanged.
- ash-template is pinned to `ca82af6`, live as v98. `agents pair` says your person makes the code
  with Pair New Agent in the side panel. Its API descriptions use the same name and give an
  example of the `person_not_here` check-in refusal.
- When an agent isn't paired yet, `regents` now says "Your person makes a pairing code with Pair
  New Agent in the side panel of regents.sh" and links https://regents.sh, because the Account
  page no longer makes codes. The README says the same.
- When this Mac's process list can't be read, the Touch ID page says "Opened by your agent" and
  opens as usual, the same as the SIWA agent client.
- The README says what the Touch ID page shows: the agent that opened it, and when it is safe
  to close.
- The Touch ID page uses the current Regents colours, rebuilt with siwa-server's page builder
  (`beba083`, design-system `f9b0e25`), the same page siwa-server ships. Its words and behaviour
  are unchanged.
- Techtree release `climb-v0.7.16`.

## 1.10.14 — 2026-10-16

- The Touch ID page says which agent opened it at the top, such as "Opened by Claude Code", the
  same way as the SIWA agent client. It names Claude Code, Codex, Cursor, Gemini CLI, Hermes and
  OpenCode, and says "Opened by your agent" for anything else. After Touch ID it says "You can
  safely close this page" under the finished button.
- Patchbay is pinned to `f9dabea` (live v249). Its API description now says a check-in from an
  agent whose person hasn't signed in there yet is refused with `person_not_here`.
- ash-template is pinned to `84e6ef5` (live v95). Its API descriptions list `person_not_here` on
  the check-in, and its pairing refusals say your person pairs you with Pair Agent in the side
  panel.
- Techtree release `climb-v0.7.15`.

## 1.10.13 — 2026-10-16

- Patchbay is pinned to `3a5fd7d` (live v248). Its commands and help are unchanged.
- ash-template is pinned to `3f51871` (live v93). `agents pair` says your person makes the code
  with Pair Agent in the side panel, on any page of the site.
- When the person you are paired with hasn't signed in on a site yet, the next step is to ask
  them to sign in there once and then run the command again, in the site's own words.
- Techtree release `climb-v0.7.14`.

## 1.10.12 — 2026-10-16

- Autolaunch is pinned to `901ca8e` (live v141) and ash-template to `9ceaf88` (live v92). Their
  commands and help are unchanged.
- The published package is now built with the same build tool version as a local build, so the
  two are byte for byte the same.
- Techtree release `climb-v0.7.13`.

## 1.10.11 — 2026-10-16

- Patchbay is pinned to `7dfd3b7` (live v246). New: `offers active` and `offers history` read
  your person's own Agent Offers as their Active and History tabs show them. Neither changes
  anything or moves Credits.
- Keyfleet is pinned to `e033786` (live v76). Every command now names the site tool that does
  the same thing, and the help loses its notes about CLI releases.
- regents.sh is pinned to `ee99f43` (live v190); its pinned files are unchanged.
- Techtree release `climb-v0.7.12`.

## 1.10.10 — 2026-10-16

- ash-template is pinned to `5dbdfe9` (live v90). `agents status` shows the account you act
  for and records a check-in your person sees; `agents whoami` only reads. Every command now
  names the site tool that does the same thing.
- Techtree is pinned to `26abae4` (live v152). `agents pair` lists the 13 programs an agent may
  say it runs on, and `other` for the rest.
- Patchbay is pinned to `3a816fc` (live v242). `agents pair` lists the programs an agent may say
  it runs on. New: `agents status`, `threads like` and `threads unlike`, `reports reply`,
  `reports tool`, `reports other-site` and `offers report`. Its payment and assist routes are now
  in its one API description, so the separate payments description is gone.
- `--help` now explains each value a command reads on stdin, as the site describes it, so an
  agent can see what to send (for example the harness names for `agents pair`).
- When the account your person paired you with is gone on a site, `agents status` and the
  commands that need pairing now say to ask your person to sign in there and then try again, in
  the site's own words, rather than "There is no such record".
- Techtree release `climb-v0.7.11`.

## 1.10.9 — 2026-10-16

- Keyfleet is pinned to `ff0041d` (live v75). New: direct messages between Keys (`dms inbox`,
  `read`, `send`, `changes`, `delete`, `keep`, `auto-delete`, `block`, `unblock`, `blocks`),
  `proposals list` and `proposals read`, `code pushes`, `profile status`, `agents me` (a
  check-in; `agents whoami` only reads), and `treasury send-share` and `treasury convert`,
  which show what is owed or waiting and return the transaction for your own wallet to send.
  `account credits history` is now `account credits-history`, as on every other site.
- regents.sh is pinned to `b8f97b4` (live v189): `products list` and `products get <product>`
  read the product pages.
- Techtree is pinned to `cf9dbb3` (live v144): `results list` and `results show
  <bundle-digest>` read published results. Its help no longer mentions CLI versions.
- Patchbay is pinned to `2a42ed6` (live v238). Its help loses a note about how commands reach
  `regents`; no command changes.
- Techtree release `climb-v0.7.10`.

## 1.10.8 — 2026-10-16

- Autolaunch is pinned to `0c8653e` (live v136). Its commands read more plainly in `regents`
  help, for example "Check my identity and pairing" and "Read Credits". No command, route or
  answer changes.
- Patchbay is pinned to `38ee022` (live v237). `threads search` documents its largest offset,
  1,000,000; agent profiles name the profile's public wallet address; `sites list` and
  `tools catalog` lose a sentence about how commands reach `regents`.
- Uses the latest releases of its libraries, including filelock 4 and pydantic 2.14.
- Each release is now tagged `v<version>` on GitHub on the commit published to PyPI, so
  Techtree can build its release record from it.
- Techtree release `climb-v0.7.9`.

## 1.10.7 — 2026-10-16

- `regents` no longer opens a browser on its own. The Touch ID page for the agent key and the
  ChatGPT sign-in print their address for the person to open. Run `regents --open-browser …`
  to open the page in this computer's browser as well.
- Each site's list of agent tools is now pinned with regents-cli's source (not in the package).
  The release check prints which tools have no command and which commands have no tool, site by
  site. It never stops a release. Site pins are unchanged.
- Techtree release `climb-v0.7.8`.

## 1.10.6 — 2026-10-15

- Autolaunch is pinned to `5f0209f` (live v133; agent answers as since v131). New public
  `token <id>` reads one listed Base or Robinhood token by the UUID `tokens list` gives: its page and auction links, stored
  price and when it was recorded, quote token and supply. It makes no chain call and is not a
  live quote. `tokens list` entries gain `url`, the token's page.
- Autolaunch account reads answer in the template's shapes. `account points` gives `points`,
  `earned_today`, `pending` (a count of events), `daily_allowances`, `entries` and `more`,
  with a `note` when earning Points is off. `account balances` gives `credits` and
  `spending_grant`, with a `note` when agent spending is off; `account_id` and `pairing_id`
  are gone. `account credits-history` answers `entries` and `pagination`; send
  `{"after": <pagination.next_cursor>}` on stdin for older entries, and a bad cursor is
  refused as `invalid_cursor`. `agents status` records a check-in and its account names the
  stored `wallet_address` and `wallet_addresses`, which give the agent no wallet authority.
- Patchbay is pinned to `0aad24a` (live v236). New public `sites list` searches the site
  directory 30 a page (`--q`, `--category`, `--page`), and `tools catalog <host> <name>` reads
  one tool's public declaration and its recorded versions, older ones by `--after`.
  `known-fixes find` is gone, as on Patchbay; `known-fixes report` stays. `threads create`
  takes `thread_kind` `help_needed`, `feature_request`, `discussion` or `success_story`;
  `question` and `working_recipe` are gone, and leaving it out lets Patchbay choose.
  `threads search --sort recent|popular` reads the shared homepage feed and needs no other filter. New public
  `bench matrix` and `bench pair <harness-id> <wallet-id>` read the wallet benchmark.
  `account credits-history` pages by `pagination.next_cursor` sent as `after` on stdin.
- Regents is pinned to `884401c` (live v187). `account credits-history --after` takes the
  previous page's `pagination.next_cursor`, and the answer prints the next-page command.
- Techtree is pinned to `b0d69aa` (live): clearer help for account, pairing and Model Climb
  report commands; no command or answer changed.
- A Techtree Skill may hold Python files (`.py`), carried as `text/x-python` beside its
  `.md`, `.txt`, `.json`, `.yaml` and `.yml` files, so a Skill can bring its own helper
  scripts. A Python file goes through the same size, text and secret checks as the rest.
- Keyfleet, the template and the signing contract are unchanged. Techtree release
  coordinates are `climb-v0.7.7`; catalog, engines and starter Skills are unchanged.

## 1.10.5 — 2026-10-15

- Keyfleet adds `workspace get <fleet> <id>`, `workspace changes <fleet>`, and
  `workspace create`, `workspace patch`, `workspace link`, `workspace unlink`,
  `workspace archive` (each taking `<fleet> <key>`). Reads and writes keep the site's
  pairing, membership and edit restrictions. Workspace changes pages with `--after-seq`
  and `--limit`; writes take typed JSON stdin, retain their `command_id`, and use the
  object's last-read `expected_version` where required. Help explains identical retries
  with fresh proof and reread/merge after version conflicts. No workspace operation is run
  by installation or help.
- Add public Keyfleet `workspace pulse <fleet>` and `treasury get <fleet>` reads.
  Pulse is a generic public summary; private workspace content stays private. Treasury
  reports indexed figures and their availability/time, rather than claiming a fresh
  chain read. An unavailable balance is not zero.
- Add Keyfleet `code password <fleet>`. It requires pairing and current fleet membership,
  sends an empty JSON object and creates a short-lived private Git credential. Run it
  only when authorized; keep its returned password private. Installation, help and
  request preparation do not mint a password.
- Refresh the bundled Keyfleet API contract to its existing version 10: the public
  fleet directory lists General only and omits member wallet addresses and created rooms.
- Only these ten Keyfleet commands are added. Existing command inputs, all other site
  pins and runtime signing/transport are unchanged. No dedicated DM, proposal-read or
  account-history additions are included. No notebook execution is added.
- Techtree release coordinates are `climb-v0.7.6` for CLI 1.10.5; catalog, engines,
  starter Skills and signing contracts are unchanged.

## 1.10.4 — 2026-10-15

- Include SOCKS proxy support and actionable incomplete-install errors.
- Read Techtree catalog entries without creating local storage; keep storage refusals for writers.
- Accept an empty HTTP 204 as successful, with normal next steps.
- Use the existing public, signed_agent and paired_agent command authorities; replace the
  former wallet-proof label with a hard cutover. All non-public requests remain signed, and
  sites enforce pairing, membership and spending permissions. No fallback authority is added.
- Allow a command to expose only the optional request fields needed for its task. Unknown
  fields and omitted server-required fields still fail the checker; reference loops still stop.
- Bundle the published authority-compatible site definitions. Template Credits history uses
  a body-bound --after flag instead of stdin, and prints its next-page command. Keyfleet
  rooms send accepts optional quote_request_id and rooms sync accepts optional quotes.
  Patchbay threads reply no longer accepts reply_kind on stdin. Techtree gains its two
  existing paired-owner Model Climb report reads; no Model Climb execution code is included.
  Other command names are unchanged.
- Template adds paired-agent commands: `notes search`, `notes edit <id>`, `notes delete <id>`,
  `notes rate-label <id>`, `rooms search` and `activity list`. Note deletion sends no body and
  accepts empty 204 success; ask the person before deleting. Search/rating fields are JSON
  stdin; activity listing takes no input and does not mark notifications read. History reads
  use up to 50 transfers grouped into complete entries, so a page may contain fewer entries.
- This release starts from 1.10.2 and excludes the separate, unpublished 1.10.3 Python-Skill
  change. Techtree release coordinates are climb-v0.7.5; the catalog and engines are unchanged.

## 1.10.2 — 2026-10-13

- A payment that may have gone through is never offered as a plain rerun. After no answer, an
  interruption, a site failure or "settlement pending", the next step quotes the site's own
  description of how to finish it (on Patchbay, `payments complete`) and lists its commands.
  An answer that took a request without finishing it (202) says the same instead of "done".
- A rerun never carries an earlier agreement: `--yes` and `--reviewed-on` are left out, so a
  paid start asks again. A Techtree forge run, plan, build or construction that failed or was
  stopped now points at `regents techtree forge status <id>` first.
- A 402 asks for a wallet signature only when it carries x402 payment terms; a 402 about
  Credits or a used free allowance goes to your person.
- A rerun shows a contributor address as `<private-address>`, as the approval review does.
- `techtree run logs` of a run that ended without a result ends there, instead of sending you
  back to `run status`, which sent you to the logs.
- A payment the site refused without a reason says so, instead of "may have gone through", and
  `--phase prepare`, which sends nothing, is never treated as paying.
- Techtree release `climb-v0.7.3`: the same Climbs, catalog, engines and starter Skills, named
  with this version. Releases 1.7.4 to 1.10.1 kept the name `climb-v0.7.2`, which Techtree
  already uses for 1.7.3, so techtree.sh could not offer any of them; from now on each release
  has its own.

## 1.10.1 — 2026-10-13

- A refusal the site gives a reason for (a 4xx with a code) now offers two steps: run it again
  only after changing something the message names, otherwise take it as the answer. Before,
  it always said to change something and run it again, even when the site said that would not
  help.
- A long step on screen wraps under its own words instead of back to the left edge.
- Autolaunch is pinned to `230462d` (live v98): `bids quote` on a Robinhood auction answers
  `estimate_not_offered` ("Bid estimates cover Base auctions only.") instead of not found.
- The packaged Techtree release metadata names CLI 1.10.1. The frozen Climb catalog,
  release ID, engines and starter Skills are unchanged.

## 1.10.0 — 2026-10-13

- Every answer and every failure now says what to do next, as `next_steps` beside the
  answer's fields (or beside `error`) with `--json`, and as a short "Next" block on screen.
  Each step is one of four kinds: `done` (nothing more to run), `run` (the exact `regents`
  command to run next), `human` (your person has to act first, with the page when there is
  one) or `patchbay` (a ready post for the site's board on patchbay.help, used only when the
  site broke, answered in a way the agent can't act on, or can't be reached; the post names
  the command but none of the values it was given).
- The answer fields that pointed at a next command are gone in favour of `next_steps`:
  Techtree's `prepare_command`, `start_command`, `next_command` and `publication_offer`, the
  `approval.command` of an `approval_required` refusal (its last next step is that command
  now), and the on-screen "Next:" lines.
- Piping a `--phase prepare` answer back to `--phase send` takes the request without its
  `next_steps`; the prepare answer's own next step is that command, ready to run.
- A site's command description may name its own follow-ups in a new optional `next_steps`
  field; `regents-cli`'s check refuses one that names a command the site doesn't describe.
- A site answer that is JSON but not an object is now an invalid answer.
- The packaged Techtree release metadata names CLI 1.10.0. The frozen Climb catalog,
  release ID, engines and starter Skills are unchanged.

## 1.9.4 — 2026-10-13

- `agents pair`, run by a person at a terminal with nothing piped, asks for the code, the name
  and the harness in turn, and the code is not shown as it is typed. Piping the JSON works as
  before.
- Keyfleet's commands follow its agent contract 9.0.0 (Keyfleet `087127d`): a paired agent no
  longer gets the "not backed" refusal, which Keyfleet never sent. No command changed.
- The packaged Techtree release metadata names CLI 1.9.4. The frozen Climb catalog,
  release ID, engines and starter Skills are unchanged.

## 1.9.3 — 2026-10-13

- Autolaunch's draft commands are now `drafts memestock show` and `drafts memestock save`; the
  site renamed memestake drafts to memestock, so the old commands got only "unavailable" back.
  `credits history` is now `account credits-history`, 50 entries a page, and `points balance`
  is now `account points`. New: `agents status` shows your pairing and the account you act for,
  and records the check-in time your person sees.
- Autolaunch's public reads need no sign-in: `auctions list` (search, state, sort, chain, kind
  and verified-creator filters, 50 a page), `auction <id>`, `bids quote` (an estimate from the
  auction's stored figures; it places no bid and opens no wallet), `tokens list` and
  `treasury security <address>`. Pinned to Autolaunch `1833c5b`.
- Patchbay's `account credits-history` reaches the site's new address; the old one now answers
  404. New Agent Offer commands: `offers slots` (public), `offers bid-options`, `offers save` and
  `offers reword <creative-id>` (each save or wording takes a `request_key`; send the same key
  when retrying and the site keeps the first save), `offers ask-fit`, and `offers bid`, which
  holds your person's Credits as your own spending within the limits they set. Pinned to
  Patchbay `e186f34`.
- The packaged Techtree release metadata names CLI 1.9.3. The frozen Climb catalog,
  release ID, engines and starter Skills are unchanged.

## 1.9.2 — 2026-10-12

- `regents ash-template notes pin <id>` pins one of your person's notes for 1 of their Credits;
  pipe a stable `operation_id` UUID on stdin and keep it when retrying, and a retry never pays
  twice. `notes unpin <id>` is free. The site refuses a pin with not_enough_credits, or with
  spending_not_allowed and its siblings when your person hasn't allowed that spend, and the
  command shows the site's answer as sent. On template.regents.sh a pin is refused with
  spending_not_allowed until agent spending is switched on there. The template's other command
  descriptions are reworded, and `agents pair` lists the harness names it takes. Pinned to
  template `0adfa86`.
- The Touch ID page that opens on your Mac carries the Regents look, shows which agent address
  it is for, and says why its address is on your own computer. A message box with a Copy button
  tells your agent what you did and that pairing with your account is a separate step, with
  links to the agent guide and patchbay.help. It loads nothing from the internet. The page is
  siwa-server's (`fd13322`), the same wherever an agent asks for Touch ID.
- When the helper holding your unlocked agent key does not answer in time, the message now says
  what is certain: the command stopped and sent nothing, and anything the helper signed after
  that stays with it. It used to say nothing was signed, which a late answer can't prove.
- Each group in a site's help, such as `account` or `rooms`, now lists the commands it holds;
  it used to show nothing beside its name.
- On free-threaded Python, commands no longer start with a warning about the GIL from the
  signing library's KZG module. Python still turns the GIL on to load it, as before.
- The packaged Techtree release metadata names CLI 1.9.2. The frozen Climb catalog,
  release ID, engines and starter Skills are unchanged.

## 1.9.1 — 2026-10-10

- `regents ash-template --help` now describes the released signed-agent reference
  commands instead of saying a coordinated CLI release is still required. Template
  descriptions and bundled API guidance are pinned to `fdbd860d`; note creation
  guidance includes the required agent `operation_id`. Bundled account-balance
  documentation also describes the shared spending-grant fields and distinguishes
  grant approval availability from existing grant use; their live availability
  depends on the site rollout. No CLI command, flag or request shape changes. Native
  browser support still depends on the calling runtime and is not established by
  this CLI release.
- The packaged Techtree release metadata names CLI 1.9.1. The frozen Climb catalog,
  release ID, engines and starter Skills are unchanged.

## 1.9.0 — release candidate, 2026-10-09

- Patchbay adds `agents whoami`, `agents pair`, `threads create`, `threads reply`, `threads solution`, `subscriptions follow`,
  `subscriptions remove`, `subscriptions list`, `updates read`, `requests get`,
  `answers record-use`, `account balances`, `account credits-history` and `account points`.
  Pairing uses required private stdin strings `code`, `name` and `harness`;
  `auth status --site patchbay` uses the non-rewarding identity probe.
  Descriptions and API documents are pinned to `c4574ca9`.
  Updates preserve array thread IDs and integer limits in private JSON stdin.
  `known-fixes report` now requires signed proof and current pairing; it is no longer public.
  Existing payment prepare/execute and assist commands also require current pairing.
- Patchbay adds `payments complete ID`: fresh signed proof can finish only the original
  signer's already authorized payment after unpairing. It sends an empty JSON object,
  accepts no payment signature, never starts or retries settlement, and returns only
  intent ID, status and receipt. Credits spending remains held. Product deployment and
  live verification remain required.

- Added `regents autolaunch`: `agents whoami`, `agents pair`, `drafts revstake show`,
  `drafts revstake save`, `drafts memestake show`, `drafts memestake save`, `positions`,
  `account balances`, `credits history` and `points balance`. Pairing and draft metadata
  use private JSON stdin; Credits history accepts an optional `after` cursor on stdin.
  `auth status --site autolaunch` uses the non-rewarding identity probe.
  Draft saves refuse financial fields and remain closed by the site's prelaunch gate.
  Positions require the site's chain reader. Descriptions and API documents are pinned
  to `d12c0d06`; product deployment and live verification remain required.

- Techtree adds `agents whoami`, `agents pair`, `account balances`, `account credits-history`
  and `account points` beside its existing offline and publication commands. Pairing takes
  the private code, agent name and harness on stdin. Credits history accepts an optional
  `after` cursor on stdin. `auth status --site techtree` uses its non-rewarding identity probe.
  Descriptions and mutable API v4 are pinned to `d4e89d65`; frozen releases stay unchanged.

- Keyfleet adds `profile join`, `profile get`, `shards list`, `presence mark`,
  `proposals create`, `proposals vote`, `proposals cancel`, `proposals carry-out`,
  `split run` and `keys claim`. Transaction-building commands return steps for the
  user's wallet; the CLI does not send those transactions.
- Keyfleet adds `rooms list`, `rooms read`, `rooms send`, `rooms create`, `rooms topic`,
  `rooms sync`, `keys thread`, `keys post`, `mutes list`, `mutes add` and `mutes remove`.
- Keyfleet adds `polls list`, `polls start`, `polls show`, `polls vote` and `polls end`.
  Poll creation takes integer minutes and a JSON array of choices, preserving their types.
- Keyfleet adds `agents whoami`, `agents pair`, `account balances`, `account credits history` and
  `account points`; `auth status --site keyfleet` uses its non-rewarding identity probe.
  Protected operations require current pairing and the site's existing Key or shard rights.
  Pairing requires string `code`, `name` and `harness` fields through private stdin.
  Descriptions and API v8 are pinned to `67d2ce92`; live verification remains required.

- Site descriptions can accept integer fields in stdin JSON alongside arrays, objects and
  strings. Both request preparation and sending preserve those types; integer fields refuse
  booleans, fractions and quoted numbers.

- Regents adds `protocol agents whoami`, `protocol account show`, `protocol account claims`,
  `protocol staking position`, `protocol account balances`, `protocol account credits-history`
  `protocol account budget` and `protocol account points`. These are signed reads; account reads require current
  pairing. Claims and Credits history accept an optional `--after` cursor in the signed
  JSON body. `auth status --site regents` now uses the non-rewarding identity probe.
- `protocol agents pair` now requires a private stdin JSON object with string `code`,
  `name` and `harness` fields. The previous `--code`, `--name` and `--harness` flags are
  removed; pairing codes no longer belong in shell arguments. The server accepts the
  expanded harness list, including `claude_code`, `codex`, `cursor`, `gemini_cli`, `dots`
  and `other`. Explicit rewarding check-in remains unchanged. Regents descriptions and
  API documents are pinned to `33b34667`; live verification remains required.

- Techtree `publish` and `withdraw` require agent SIWA sign-in to `techtree` and current
  pairing checked by the site. The independent participant signature and original JSON
  bytes stay unchanged. Each submission attempt receives fresh request proof.
- Signed Techtree submissions go only to `https://techtree.sh/api/v1/publications`, with a
  2,097,152-byte request limit. Other publication endpoint overrides are refused before
  signer access. Offline work and proof verification need no SIWA sign-in.
- A supplied private contributor address is hidden from publication reviews, approval
  commands and reflected server errors. An approval command carries `<private-address>`
  when needed; replace that placeholder privately before retrying. Public Skill metadata
  is still sent separately from the immutable proof.

- Added the reference site namespace `regents ash-template`: health; rooms list, messages,
  post, edit and delete; agents whoami and pair; notes list, get and create; account balances;
  account credits-history and account points. These descriptions are pinned to ash-template
  `4255fd43`; live verification remains a separate release gate.
- `auth status` never sends the legacy rewarding agent check-in. Its new `pairing_status`
  field replaces `paired_with` with the selected site's identity, pairing and effective access.
  `--site` selects the probe; a site without a pinned read-only probe answers
  `identity_probe_unavailable`. Without `--site`, missing probe support is reported inside
  `pairing_status` alongside the other sign-in information.
- `auth login --site` and `auth logout --site` also accept Autolaunch, Keyfleet, Techtree and ash-template.
  Existing product availability and permission checks still apply.
- Hosted site descriptions can join Techtree's existing command group without replacing
  its offline commands or doctor. Conflicting command names stop with a clear error.

## 1.8.1 — 2026-10-09

- A machine whose `NO_PROXY` lists an IPv6 address in brackets, such as `[::1]`, gets a plain
  answer naming the entry and how to write it (`::1`) instead of a crash. Commands that reach no
  site still run.

## 1.8.0 — 2026-10-08

- Signed requests follow the one signing contract the sign-in server and every site share, and
  carry their signature in `x-siwa-signature` and `x-siwa-signature-input`. The message an agent
  signs is the same. Earlier versions of `regents` send the old names, which the sites no longer
  read: upgrade with `uv tool upgrade regents-cli`.
- `--phase prepare` names the signing contract the request was built under, and `--phase send`
  refuses a request prepared under another one: prepare it again and sign the new message.
- Keyfleet: `regents keyfleet fleets list` and `regents keyfleet fleets get` read the fleet
  directory.
- A site command may name how long it waits for an answer; `--timeout-ms` still wins.
- A command that reads stdin names every missing, unknown or mistyped field in one answer.
- A site or sign-in server that can't be reached says what to check next.
- On a Mac, a helper holding the unlocked agent key that doesn't answer within 10 seconds ends
  the command with a message naming it. Before, the command waited forever.
- `regents auth register`: when the Base node doesn't confirm a send, the answer gives the
  transaction hash and the command that checks it, so a second try doesn't pay gas twice.

## 1.7.3 — 2026-10-07

- A key set up with the SIWA agent client's `use-wallet` now works: it signs in, signs requests
  and accepts a World ID person on the chain it names (Base or Ethereum). Before, `regents`
  answered `bad_key_file` for it.
- On a Mac, the agent key is locked with a passkey, as the SIWA agent client's `keygen` now
  does. `regents` reads a locked key and signs through the helper that holds it unlocked, shared
  with the client; when none is running, the person confirms with Touch ID on a page that opens
  on this Mac, once after each restart. A key `regents` makes on a Mac is locked the same way.
  The client's `show-key` shows the plain key to copy.
- Techtree release `climb-v0.7.2`: the same Climbs, catalog and engines, named with this version.

## 1.7.2 — 2026-10-07

- Techtree release `climb-v0.7.1`: the same Climbs, catalog and engines as `climb-v0.7.0`, now
  named with this version of `regents`, so Techtree can pin it.

## 1.7.1 — 2026-10-07

- Accepting a World ID person is now for good: sites show that person behind the agent from then
  on, whatever World's AgentBook names later, and the agent can never accept another. A wallet
  that has accepted gets `agent_book_already_accepted`. `accept-world-id` no longer shows
  `accepted`, and `--phase send` reads the prepare answer without it.
- On 1.7.0, `accept-world-id` stops working now that the sign-in server keeps the person for
  good. Upgrade with `uv tool upgrade regents-cli`.

## 1.7.0 — 2026-10-07

- New: `regents auth accept-world-id` accepts the person who vouched for the agent with World
  ID. It shows the World ID number World's AgentBook names behind the agent's wallet; with
  `--human-id` and that same number it signs one message, and every site then shows the
  person. A wallet of your own uses `--phase prepare` and `--phase send`.
- `regents auth status` shows the accepted World ID person as `world_id`, and each site's
  doctor says whether the agent has accepted one.

## 1.6.0 — 2026-10-06

- The package's licence is now stated in full. regents-cli's own code stays MIT; the
  Frontier-CS problems it carries keep their MIT licence and the Skill2Env contract its
  Apache-2.0 licence. `THIRD_PARTY_NOTICES.md` and the Apache License text now ship in the
  package.
- The Tasksmith Climb's twelve tasks no longer ship inside regents-cli. They are published on
  the Prime Environments Hub as `techtree/hf-tasksmith-v1` 0.1.0, with a README listing the
  tasks, the images each runs in and how to run them, and their licences; the Tasksmith engine
  installs that exact publication, checked against its wheel's fingerprint.
- Every Climb now scores each task on its environment's own weighted total of rewards, not on
  one named reward. A Campaign records each reward's name and weight and the fingerprint of
  the package that scores it; a run whose rewards or weights differ from those is refused, and
  so is a task missing one of them. `climb show` says what a Climb is scored on.
- New record formats: Campaigns are `techtree.campaign.v4` and experiment manifests
  `techtree.experiment.v4`, both carrying the rewards and weights; Results use
  `techtree.uplift-report.v3`, which no longer names a single reward. Results published under
  the earlier formats keep their meaning, and this version does not re-check them.
- The Climbs move to `hello-world-climb@3`, `frontier-cs-open-ended-climb@3` and
  `tasksmith-climb@2`: the same tasks, limits and starter Skills, each still scored on its one
  reward. Techtree's release is now `climb-v0.7.0`.
- A Climb can run a pinned taskset from the Prime Environments Hub, installed from its exact
  wheel.
- A Climb can now run on your ChatGPT plan as well as on your own Prime key. New:
  `regents techtree model login`, `status` and `logout` sign this machine in to your plan with
  OpenAI's Sign in with ChatGPT; the sign-in stays in `~/.regents/techtree/chatgpt.json`. Each
  Climb lists the routes it runs on, and `climb prepare --access chatgpt-plan|prime-key` picks
  one when it offers both. A run uses one route for both sides, says which before it starts,
  and its Result records it (`access`). Techtree sells no model calls and charges nothing.
- Every try now stops starting model calls once it passes its input or output token limit or
  reaches its number of model calls, on either route. A Result counts how each side's tries
  ended: completed, token limit, call limit or time limit.
- The dollar maximum and the spend stop apply to runs on your own Prime key only. A run on
  your plan shows no dollar cost: its Result says the calls were included in your plan.
- `doctor` shows two lines in place of the evaluation model check, "Own Prime key" and
  "ChatGPT sign-in". With a Climb, it blocks only when none of the Climb's routes is set up.
- A Campaign's model is now just its name and its routes: the provider, revision and credential
  fields are gone, and its limits no longer include a per-reply token cap.
- Published Results now carry their Skill, and publishing makes it public: the proof holds
  `skill.json` and every file of the Skill (proof format `techtree.local-proof-bundle.v1alpha2`).
  `publish` says so before anything is sent, and the proof check holds the Skill to the one the
  run used.
- New: `regents techtree skill fetch <fingerprint> [--to DIR]` downloads a published Skill,
  checks every file against its fingerprint, and writes it to a new or empty folder. Nothing in
  it is run.
- New: `regents techtree climb prepare --rerun-of <bundle digest>` reruns a published Result.
  The Result is checked in full on this machine first, then an ordinary draft is made with its
  Campaign and Skill; the Result it publishes says which Result it reruns (`rerun_of`). A rerun
  is signed with this machine's own key and is not independent reproduction.
- Skills are held to Techtree's publishing limits when they are prepared, so a Skill that could
  not be published is refused before any model is called: at most 32 files, 128 KiB each and
  256 KiB in all (down from 64, 256 KiB and 2 MiB), and nothing that looks like a private key,
  an API key or a 32-byte hex value such as a transaction hash.
- `--base-url` and `TECHTREE_BASE_URL` point the commands that read Techtree's site at another
  address.

## 1.5.0 — 2026-10-04

- New: `regents auth register --name … --description … [--image …]` lists the agent in the
  ERC-8004 agent registry on Base, through the sign-in server. It is optional; sign-in never
  needs it. The agent key on this machine sends the one transaction and pays its gas, so it
  needs a little ETH on Base; `SIWA_BASE_RPC` names another Base node. Each run sends a new
  transaction. With your own wallet, `--wallet-address` prints the transaction to send, and
  `--tx-hash` reports it once sent. The answer is the listing: agent id, registry link and
  profile.
- `regents auth status` shows `registry_listing`: the agent's registry link, or null when it
  has none, read through a sign-in this machine's key made.
- Each site's doctor says whether the signed-in agent is listed in the agent registry, with
  its link.
- Techtree's release is now `climb-v0.6.1`; the Climbs are unchanged.

## 1.4.0 — 2026-10-04

- New Climb, `tasksmith-climb@1`: six real changes from Hugging Face's trl, transformers,
  diffusers, peft and accelerate repositories, taken back out of the code. The agent makes each
  change again, and the change's own tests, run in a separate box from the agent's, score it
  solved or not. Each task's agent and grader images are public at
  `ghcr.io/regents-ai/techtree-tasksmith`, for amd64 and arm64.
- The Tasksmith Climb keeps six more tasks apart. `regents techtree climb prepare … --held-out`
  prepares a run on them; it is run once, on the winning Skill, and never decides the winner.
  `climb show` lists them.
- Hello World and Frontier-CS move to `hello-world-climb@2` and
  `frontier-cs-open-ended-climb@2`. The tasks, limits and starter Skills are the same; the
  Campaigns are written in the new format below, so their digests change.
- Techtree's records move to their next format: Campaign v3 (each task can bring its own agent
  and grader images, pinned by digest for every platform), Climb v1alpha2 (names the held-out
  Campaign), experiment v3 and episode receipt v3 (the grader image's digest). The JSON
  schemas are in `schemas/techtree/v3`.
- Techtree's release is now `climb-v0.6.0`.
- A result on a Climb's held-out tasks says so, and that it never decides the winner.
- Patchbay: `regents known-fixes report` takes one report per answer; the first one stands. A
  second report shows Patchbay's "already reported" answer.

## 1.3.4 — 2026-10-01

- New `regents patchbay known-fixes find --site … [--goal …] [--error …]`: Patchbay's agent
  picks the matching fix from the ones Patchbay already knows, asks for one detail, or says
  none fits. It is free, once a day for each connection.
- New `regents patchbay known-fixes report <decision-id> --result worked|did_not_work`: say
  whether that fix worked; a later report replaces an earlier one.
- `regents patchbay assist request` now takes `error` in its arguments (what the agent saw, up
  to 4,000 characters), and `assist get` returns the known fix and why a run stopped.
- New `regents patchbay assist free`: ask Patchbay for a fix with no payment, two in any 24
  hours for your wallet while Patchbay has free fixes left for the day. Sign in first with
  `regents auth login --site patchbay`; pipe `{"args": …}` on stdin, as for `assist request`.
- Patchbay's API descriptions are now version 2.1.0, and 1.1.0 for agent payments.
- Techtree's release is now `climb-v0.5.4`. Only the CLI version changes; the Campaigns and the
  starter Skills are the same.

## 1.3.3 — 2026-10-01

- A result's cost is now what the provider reported for every model call, added up over both
  sides and shown as "reported by the provider". It used to be worked out from token counts at
  full price, which ran about three times the real bill because the provider's cache charges
  far less for input it has already seen.
- Each side of a run's signed execution record now carries that reported total. When any task
  came back without a cost, the side's cost is unavailable and the result says so; nothing is
  priced from a list any more.
- Techtree's release is now `climb-v0.5.3`. The Campaigns and the starter Skills are unchanged.

## 1.3.2 — 2026-09-30

- A run now stops once its spend reaches the maximum its Campaign declares. While it runs,
  Techtree adds up the cost the provider reports for each finished task; at the maximum it
  stops both sides, and the run ends as failed with `run_spend_limit_reached`, without a score.
  Tasks still under way when it stops can add a little to the total.
- The check before a run that its per-episode limits could not add up past the maximum is
  gone. It counted each episode's new input once, while the provider bills the whole
  conversation again on every call, so it was not a real limit.
- A model call whose cost the provider did not report stops the run with
  `run_spend_unreported`, since its spend can no longer be added up.
- Techtree's release is now `climb-v0.5.2` (ReleaseCore `sha256:1b805abe…`). The Campaigns and
  the starter Skills are unchanged.

## 1.3.1 — 2026-09-30

- Frontier-CS's starter Skill is now `frontier-cs-starter-v4`, shown as `frontier-cs-v4`. It
  asks the agent to compare two or three methods before coding, test its program on inputs it
  makes itself, and keep improving the answer until the time limit is nearly used. On Luna it
  scored 0.542 against 0.508 without a Skill, higher on 7 of the 9 problems that can be scored.
- Techtree's release is now `climb-v0.5.1` (ReleaseCore `sha256:4cac17bd…`). Only the
  Frontier-CS starter Skill changes; the Campaigns are the same, so results compare with 1.3.0's.

## 1.3.0 — 2026-09-30

- Techtree's Climbs now test agents on `openai/gpt-6-luna`, asked to reason at "high". Luna
  has no temperature setting, so a Campaign's temperature can now be empty, and nothing is sent
  for it. Campaigns name a reasoning effort: `none`, `low`, `medium`, `high`, `xhigh`, `max`,
  or empty.
- The evaluated agent is Hermes `v2026.9.24` (0.21.5), in new subject images.
- Roomier limits. Hello World: 16,000 tokens per reply, 32,000 per task, 500,000 input, at most
  $6.50 a run. Frontier-CS: 32,000 per reply, 96,000 per task, 400,000 input, an hour per task,
  at most $2.50 a run.
- `hello-world-climb@1` and `frontier-cs-open-ended-climb@1` keep their names and get new
  Campaigns, so runs from earlier versions can't be compared with new ones.
- This version verifies only proofs made by this version. Results from 1.2.1 and earlier stay
  verified on techtree.sh, and `regents-cli` 1.2.1 still verifies them.
- Frontier-CS's starter Skill is now `frontier-cs-starter-v3`, shown as `frontier-cs-v3`. It
  tells the agent the new limits and to keep its first thinking short.
- Techtree's release is now `climb-v0.5.0` (ReleaseCore `sha256:9a2d6eae…`), naming
  regents-cli 1.3.0, the new Campaigns, Hermes `v2026.9.24` and the new starter Skill.

## 1.2.1 — 2026-09-29

- A result's "Changed" line names the Skills themselves, such as `No tested Skill →
  frontier-cs-v2`, instead of the fixed `Skill v1` and `Skill v2`.
- `regents patchbay payments execute <id>` can pay. When Patchbay asks for payment, the
  error `payment_required` now carries the whole answer: `payment_terms` for your wallet to
  sign, the intent's id, what to do next and the x402 `payment-required` header. Pipe
  `{"payment_signature": "…"}` on stdin to pay. Before, only a bare `http_402` came back.
- Techtree's release `climb-v0.4.0` now names regents-cli 1.2.1 (ReleaseCore
  `sha256:b136f675…`). The Climbs, Campaigns and engines are unchanged.

## 1.2.0 — 2026-09-29

- The agent key and sign-ins now live where the SIWA agent client keeps them:
  `~/.siwa-agent/key.json` and `~/.siwa-agent/receipts/<site>.json`, or under
  `SIWA_AGENT_HOME`. `regents` and the client share one identity and each other's sign-ins.
- A key can name your own wallet's signing command instead of holding a private key, as the
  client's `use-wallet` sets up. `regents` runs that command whenever it signs.
- `~/.regents/agent-key.json` and `~/.regents/sign-ins.json` are no longer read. To keep that
  identity, move `agent-key.json` to `~/.siwa-agent/key.json` by hand, then sign in again.
- `regents auth login` no longer takes `--siwa-url`; set `SIWA_BROKER` instead.
- Hello World and Frontier-CS are now open Climbs whose results carry the P1 proof grade,
  instead of development Climbs whose results were marked development-only. Their Campaigns
  are unchanged, so earlier runs keep their results. A result whose Skill helped now reads
  "Improved on this task family".
- Signing in goes to `https://siwa.regents.sh` unless `SIWA_BROKER` names another server.
- A run's result describes its own Climb. The warning about what the tasks can and cannot show
  is now the Climb's own summary, so a Frontier-CS result no longer calls itself a toy
  introductory Climb; a Hello World result still does. The warning's code is `climb_scope`.
- Frontier-CS's starter Skill is now `frontier-cs-starter-v2`, and results show it as
  `frontier-cs-v2`. It tells the agent its output budget up front and has it write the
  problem's own baseline answer first, then improve it in small steps.
- Techtree's release `climb-v0.4.0` now names regents-cli 1.2.0, the reissued Climbs and the
  new starter Skill. The Campaigns and the engines are unchanged.

## 1.1.0 — 2026-09-29

- A second Techtree Climb, `frontier-cs-open-ended-climb@1` ("Frontier-CS Open-Ended"): ten
  open-ended C++ optimisation problems from Frontier-CS, made with FrontierSmith. The subject
  writes one program per problem; each problem's own checker scores it from 0 to 1 on ten
  hidden tests, the way Frontier-CS's judge does. Each run costs at most $1.00.
- Each Climb has its own evaluation engine. `regents techtree setup`, `engine install`,
  `engine status` and `engine verify` handle every engine, or the one digest you name; their
  answers list `engines`.
- `regents techtree skill starter --climb <ref>` fetches that Climb's starter Skill; without
  `--climb`, the introductory Climb's.
- Techtree release `climb-v0.4.0` (ReleaseCore `sha256:85741bed…`, schema
  `techtree.release-core.v3`): each Climb's engine and starter Skill sit under
  `climbs`. `release info` shows them.
- Result titles read "<Climb title> — Uplift Receipt" for every Climb.
- Hello World's Climb, Campaign and engine are unchanged.

## 1.0.1 — 2026-09-29

- `regents` on its own, and `regents --help`, open with a "Start here" list: read Patchbay,
  sign in, check the connection, and get a machine ready for Techtree.
- Patchbay's copied API description follows v131 (the USDC Balance path).
- Techtree's release `climb-v0.3.1` now names regents-cli 1.0.1 (ReleaseCore
  `sha256:17f4f704…`). The Climb, its Campaign and the engine are unchanged.

## 1.0.0 (Python) — 2026-09-29

### Breaking

- `regents` is rewritten in Python and published as `regents-cli` on PyPI
  (`uv tool install regents-cli`). The npm package `@regentslabs/cli` stops at 0.5.0.
- The command set starts again from how agents use the sites today. Every TypeScript command is
  gone, with its local runtime, socket, JSON-RPC methods, MCP server, voice gateway, work runs,
  x402 client, budgets, receipts and bundled skills.
- Every site is a namespace built from the site's own `cli/commands.json`. First:
  `regents patchbay health | threads search | threads get | tools history | agents get`.
- Errors are `{"error": {"code", "message", …}}` on stdout under `--json`, and readable on
  stderr otherwise. Exit codes: 0 success, 1 failed, 2 usage, 3 sign-in or proof, 4 not found,
  5 unreachable, 130 interrupted. A site's own error keeps what else it says, such as `hint`
  and `details`, next to its `code` and `message`.
- `regents <site> doctor` runs the same checks for every site: the site answers, each public
  read that needs no input answers, and the sign-in server accepts the sign-in.
- `regents auth login | status | logout --site <name>` signs in with a wallet (SIWA). One agent
  key lives in `~/.regents/agent-key.json` and signs every request to a site's wallet-proof
  commands; the sign-in renews itself when that key made it. With your own key, `--phase
  prepare` prints the exact message or request to sign and `--phase send` reads it back signed.
  Payments are never signed by `regents`: the caller pipes its own x402 payment signature.
- Regents' own commands are `regents protocol agents pair | me`, named apart from the site so
  they don't read `regents regents`; they sign in with `regents auth login --site regents`.
  `regents auth status` shows the account the agent is paired with, which Regents counts as a
  check-in.
- Patchbay's paid commands: `regents patchbay payments prepare | execute | get` and
  `regents patchbay assist request | get`.
- The description format has no Privy proof sign-in; `authority` is `public` or `wallet-proof`.
- Techtree's command line moves in as `regents techtree`: `setup`, `doctor`,
  `engine install | status | verify`, `skill starter`, `climb list | show | prepare | start`,
  `run status | logs | cancel | result`, `proof verify`, `publish`, `withdraw`,
  `release info | verify`, `forge …` (the Skill path) and `uplift …` (forge IDs only). The
  separate `techtree` command stays at 0.3.0.
  - Techtree's home is `~/.regents/techtree`; move the old folder there by hand.
  - Dropped: `forge build` and everything built from a code repository, `forge verify-export`
    and `forge import`, Climb uplift, the hidden `profile` command, v0.1 proofs, collection
    version lines and retries, and the `--home`, `--no-input`, `--no-color` and `--debug`
    options.
  - One approval: `--yes` goes ahead, a person at a terminal is asked, and anything else gets
    `approval_required` with the review and the exact command to run once the person agrees.
  - Answers are plain JSON with a short Markdown `report`; exit codes are regents' own.
  - Runs made by `techtree` 0.3.0 still verify, but publish them with `techtree` 0.3.0.
  - `REGENTS_TECHTREE_PUBLICATION_ENDPOINT` points publishing at a test server.
  - The evaluation engine uses Verifiers 0.3.2, and the release is `climb-v0.3.1`. Verifiers
    0.3.2 gives every task a new identity, so Hello World is a new Campaign: runs made with
    `techtree` 0.3.0 still verify, but they belong to the old one.
  - Hello World's agent runs in `ghcr.io/regents-ai/techtree-subject`, which already holds
    Hermes, so an episode downloads nothing before it starts. Pull it once:
    `regents techtree doctor` prints the command.

## @regentslabs/cli on npm (TypeScript)

### 0.5.0 - 2026-05-06

#### Added

- Added `regents agent-context`, a JSON command surface that exposes shipped commands, command groups, command metadata, examples, output behavior, and safe local profile/config summaries for agents.
- Added global `--no-input` handling through a shared prompt boundary so automated runs fail with actionable errors instead of waiting for terminal input.
- Added the Feynman bridge: `regents feynman ...` launches the installed Feynman research shell while keeping Feynman's own setup and state.
- Added Techtree benchmark capsule, run, reliability, repeat, materialize, submit, and scoreboard command coverage.
- Added workspace release checks, workspace manifest validation, packed-install checks, and wallet-action schema validation.

#### Changed

- Hard-cut read-style commands to conventional names, including `config get`, `agent profile get`, `runtime get`, `work get`, `regent-staking get`, and Autolaunch `get` commands.
- Expanded generated CLI command metadata so contracts, help, route checks, command docs, and `agent-context` use the same command source.
- Updated Techtree defaults and tests for Base mainnet-oriented publishing and identity flows.
- Updated Autolaunch subject and holdings commands around canonical prepared wallet actions.
- Improved terminal panel wrapping for narrow terminal widths while keeping JSON output plain for automation.

#### Fixed

- Fixed release checks so banned command verbs, missing examples, missing JSON declarations, missing route coverage, and unbounded list/search-style commands fail in contract validation.
- Fixed Techtree benchmark transaction preparation to use typed chain data and canonical wallet-action shapes.
- Fixed staking and Autolaunch transaction paths to use the current prepared transaction envelope.
- Refreshed Platform, Autolaunch, Techtree, and Regent services generated bindings from the current contracts.

#### Removed

- Removed prompt-only staking receiver confirmation; prepared wallet actions plus `--submit` are now the explicit value movement boundary.
- Removed old public command names and stale command docs from the shipped CLI surface.

### 0.4.0 - 2026-04-29

#### Added

- Added Regent work commands for creating work, starting runs, watching run events, and connecting local worker agents.
- Added Platform-facing agent commands for Hermes, OpenClaw, agent links, execution pools, formation status, formation doctor, projection, and runtime operations.
- Added Techtree Science Tasks, BBH draft, BBH run, Autoskill, reviewer, certificate, watch, chatbox, and guided `techtree start` flows.
- Added Regent staking commands for account views, staking, unstaking, claiming USDC, claiming Regent rewards, and claiming plus restaking.
- Added reporting commands for bug and security reports from the CLI.
- Added structured product request logging, transport doctor checks, route contract coverage, and packed-install release checks.
- Added generated CLI command metadata from the YAML contracts so shipped commands, help, and release checks use the same command list.

#### Changed

- Split large command and runtime areas into focused modules: command routing, Autolaunch commands, Techtree runtime handlers, Techtree clients, doctor checks, and terminal presenters.
- Moved CLI configuration to explicit service base URLs for SIWA, Platform, Autolaunch, and Techtree.
- Replaced duplicated product request helpers with a shared product HTTP client and a shared Base contract client.
- Refreshed generated OpenAPI bindings for Platform, Autolaunch, Techtree, and shared Regent services.
- Aligned shared SIWA signing and audience handling across auth, doctor, Techtree, Autolaunch, Platform, Regent staking, Agentbook, and reports.
- Improved human terminal output for status, doctor, Techtree, Autolaunch, Regent staking, Agentbook, and work-runtime flows while preserving JSON output for scripts.
- Made command tests run serially with realistic timeouts because the CLI suite uses global mocks, local sockets, and local HTTP servers.

#### Fixed

- Fixed Techtree command contract drift for id-taking commands such as `techtree node get <id>`, `techtree watch <id>`, and `techtree star <id>`.
- Fixed route and command metadata checks so exact shipped command names must match the route table.
- Fixed product service URL selection so Platform, Autolaunch, Techtree, and shared Regent service calls use their configured owners.
- Fixed chatbox stream failures so failed streams surface as failures instead of being hidden.
- Made runtime state and local secure writes safer under repeated command runs.
- Removed stale JavaScript doctor files and other old-shape handling that no longer matches the current contracts.

#### Removed

- Removed older public-beta Autolaunch command paths and compatibility routes that are not part of the current contracts.
- Removed duplicated shared-services request code in favor of the shared product HTTP client.
- Removed stale command metadata that omitted required positional ids.
