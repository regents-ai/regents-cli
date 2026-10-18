.PHONY: check release-check sync

# Every gate, run here before each commit and by the publish workflow before it builds.
check:
	uv run ruff format --check
	uv run ruff check
	uv run mypy
	uv run scripts/sync_platforms.py --copies
	uv run python -m regents_cli.check_commands
	uv run scripts/webmcp_parity.py --check
	uv run pytest -q
	uv run scripts/check_wheel.py

# Before each release, on the founder's machine: every gate, and the lock's sha256 for each
# platform copy matches its pinned commit in the site's checkout beside this one. Some sites'
# repositories are private, so the publish workflow checks the copies against the lock only.
# Then the wheel, installed into a new environment, runs every public read against the live
# sites and each answer must have its pinned shape; nothing signed runs. Last, the WebMCP report
# lists each site's tools and commands that have no partner; it never fails.
release-check: check
	uv run scripts/sync_platforms.py --check
	uv run scripts/check_live.py
	uv run scripts/webmcp_parity.py

# Copy the files platforms.lock.json pins into src/regents_cli/platforms/, from the sites'
# checkouts beside this one, record each copy's sha256 in the lock, and write the feature map
# docs/feature-map.md from the new copies.
sync:
	uv run scripts/sync_platforms.py
	uv run scripts/webmcp_parity.py --write
