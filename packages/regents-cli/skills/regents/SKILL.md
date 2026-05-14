---
name: regents
description: Use Regents CLI safely for setup, sign-in, command discovery, and routing to Regent product skills.
---

# Regents

Use this skill when a person asks for help with Regent, Regents CLI, Agent accounts, local setup, command discovery, or which Regent product command to run.

## Safety

Do not read or print secrets, wallet keys, session files, private chat logs, private company files, or local memory unless the person explicitly asks for a specific file or value.

Do not move money, stake tokens, submit transactions, create paid work, or publish research unless the person explicitly asks for that action. Prefer prepare and preview commands before submit commands.

## First Commands

- Check local setup: `regents status`
- Show active account: `regents whoami`
- Show machine-readable command context: `regents agent-context`
- Install these skills again: `regents setup skills`
- Install Regent tools for Hermes: `regents plugin install --runtime hermes`
- Install Regent tools for OpenClaw: `regents plugin install --runtime openclaw`
- Install both runtime tool sets: `regents plugin install --runtime auto`

If the wrong runtime is installed, run the matching command for the agent app. The wrong install is not dangerous; it just means that the intended app will not see Regent until its own runtime is installed.

## Product Routing

- Platform company work: use `regents-platform`
- Autolaunch agent launches: use `regents-autolaunch`
- Techtree research publishing: use `regents-techtree`

## Sign-In

Use the product audience that matches the task:

- Platform: `regents auth login --audience platform`
- Autolaunch: `regents auth login --audience autolaunch`
- Techtree: `regents auth login --audience techtree`
- Regent services: `regents auth login --audience regent-services`

After sign-in, run:

```bash
regents identity ensure
```

## Automation

For scripts and agents, prefer:

```bash
regents <command> --json --no-input
```

If a command fails, read the error fields and retry with the missing flags named in the error.
