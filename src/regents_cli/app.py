"""The `regents` executable: one namespace per site, one answer shape, one set of exit codes."""

from __future__ import annotations

import sys
from collections.abc import Sequence
from importlib.metadata import version
from urllib.parse import urlsplit

import click
import httpx

from regents_cli import next_steps, output
from regents_cli.auth import auth_group
from regents_cli.errors import (
    EXIT_CANCELLED,
    EXIT_CODES,
    EXIT_OK,
    CommandError,
    UsageError,
)
from regents_cli.http import unreadable_address
from regents_cli.platforms import Platform, pinned_platforms
from regents_cli.runner import platform_group
from regents_cli.techtree.cli import techtree_group

# Click keeps a paragraph that follows a \b line exactly as written.
HELP = """Every Regents Labs site from one command line.

\b
Start here:
  Read Patchbay's threads; no sign-in needed:
    regents patchbay threads search --query webmcp
  Sign in to Patchbay; the first time makes a key on this machine:
    regents auth login --site patchbay
  Check Patchbay answers and accepts your sign-in:
    regents patchbay doctor
  Get this machine ready to run a Techtree Climb:
    regents techtree setup

Add --help to any command to see what it does."""

EPILOG = "Add --json to any command for machine output.\n\nExit codes:\n\n" + "\n\n".join(
    f"  {code}  {meaning}" for code, meaning in EXIT_CODES.items()
)


def root() -> click.Group:
    group = click.Group(
        "regents",
        help=HELP,
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
    platforms = pinned_platforms()
    custom_groups = {"techtree": techtree_group()}
    group.add_command(auth_group(sorted({p.site for p in platforms} | custom_groups.keys())))
    for platform in platforms:
        group.add_command(platform_group(platform, custom_groups.pop(platform.name, None)))
    for custom in custom_groups.values():
        group.add_command(custom)
    return group


def _print_version(ctx: click.Context, _param: click.Parameter, value: bool) -> None:
    if value:
        click.echo(f"regents {version('regents-cli')}")
        ctx.exit()


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in args[: args.index("--") if "--" in args else len(args)]
    cli = root()
    try:
        cli.main(args, prog_name="regents", standalone_mode=False)
    except click.exceptions.NoArgsIsHelpError as shown:
        click.echo(shown.ctx.get_help() if shown.ctx else "")
    except click.exceptions.Exit as done:
        return done.exit_code
    except (click.Abort, KeyboardInterrupt):
        return _failed(
            CommandError("cancelled", "The command was interrupted.", exit_code=EXIT_CANCELLED),
            cli,
            args,
            as_json,
        )
    except click.UsageError as error:
        return _failed(UsageError(error.format_message()), cli, args, as_json)
    except CommandError as error:
        return _failed(error, cli, args, as_json)
    except httpx.InvalidURL as error:
        return _failed(unreadable_address(error), cli, args, as_json)
    except click.ClickException as error:
        return _failed(CommandError("command_error", error.format_message()), cli, args, as_json)
    return EXIT_OK


def _failed(error: CommandError, cli: click.Group, args: list[str], as_json: bool) -> int:
    steps = next_steps.for_failure(error, invocation(cli, args))
    output.emit_error(error, steps, as_json=as_json)
    return error.exit_code


def invocation(cli: click.Group, args: list[str]) -> next_steps.Invocation:
    """The command the arguments name, its site and that site's host."""
    words: list[str] = []
    command: click.Command = cli
    for arg in args:
        child = command.commands.get(arg) if isinstance(command, click.Group) else None
        if child is None:
            break
        words.append(arg)
        command = child
    platforms = pinned_platforms()
    platform: Platform | None = None
    if words[:1] == ["auth"]:
        site = _value_of("--site", args)
        platform = next((p for p in platforms if p.site == site), None)
    elif words:
        platform = next((p for p in platforms if p.name == words[0]), None)
    described = (
        next((c for c in platform.commands if (*c.group_words, c.name) == tuple(words[1:])), None)
        if platform is not None
        else None
    )
    return next_steps.Invocation(
        args=tuple(args),
        words=tuple(words),
        site=platform.site if platform is not None else None,
        host=urlsplit(platform.base_url).hostname if platform is not None else None,
        takes_stdin=bool(described and described.stdin_fields)
        or _value_of("--phase", args) == "send",
        effect=described.effect if described is not None else None,
        description=described.description if described is not None else None,
    )


def _value_of(flag: str, args: list[str]) -> str | None:
    for index, arg in enumerate(args):
        if arg == flag and index + 1 < len(args):
            return args[index + 1]
        if arg.startswith(flag + "="):
            return arg.removeprefix(flag + "=")
    return None


def run() -> None:
    sys.exit(main())
