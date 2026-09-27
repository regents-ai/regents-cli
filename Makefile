.PHONY: check

# Every gate, in the order CI runs them.
check:
	pnpm check:platforms
	pnpm check:openapi
	pnpm check:cli-contract
	pnpm build
	pnpm typecheck
	pnpm test
	pnpm check:pack-cli-contents
	pnpm test:pack-smoke
