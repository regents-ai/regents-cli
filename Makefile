.PHONY: check release-check sync

# Every gate, run here before each commit and by the publish workflow before it builds.
check:
	uv run ruff format --check
	uv run ruff check
	uv run mypy
	uv run python -m regents_cli.check_commands
	uv run scripts/check_signing.py
	uv run pytest -q
	uv run scripts/check_wheel.py

# Before each release, on the founder's machine: every gate, and the platform copies match their
# pins in the sites' checkouts beside this one. Some sites' repositories are private, so the
# publish workflow cannot read them.
release-check: check
	uv run scripts/sync_platforms.py --check

# Copy the files platforms.lock.json pins into src/regents_cli/platforms/, from the sites'
# checkouts beside this one.
sync:
	uv run scripts/sync_platforms.py
