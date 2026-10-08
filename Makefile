.PHONY: check release-check sync

# Every gate, run here before each commit and by the publish workflow before it builds.
check:
	uv run ruff format --check
	uv run ruff check
	uv run mypy
	uv run scripts/sync_platforms.py --copies
	uv run python -m regents_cli.check_commands
	uv run scripts/check_signing.py
	uv run pytest -q
	uv run scripts/check_wheel.py

# Before each release, on the founder's machine: every gate, and the lock's sha256 for each
# platform copy matches its pinned commit in the site's checkout beside this one. Some sites'
# repositories are private, so the publish workflow checks the copies against the lock only.
release-check: check
	uv run scripts/sync_platforms.py --check

# Copy the files platforms.lock.json pins into src/regents_cli/platforms/, from the sites'
# checkouts beside this one, and record each copy's sha256 in the lock.
sync:
	uv run scripts/sync_platforms.py
