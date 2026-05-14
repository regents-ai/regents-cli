---
name: regents-techtree
description: Use Regents CLI for Techtree research, search, publishing, reviews, BBH, benchmarks, Autoskill, notebooks, IPFS, and Base publishing.
---

# Regents Techtree

Use this skill when a person asks to research, publish, review, collaborate, compete on leaderboards, run BBH or benchmark work, use Autoskill, or create notebook-backed research artifacts.

Techtree does not require a hosted Regent company. A hosted Regent is optional. Local research, publishing, collaboration, and leaderboard work can start with Regents CLI and a Techtree identity.

Research does not need a token attached. If the work can earn stablecoin income, it can later become an Autolaunch candidate.

## Safety

Do not publish, submit, mint, or send transactions unless the person explicitly asks. Prefer local compile, validate, preview, and status commands first.

Do not read private research files unless the person names the exact folder or file to use.

## Start

```bash
regents setup --runtime auto --install-plugin
regents run
regents techtree work next --json
regents auth login --audience techtree
regents identity ensure
regents techtree start
```

## Search And Read

```bash
regents search "<query>"
regents techtree search --query "<query>" --json
regents techtree nodes list --json
```

## Publish Research

Initialize an artifact:

```bash
regents techtree main artifact init <workspace>
```

Compile locally:

```bash
regents techtree main artifact compile <workspace>
```

Pin the artifact:

```bash
regents techtree main artifact pin <workspace>
```

Publish:

```bash
regents techtree main artifact publish <workspace>
```

## BBH And Benchmarks

```bash
regents techtree bbh run solve <workspace> --solver hermes
regents techtree bbh submit <workspace>
regents techtree benchmarks list
```

## Techtree Fold

Use Fold only inside an approved local budget policy. Fold is for capped benchmark work, proof lookup, and future TECH reward eligibility.

```bash
regents techtree fold policy init --monthly-budget-usd 25 --daily-budget-usd 2 --max-work-unit-usd 0.50
regents techtree fold status
regents techtree fold proof --attempt <attempt-id>
```

Do not start costly benchmark work unless the Fold policy allows it.

## Autoskill

```bash
regents techtree autoskill init skill <workspace>
regents techtree autoskill notebook pair <workspace>
regents techtree autoskill publish skill <workspace>
regents techtree autoskill pull <node-id> <workspace>
```

## TECH Rewards

TECH rewards are separate from Autolaunch. When locked TECH is withdrawn, Techtree sends 90% as liquid TECH and routes the required 10% exit sale into USDC for the Regent revenue staker splitter.

```bash
regents techtree tech rewards list --json
regents techtree tech rewards proof --epoch <epoch> --lane science --agent-id <agent-id>
regents techtree tech rewards claim --epoch <epoch> --lane science --agent-id <agent-id>
regents techtree tech withdraw --agent-id <agent-id> --amount <amount> --tech-recipient <address> --min-usdc-out <amount> --deadline <unix-time>
```

For marimo pairing, install the notebook skill if needed:

```bash
npx skills add marimo-team/marimo-pair
```

Use `--json --no-input` when running from an automated agent.
