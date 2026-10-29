"""The regents command line."""

import warnings

from rich_click import RichContext, RichHelpConfiguration, RichHelpFormatter
from rich_click.patch import patch


class _Help(RichHelpFormatter):
    """Help whose lines end at their last character. Rich pads each line to the width, which a
    pipe would carry as spaces an agent reads as part of the help."""

    def getvalue(self) -> str:
        return "".join(line.rstrip() + "\n" for line in super().getvalue().splitlines())


# Help reads the Rich way at a terminal and as plain text in a pipe, for every command, whichever
# module builds it: Click's command classes are swapped before any command is made. The slim
# layout draws no boxes, so a pipe gets no frame characters, whatever RICH_CLICK_THEME says.
patch(
    RichHelpConfiguration(
        theme="default-slim",
        enable_theme_env_var=False,
        text_markup="ansi",
        text_paragraph_linebreaks="\n\n",
        padding_helptext_first_line=(0, 0, 1, 0),
    )
)
RichContext.formatter_class = _Help

# eth-account loads ckzg, which has not declared it can run without the GIL, so free-threaded
# Python turns the GIL on to load it, which is safe, and warns on every command.
warnings.filterwarnings(
    "ignore",
    message=r"The global interpreter lock \(GIL\) has been enabled to load module 'ckzg'",
    category=RuntimeWarning,
)
