"""The `regents` executable: one namespace per site, one answer shape, one set of exit codes."""

from __future__ import annotations

import sys
from collections.abc import Sequence
from importlib.metadata import version

import click

from regents_cli import output
from regents_cli.errors import (
    EXIT_CANCELLED,
    EXIT_CODES,
    EXIT_FAILED,
    EXIT_OK,
    CommandError,
    UsageError,
)
from regents_cli.platforms import pinned_platforms
from regents_cli.runner import platform_group

EPILOG = "Add --json to any command for machine output.\n\nExit codes:\n\n" + "\n\n".join(
    f"  {code}  {meaning}" for code, meaning in EXIT_CODES.items()
)


def root() -> click.Group:
    group = click.Group(
        "regents",
        help="Every Regents Labs site from one command line.",
        epilog=EPILOG,
        no_args_is_help=True,
        params=[
            click.Option(
                ["--version"],
                is_flag=True,
                expose_value=False,
                is_eager=True,
                callback=_print_version,
                help="Print the version.",
            )
        ],
    )
    for platform in pinned_platforms():
        group.add_command(platform_group(platform))
    return group


def _print_version(ctx: click.Context, _param: click.Parameter, value: bool) -> None:
    if value:
        click.echo(f"regents {version('regents-cli')}")
        ctx.exit()


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in args[: args.index("--") if "--" in args else len(args)]
    try:
        root().main(args, prog_name="regents", standalone_mode=False)
    except click.exceptions.NoArgsIsHelpError as shown:
        click.echo(shown.ctx.get_help() if shown.ctx else "")
    except click.UsageError as error:
        problem = UsageError(error.format_message())
        output.emit_error(problem, as_json=as_json)
        return problem.exit_code
    except CommandError as error:
        output.emit_error(error, as_json=as_json)
        return error.exit_code
    except (click.Abort, KeyboardInterrupt):
        output.emit_error(
            CommandError("cancelled", "The command was interrupted.", exit_code=EXIT_CANCELLED),
            as_json=as_json,
        )
        return EXIT_CANCELLED
    except click.exceptions.Exit as done:
        return done.exit_code
    except click.ClickException as error:
        output.emit_error(CommandError("command_error", error.format_message()), as_json=as_json)
        return EXIT_FAILED
    return EXIT_OK


def run() -> None:
    sys.exit(main())
