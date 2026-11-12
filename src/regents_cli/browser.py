"""Pages the person opens on this machine: the Touch ID page and the ChatGPT sign-in.

`regents` prints the address and opens nothing, unless the person ran it as
`regents --open-browser …`.
"""

from __future__ import annotations

import webbrowser

import click

from regents_cli.output import stderr

OPEN_BROWSER = click.Option(
    ["--open-browser"],
    is_flag=True,
    help="Open Touch ID and sign-in pages in this computer's browser. Without it, the page's "
    "address is printed for you to open.",
)


def offer(ask: str, address: str) -> None:
    """Print what the person does and the page's address; open the page when asked to."""
    stderr.print(f"{ask}\n{address}", soft_wrap=True, markup=False)
    context = click.get_current_context(silent=True)
    if context is not None and context.find_root().params.get("open_browser"):
        webbrowser.open(address)
