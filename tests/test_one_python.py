"""One install serves every site: the Python the install line names is one Techtree runs on.

A machine has one `regents`. Installed as the other sites' guides say (Python 3.14), it once
failed `regents techtree doctor`, whose range stopped below 3.14, so a person following two
sites' guides could not use both.
"""

import re

from regents_cli.agent_hosts import INSTALL
from regents_cli.techtree.doctor.checks import SUPPORTED_PYTHON


def test_the_python_the_install_line_names_is_one_techtree_runs_on() -> None:
    named = re.search(r"--python (\d+)\.(\d+)", INSTALL)
    assert named is not None
    minimum, exclusive_maximum = SUPPORTED_PYTHON
    assert minimum <= (int(named[1]), int(named[2])) < exclusive_maximum
