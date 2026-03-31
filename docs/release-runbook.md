# Regent CLI Release Runbook

This is the package release runbook for `@regentlabs/cli`.

It is not a service deployment guide. The CLI is a published npm package, so the operator job here is to prove the package is shippable, publish it cleanly, and make sure the shipped tarball works on a clean machine.

## What this runbook covers

This runbook covers four things:

1. What must pass before a release is allowed
2. How to do a local release run safely
3. What CI should do on every push
4. What CI/CD should do when it is time to publish

If you remember only one thing, remember this:

- `regent-cli` is released like a package
- `techtree` and `autolaunch` are operated like systems

## Current release gate

Today, the checked-in local release gate is:

```bash
pnpm check:openapi
pnpm build
pnpm typecheck
pnpm test
pnpm test:pack-smoke
```

Those commands are the current definition of "safe to release" for this repo.

They prove:

- the generated OpenAPI-backed types are in sync
- the package builds
- the TypeScript surface still checks
- the unit and integration tests pass
- the packed npm tarball can be installed and run through the clean-machine smoke path

The packed-install smoke is especially important. A CLI release is not ready unless the tarball that would actually be published can install and complete the expected smoke flow.

## What exists already

The repo already has a local release helper:

- [`scripts/release-cli.sh`](/Users/sean/Documents/regent/regent-cli/scripts/release-cli.sh)

That script:

1. runs the release gate
2. bumps the package version
3. stages the release scope
4. creates a release commit message
5. commits
6. optionally pushes

This is useful for a controlled local release.

What it does not yet provide by itself is a full hosted CI/CD pipeline for:

- git push
- required checks
- publish approval
- npm publish

## Before any release

Before treating a release candidate as publishable, confirm these conditions:

1. The Techtree backend contract changes, if any, are already merged and stable.
2. The Autolaunch backend contract changes, if any, are already merged and stable.
3. `pnpm check:openapi` passes with no generated-file drift.
4. `pnpm test:pack-smoke` passes from the package tarball, not just the workspace build.
5. The release notes are clear about operator-facing changes.

If the CLI contract changed, do not publish until the owning backend contract and generated CLI types agree.

## Local release path

This is the current human-operated path.

### 1. Update and validate the branch

```bash
git switch main
git pull --ff-only origin main
pnpm install
pnpm check:openapi
pnpm build
pnpm typecheck
pnpm test
pnpm test:pack-smoke
```

Stop immediately if any of those fail.

### 2. Dry-run the release helper first

```bash
bash scripts/release-cli.sh --dry-run
```

Use this to confirm:

- the version bump is what you expect
- the staged scope is correct
- the generated release commit message is sane

### 3. Run the local release helper

If the dry run looks correct:

```bash
bash scripts/release-cli.sh --no-push
```

This creates the release commit locally without pushing.

Only push after you have reviewed the resulting version bump and staged files.

## What CI should do on every push

For a published npm package, the minimum useful push pipeline is simple:

1. install dependencies
2. run `pnpm check:openapi`
3. run `pnpm build`
4. run `pnpm typecheck`
5. run `pnpm test`
6. run `pnpm test:pack-smoke`

This should run on every push and every pull request.

If any of those fail, the branch should not be considered releasable.

## What publish CI/CD should do

For package publishing, the practical desired flow is:

1. push to `main`
2. CI runs the full release gate
3. a publish job is unlocked only if the gate passes
4. the publish job packs and publishes `@regentlabs/cli`
5. the release job creates a git tag and release notes

The publish job should also prove that it is publishing the same package shape that passed `test:pack-smoke`.

In plain English:

- test the exact thing you plan to ship
- only publish if that exact thing passed

## Recommended GitHub Actions shape

This repo does not appear to have checked-in GitHub Actions yet.

The clean setup would be two workflows:

### 1. Required checks workflow

Trigger:

- pull requests
- pushes to `main`

Steps:

1. install pnpm dependencies
2. run `pnpm check:openapi`
3. run `pnpm build`
4. run `pnpm typecheck`
5. run `pnpm test`
6. run `pnpm test:pack-smoke`

This is the branch protection workflow.

### 2. Publish workflow

Trigger:

- manual approval
- or a version tag / release branch event, depending on your preferred release model

Steps:

1. rerun the same release gate
2. pack the CLI
3. publish to npm using the npm token
4. create a git tag
5. create release notes

The important rule is that publish should not be a different path from validation.

## Release artifacts that matter

For this repo, the important artifacts are:

- the npm package version in `packages/regent-cli/package.json`
- the packed tarball
- the generated OpenAPI-backed code
- the release notes or changelog entry

Those are the things an operator or downstream user actually feels.

## What this runbook does not cover

This runbook does not replace:

- [`docs/manual-acceptance.md`](/Users/sean/Documents/regent/regent-cli/docs/manual-acceptance.md) for operator usage checks
- [`docs/autolaunch-cli.md`](/Users/sean/Documents/regent/regent-cli/docs/autolaunch-cli.md) for the Autolaunch command lifecycle
- [`docs/regent-doctor-spec.md`](/Users/sean/Documents/regent/regent-cli/docs/regent-doctor-spec.md) for doctor behavior

Those docs explain how the CLI behaves.

This runbook explains how the package itself should be released.

## Bottom line

`regent-cli` is already set up for a disciplined local release flow.

What is still missing is the hosted version of that same flow:

- push-triggered required checks
- a gated publish job
- npm publication
- tag and release-note creation

That is the right next step for this repo because it is a package, not a long-running deployed service.
