"""The `regents` executable: one namespace per site, one answer shape, one set of exit codes."""

from __future__ import annotations

import os
import sys
from collections.abc import Sequence
from importlib.metadata import version

import click
import httpx

from regents_cli import browser, next_steps, output, siwa
from regents_cli.auth import auth_group
from regents_cli.errors import (
    EXIT_CANCELLED,
    EXIT_CODES,
    EXIT_OK,
    CommandError,
    UsageError,
)
from regents_cli.http import same_origin, unreadable_address
from regents_cli.platforms import Command, Platform, pinned_platforms
from regents_cli.runner import hinted, platform_group
from regents_cli.techtree.cli import techtree_group

# Rich help keeps each indented line on a line of its own, so every command can be copied whole.
HELP = """Every Regents Labs site from one command line.

Start here:

See Keyfleet's fleets; no sign-in needed:
    regents keyfleet fleets list

Search Patchbay for a fix; no sign-in needed:
    regents patchbay threads search --query webmcp

Ask your person first, then sign in; the first time makes a key on this machine, and on a Mac
your person confirms a Touch ID page:
    regents auth login --site keyfleet

Pair with your person; this says whether you are paired and how to pair:
    regents keyfleet agents whoami

Check a site answers, and your sign-in once you have one:
    regents keyfleet doctor

Get this machine ready to run a Techtree Climb:
    regents techtree setup

Add --help to any command to see what it does."""

# Rich help prints each paragraph of an epilog as one line, so each exit code is a paragraph.
EPILOG = "Add --json to any command for machine output.\n\nExit codes:\n\n" + "\n\n".join(
    f"{code:<3}  {meaning}" for code, meaning in EXIT_CODES.items()
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
            ),
            browser.OPEN_BROWSER,
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
    if value and not ctx.resilient_parsing:
        click.echo(f"regents {version('regents-cli')}")
        ctx.exit()


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
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
        )
    except click.UsageError as error:
        return _failed(UsageError(error.format_message()), cli, args)
    except CommandError as error:
        return _failed(error, cli, args)
    except httpx.InvalidURL as error:
        return _failed(unreadable_address(error), cli, args)
    except ImportError as error:
        missing = error.__context__
        if not isinstance(missing, ModuleNotFoundError) or missing.name != "socksio":
            raise
        return _failed(
            CommandError(
                "installation_incomplete",
                "SOCKS proxy support is missing from this CLI installation.",
                next_steps=[
                    next_steps.human(
                        "Repair this CLI environment by installing HTTPX with its SOCKS extra "
                        "using its package manager. Keep the proxy settings; "
                        "do not bypass the proxy."
                    )
                ],
            ),
            cli,
            args,
        )
    except click.ClickException as error:
        return _failed(CommandError("command_error", error.format_message()), cli, args)
    return EXIT_OK


def _failed(error: CommandError, cli: click.Group, args: list[str]) -> int:
    words, given = _read(cli, args)
    called = _invocation(words, given, args)
    # A usage failure stopped Click before it read every option, so a --json anywhere counts.
    as_json = given.get("as_json") is True or (isinstance(error, UsageError) and "--json" in args)
    steps = next_steps.for_failure(error, called)
    platform = next((p for p in pinned_platforms() if (p.name,) == called.words[:1]), None)
    if platform is not None and isinstance(error.fields.get("status"), int):
        # The site's pointer goes before a closing "nothing more to run".
        base_url = given.get("base_url")
        shared = [
            *(
                ["--base-url", next_steps.shown_address(base_url)]
                if isinstance(base_url, str) and base_url
                else []
            ),
            *(["--json"] if as_json else []),
        ]
        extra = [s for s in hinted(platform, error.fields.get("hint"), shared) if s not in steps]
        last = len(steps) - 1 if steps and steps[-1].kind == "done" else len(steps)
        steps[last:last] = extra
    output.emit_error(error, steps, as_json=as_json)
    return error.exit_code


def invocation(cli: click.Group, args: list[str]) -> next_steps.Invocation:
    """The command the arguments name, its site and that site's host."""
    words, given = _read(cli, args)
    return _invocation(words, given, args)


def _invocation(
    words: list[str], given: dict[str, object], args: list[str]
) -> next_steps.Invocation:
    platforms = pinned_platforms()
    platform: Platform | None = None
    if words[:1] == ["auth"]:
        site = given.get("site")
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
        host=platform.host if platform is not None else None,
        takes_stdin=bool(described and described.stdin_fields) or given.get("phase") == "send",
        # --phase prepare sends nothing, so it never pays.
        effect=described.effect
        if described is not None and given.get("phase") != "prepare"
        else None,
        description=described.description if described is not None else None,
        elsewhere=_elsewhere(platform, described, words, given),
    )


def _read(cli: click.Group, args: list[str]) -> tuple[list[str], dict[str, object]]:
    """The command words and options in the arguments, read as Click reads them to run a
    command, with nothing run: it follows groups as its shell completion does, and stops at an
    argument it cannot read."""
    words: list[str] = []
    try:
        context = cli.make_context("regents", list(args), resilient_parsing=True)
        rest = context._protected_args + context.args
        while isinstance(context.command, click.Group) and rest:
            name, command, rest = context.command.resolve_command(context, rest)
            if name is None or command is None:
                break
            words.append(name)
            context = command.make_context(name, rest, parent=context, resilient_parsing=True)
            rest = context._protected_args + context.args
    except click.ClickException:
        return words, {}
    return words, dict(context.params)


def _elsewhere(
    platform: Platform | None, described: Command | None, words: list[str], given: dict[str, object]
) -> str | None:
    """The address the command ran against, when it is not the usual one: the site's, from
    --base-url or the site's variable, which every site command and `auth status` reach, or the
    sign-in server's, from SIWA_BROKER, which `auth` and every signed command reach."""
    if platform is None:
        return None
    auth = words[:1] == ["auth"]
    addresses = []
    if not auth or words[1:2] == ["status"]:
        flag = given.get("base_url")
        site = flag if isinstance(flag, str) and flag else os.environ.get(platform.env_var)
        addresses.append((site, platform.base_url))
    if auth or (described is not None and described.signed):
        addresses.append((os.environ.get("SIWA_BROKER"), siwa.BROKER))
    return next(
        (named for named, usual in addresses if named and not same_origin(named, usual)), None
    )


def run() -> None:
    sys.exit(main())
