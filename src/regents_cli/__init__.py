"""The regents command line."""

import warnings

# eth-account loads ckzg, which has not declared it can run without the GIL, so free-threaded
# Python turns the GIL on to load it, which is safe, and warns on every command.
warnings.filterwarnings(
    "ignore",
    message=r"The global interpreter lock \(GIL\) has been enabled to load module 'ckzg'",
    category=RuntimeWarning,
)
