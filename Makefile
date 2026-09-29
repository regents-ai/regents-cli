.PHONY: check sync

# Every gate, run here before each commit and by the publish workflow before it builds.
check:
	uv run ruff format --check
	uv run ruff check
	uv run mypy
	uv run scripts/sync_platforms.py --check
	uv run python -m regents_cli.check_commands
	uv run scripts/check_signing.py
	uv run pytest -q
	uv run scripts/check_wheel.py

# Copy the files platforms.lock.json pins into src/regents_cli/platforms/.
sync:
	uv run scripts/sync_platforms.py
