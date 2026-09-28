"""What an agent left in a forge run's working directory is recorded before grading.

The costly failure: hidden material leaks out of a run's working directory. A link the agent
left there pointing outside it would carry whatever it points at into the kept outputs, so it is
recorded as a failure and never followed; an output too large to keep is a failure too, and is
not copied.
"""

from __future__ import annotations

from pathlib import Path

from regents_cli.techtree.forge.capture import (
    MANIFEST_FILENAME,
    OUTPUT_LIMITS,
    capture_outputs,
    take_snapshot,
)
from regents_cli.techtree.forge.models import ForgeOutputLimits, ForgeOutputManifest


def test_a_link_out_of_the_directory_and_an_oversized_output_are_failures(tmp_path: Path) -> None:
    root = tmp_path / "app"
    root.mkdir()
    (root / "ledger.json").write_text('{"total": 3}\n', encoding="utf-8")
    before = take_snapshot(root, OUTPUT_LIMITS)
    (root / "result.txt").write_text("5\n", encoding="utf-8")
    (root / "large.bin").write_bytes(b"x" * 100)
    (root / "passwd").symlink_to("/etc/passwd")
    (root / "up").symlink_to("../secret")
    (root / "same").symlink_to("result.txt")
    (root / "sub").mkdir()
    (root / "sub" / "back").symlink_to("../ledger.json")
    destination = tmp_path / "outputs"

    outputs = capture_outputs(
        root,
        before,
        work_dir="/app",
        artifacts=["/app/result.txt"],
        limits=ForgeOutputLimits(entries=100, checked_bytes=1_000_000, kept_bytes=64),
        destination=destination,
    )

    assert {(failure.kind, failure.path) for failure in outputs.failures} == {
        ("escaping_link", "passwd"),
        ("escaping_link", "up"),
        ("output_too_large", "large.bin"),
    }
    written = ForgeOutputManifest.model_validate_json(
        (destination / MANIFEST_FILENAME).read_bytes()
    )
    assert written.failures == outputs.failures
    changes = {change.path: change for change in written.changes}
    assert changes["large.bin"].change == "added" and not changes["large.bin"].kept
    assert changes["passwd"].after is not None
    assert changes["passwd"].after.target == "/etc/passwd"
    assert not (destination / "files" / "large.bin").exists()
    assert not (destination / "files" / "passwd").exists()
    assert not (destination / "files" / "passwd").is_symlink()
    assert (destination / "files" / "result.txt").read_bytes() == b"5\n"
