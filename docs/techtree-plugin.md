# What the Techtree plugin calls

The Hermes plugin (Techtree 0f922af, 13 tools) runs `techtree … --json --no-input`. Pointed at
`regents`, each call becomes `regents techtree … --json`. This lists the calls it makes and the
answers they give on regents-cli 1.1.0, checked on 2026-09-29.

## How every answer reads

- **Success:** exit 0, and stdout is one JSON object: what 0.3.0 put in `facts`, at the top
  level. There is no envelope: no `ok`, `facts`, `next_actions`, `operation` or
  `schema_version`. Report-style answers carry `report` (compact Markdown), and `warnings`
  (a list of `{id, text}`) when there are any.
- **Failure:** stdout is `{"error": {"code", "message", "details"?}}`. `error.code` is 0.3.0's
  code. Exit codes are regents' own: 1 failed, 2 usage, 3 sign-in or proof, 4 not found,
  5 unreachable, 130 interrupted.
- **Approval:** a step that spends, sends, publishes or signs answers, without `--yes`, with
  exit 1 and `error.code` `approval_required`, `error.review` (lines to show the person) and
  `error.approval.command` (shell text; `shlex.split` gives the arguments, ending in
  `--yes --reviewed-on host-agent`). Nothing waits for input: there is no `--no-input`.
- **Publishing offer:** `run result` and `proof verify` carry `publication_offer`
  `{command, reason, retry: "reconcile_first"}` when a verified run can be published. It
  replaces the `next_actions` entry the plugin looks for today.

## The calls

| Tool use | Command | Answer fields |
|---|---|---|
| release check | `release info` | `release_id`, `release_core_digest`, `cli_version`, `package_version`, `protocol_version`, `catalog_digest`, `climbs` (by Climb reference: `engine_digest`, `starter_skill_digest`, `starter_skill_object_url`), `intro_climb_reference`, `source_commit` |
| doctor | `doctor` | `checks` (each `id`, `label`, `status`, `blocking`, `detail`, `metadata`), `blocking_failures`, `warnings`, `versions`, `host_platform`, `docker_platform`, `techtree_home` |
| catalog | `climb list` | `climbs`, `count` |
| catalog, demo | `climb show <ref>` | `climb`, `subject_model`, `subject_runtime`, `rubric`, `data_policy_digest`, `candidate_skill_ownership` |
| demo | `skill starter [--climb <ref>]` | `climb_reference`, `skill_path`, `skill_name`, `skill_root_digest`, `candidate_label`, `release_id`, `prepare_command`. Without `--climb`, the introductory Climb |
| demo | `climb prepare <ref> --skill <path> [--label <label>] [--access chatgpt-plan\|prime-key]` | `draft_id`, `draft_dir`, `draft_digest`, `data_policy_digest`, `campaign_spec_digest`, `skill_root_digest`, `estimated_episodes`, `access` (`chatgpt_plan` or `prime_key`, the route the run uses), `campaign_maximum_usd` (null on a Climb that offers only the ChatGPT plan), `start_command`, and the policy fields. `--access` is needed when the Climb offers more than one route; without it the answer is `model_access_required`, listing the routes and which are set up |
| rerun | `climb prepare --rerun-of <bundle digest> [--base-url <url>]` | the same fields as `climb prepare`, plus `rerun_of`. The Climb, held-out choice and Skill come from the published Result, which is checked offline first |
| fetch | `skill fetch <skill root digest> [--to <dir>] [--base-url <url>]` | `skill_root_digest`, `skill_name`, `folder`, `files`, `total_bytes`, `results` (the Results that carry it) |
| demo | `climb start <draft id>` | without `--yes`: `approval_required`. With `--yes --reviewed-on host-agent`: the started run, with its `access` |
| model | `model login`, `model status`, `model logout` | `login`: `email`, `access` (`chatgpt_plan`), `usage_settings`. `status`: `email`, `models` (each `slug`, `display_name`), `usage_settings`; with no sign-in it refuses with `model_sign_in_required`. `logout`: `removed`, `email`, `revocation_confirmed`. Every call goes to OpenAI; nothing goes to the Techtree site |
| run | `run status <run id>` | `phase`, `public_state`, `terminal`, `result_available`, `worker_alive`, `heartbeat_stale`, `progress`, `state_digest`, `error` |
| run | `run cancel <run id>` | 0.3.0's `--confirm` is gone: it goes through the approval. Answer: `outcome`, `phase`, `worker_alive`, `state_digest` |
| run | `run result <run id>` | `uplift_report`, `presentation`, `execution_record`, `state_digest`, `publication_offer` |
| proof | `proof verify <run id or bundle path>` | `verified`, `kind`, `target`, `summary`, `checks` |
| publish | `publish <run id>` | without `--yes`: `approval_required`. Sent: `bundle_digest`, `entry_url`, `log_sequence`, `accepted_at`, `receipt_path`, `contributor_address_sent`, `retry` |

Where the plugin reads 0.3.0's `phase`, `terminal`, `result_available` and `worker_alive`, the
names are unchanged. The plugin's own doctor answer can keep `can_prepare_demo` as "no blocking
failures"; `regents techtree doctor` doesn't compute it.

The ReleaseCore is `techtree.release-core.v3`. Each Climb it ships has its own engine and
starter Skill, under `climbs` by Climb reference (`engine_digest`, `starter_skill_digest`,
`starter_skill_object_url`); the top-level `engine_digest`, `starter_skill_digest` and
`starter_skill_object_url` are gone. `intro_climb_reference` is one of the keys of `climbs`.
`subject_hermes_version` is the Hermes release tag (`v2026.9.24`, Hermes 0.21.5) every Campaign
pins.

## Hosted publication authentication in CLI 1.9.0

Publication and withdrawal require SIWA audience `techtree` and current account pairing.
The CLI signs the original JSON bytes with its configured agent signer after normal approval;
it preserves the independent participant proof and the pinned network receipt checks.
Offline commands do not sign in. Each approved retry makes fresh SIWA proof for its body.

Both actions POST to `https://techtree.sh/api/v1/publications`, with a 2,097,152-byte body
limit and no redirects. Other endpoint overrides are refused before authentication.
The optional contributor address is private: review/approval output redacts it, using
`<private-address>` as an explicit placeholder. Replace it privately before running that
approval command. Skill name and GitHub URL remain public metadata.
