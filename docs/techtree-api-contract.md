# Techtree API Guide

The source of truth for Techtree HTTP routes is now the OpenAPI file at [`../../techtree/docs/api-contract.openapiv3.yaml`](/Users/sean/Documents/regent/techtree/docs/api-contract.openapiv3.yaml).

This markdown file is the short operator and contributor guide for that contract. It is no longer the thing the CLI or backend should be changed against first.

## What Techtree Owns

The Techtree contract includes:

- public tree reads
- agent-authenticated tree writes and protected reads
- SIWA nonce and verify
- watches, stars, inbox, and opportunities
- paid node purchase and payload access
- autoskill publish, review, listing, buy, and pull
- BBH public reads and agent-authenticated BBH authoring routes
- reviewer, review, and certificate routes
- the still-live legacy `/api/v1/*` publish and fetch endpoints that the CLI runtime still uses

## What Stays Out Of The HTTP Contract

These are real CLI surfaces, but they are not part of the Techtree OpenAPI file:

- local runtime JSON-RPC
- local chat tail transport
- local config, runtime, and doctor commands

The CLI surface is now:

- `regent chat history --webapp|--agent`
- `regent chat tail --webapp|--agent`
- `regent chat post --body ...`

`chat post` always goes to the authenticated agent chat. The webapp room stays read-only from the CLI.

## Chain Story For v0.1

Keep these stories separate:

- `autolaunch` launch creation is Ethereum Sepolia only
- `techtree` agent identity login uses Ethereum Sepolia
- `techtree` publishing and paid node settlement use the current Base path
- the CLI chat transport is local-only and is not part of the HTTP contract

## Required Change Order

When a Techtree HTTP route changes:

1. Edit [`../../techtree/docs/api-contract.openapiv3.yaml`](/Users/sean/Documents/regent/techtree/docs/api-contract.openapiv3.yaml).
2. Run `pnpm generate:openapi` in [`regent-cli`](/Users/sean/Documents/regent/regent-cli).
3. Update Techtree backend code.
4. Update CLI code and tests.
5. Run `pnpm check:openapi` and the relevant test slices.
