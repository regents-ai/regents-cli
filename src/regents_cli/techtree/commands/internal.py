"""The two hidden commands Techtree starts for itself: a run's worker and its supervisor."""

from __future__ import annotations

from pathlib import Path

import click

from regents_cli.techtree.runs.worker import execute_run
from regents_cli.techtree.verifiers.supervisor import supervise


def _worker(run_id: str) -> None:
    raise click.exceptions.Exit(execute_run(run_id))


def _supervise(
    variant: str,
    parent_fd: int,
    record: Path,
    deadline_seconds: float,
    grace_seconds: float,
    eval_argv: tuple[str, ...],
) -> None:
    raise click.exceptions.Exit(
        supervise(
            variant=variant,
            parent_fd=parent_fd,
            record_path=record,
            deadline_seconds=deadline_seconds,
            grace_seconds=grace_seconds,
            eval_argv=list(eval_argv),
        )
    )


WORKER = click.Command(
    "_worker",
    callback=_worker,
    hidden=True,
    help="Execute one run in this process; started detached by `climb start`.",
    params=[click.Option(["--run-id"], required=True, help="The run to execute.")],
)

SUPERVISE = click.Command(
    "_supervise",
    callback=_supervise,
    hidden=True,
    help="Supervise one evaluation child; started by the worker.",
    params=[
        click.Option(["--variant"], required=True),
        click.Option(["--parent-fd"], type=int, required=True),
        click.Option(["--record"], type=click.Path(path_type=Path), required=True),
        click.Option(["--deadline-seconds"], type=float, required=True),
        click.Option(["--grace-seconds"], type=float, required=True),
        click.Argument(["eval_argv"], nargs=-1, type=click.UNPROCESSED),
    ],
)
