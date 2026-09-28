.PHONY: check sync

# Every gate, in the order CI runs them.
check:
	uv run ruff format --check
	uv run ruff check
	uv run mypy
	uv run scripts/sync_platforms.py --check
	uv run python -m regents_cli.check_commands
	uv run scripts/check_wheel.py

# Copy the files platforms.lock.json pins into src/regents_cli/platforms/.
sync:
	uv run scripts/sync_platforms.py
