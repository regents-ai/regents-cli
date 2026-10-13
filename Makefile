.PHONY: check release-check sync model-climb-image

# Every gate, run here before each commit and by the publish workflow before it builds.
check:
	uv run ruff format --check
	uv run ruff check
	uv run mypy
	uv run scripts/sync_platforms.py --copies
	uv run python -m regents_cli.check_commands
	uv run pytest -q
	uv run scripts/check_wheel.py
	uv run scripts/techtree/export_model_climb_schema.py --check

# Before each release, on the founder's machine: every gate, and the lock's sha256 for each
# platform copy matches its pinned commit in the site's checkout beside this one. Some sites'
# repositories are private, so the publish workflow checks the copies against the lock only.
release-check: check
	uv run scripts/sync_platforms.py --check

# Copy the files platforms.lock.json pins into src/regents_cli/platforms/, from the sites'
# checkouts beside this one, and record each copy's sha256 in the lock.
sync:
	uv run scripts/sync_platforms.py

# Build Model Climb's M0 check image on this machine. It is never pushed: publishing it needs the
# founder's go.
model-climb-image:
	docker build -t regents-model-climb:m0-qwen3.5-9b src/regents_cli/techtree/resources/model-climb-image
