.PHONY: check release-check sync

# The seed for the tests that try many made-up inputs; a failed run replays with
# `make check SEED=<the seed it printed>`.
ifndef SEED
SEED := $(shell od -An -N4 -tu4 /dev/urandom | tr -d ' ')
endif

# Every gate, run here before each commit and by the publish workflow before it builds.
check:
	uv run ruff format --check
	uv run ruff check
	uv run mypy
	uv run scripts/sync_platforms.py --copies
	uv run python -m regents_cli.check_commands
	uv run scripts/features.py --check
	@echo "Made-up inputs from seed $(SEED)"
	uv run pytest -q --hypothesis-seed=$(SEED)
	uv run scripts/check_wheel.py

# Before each release, on the founder's machine: every gate, and the lock's sha256 for each
# platform copy matches its pinned commit in the site's checkout beside this one. Some sites'
# repositories are private, so the publish workflow checks the copies against the lock only.
# Every protected feature the change since the last release touches must have a property and an
# end-to-end proof (verification/features.yml). Then the wheel, installed into a new environment,
# runs every public read against the live sites and each answer must have its pinned shape;
# nothing signed runs. Last, the WebMCP report
# lists each site's tools and commands that have no partner; it never fails.
release-check: check
	uv run scripts/sync_platforms.py --check
	uv run scripts/features.py --release
	uv run scripts/check_live.py
	uv run scripts/webmcp_parity.py

# Copy the files platforms.lock.json pins into src/regents_cli/platforms/, from the sites'
# checkouts beside this one, record each copy's sha256 in the lock, and write the feature map
# verification/features.yml from the new copies.
sync:
	uv run scripts/sync_platforms.py
	uv run scripts/features.py --write
