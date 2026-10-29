"""The regents command line."""

import warnings

from rich_click import RichHelpConfiguration
from rich_click.patch import patch

# Help reads the Rich way at a terminal and as plain text in a pipe, for every command, whichever
# module builds it: Click's command classes are swapped before any command is made.
patch(
    RichHelpConfiguration(
        text_markup="ansi",
        text_paragraph_linebreaks="\n\n",
        padding_helptext_first_line=(0, 0, 1, 0),
    )
)

# eth-account loads ckzg, which has not declared it can run without the GIL, so free-threaded
# Python turns the GIL on to load it, which is safe, and warns on every command.
warnings.filterwarnings(
    "ignore",
    message=r"The global interpreter lock \(GIL\) has been enabled to load module 'ckzg'",
    category=RuntimeWarning,
)
