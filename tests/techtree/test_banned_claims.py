"""What Techtree's copy may never claim, however reassuring it would sound.

The costly failure: a person believes a protection or a promise that does not exist. A run's
model calls go to a provider, nobody but the participant attests a run, nothing promises what
a run will cost, nothing publishes a finishing time, and an address left at publish time buys
nothing. Each claim is banned in the affirmative only, so the honest sentences that
say what does not happen stay allowed.

What is scanned is what a person or a host agent reads: every string in the Techtree modules
other than a module or class docstring (command docstrings are `--help`), and the README.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Final

ROOT: Final = Path(__file__).resolve().parents[2]

BANNED: Final[tuple[tuple[str, re.Pattern[str]], ...]] = tuple(
    (claim, re.compile(pattern, re.I))
    for claim, pattern in (
        ("nothing leaves the machine", r"nothing\s+leaves\s+(the|your|this)\s+"),
        ("nothing is sent anywhere", r"nothing\s+is\s+sent\s+anywhere"),
        ("a fully offline run", r"(fully|completely|entirely)\s+offline\s+(evaluation|run)"),
        ("no account is needed", r"(?<!techtree\s)\bno\s+accounts?\b(?!\s+of\b)"),
        ("the model is the reader's own", r"\byour\s+own\s+models?\b"),
        (
            "Techtree verified the run",
            r"techtree\s+verified\s+the\s+execution|verified\s+by\s+techtree",
        ),
        ("someone else verified the run", r"independently\s+(verified|proven)|trustless"),
        ("proof of honest compute", r"proof\s+of\s+honest\s+compute|without\s+trusting\s+us\b"),
        ("the retired Climb name", r"HelloWorldBench"),
        (
            "an exact Hello World score",
            r"\bsolves?\s+\d+\s+(of|out\s+of)\s+\d+\b|\b\d{1,2}\s*/\s*36\b",
        ),
        (
            "a bar that was met",
            r"\b(met|passed|cleared|reached|achieved)\b[^.]{0,60}\b(threshold|bar|standard)s?\b",
        ),
        ("a cost bound", r"\bcost\s+(bound|ceiling|cap)s?\b"),
        ("a price worked out in advance", r"\b(estimated|budget|cost|price)\s+(cost|estimate)s?\b"),
        (
            "a promise about the bill",
            r"\b(won'?t|will\s+not|never)\s+(cost|exceed|charge)\b|\b(at\s+most|no\s+more\s+than|up\s+to)\s+\$\s?\d",
        ),
        (
            "a promised finish",
            r"\b(finish|finishes|completes?|ends?|done)\s+(in|within)\s+\d+\s*(seconds?|minutes?|hours?)\b",
        ),
        (
            "a time-bounded run",
            r"\btime[-\s](bound|bounded|capped|boxed)\b|\brun\s+time\s+limits?\b",
        ),
        (
            "an airdrop or token reward",
            r"\bair[\s-]?drops?\b|\btoken\s+(allocation|distribution|reward)s?\b",
        ),
        (
            "paying for an address",
            r"\b(pays?|paid|rewards?|rewarded|compensated?)\b[^.]{0,40}\b(your|an|the)\s+(address|wallet)\b",
        ),
        (
            "value promised to a contributor",
            r"\b(you|contributors?|participants?)\b(?:(?!\b(?:not|never|nothing)\b)[^.]){0,30}\b(will|'ll)\s+(receive|earn|be\s+paid|be\s+rewarded)\b",
        ),
    )
)


def _texts() -> list[tuple[str, str]]:
    found = [("README.md", (ROOT / "README.md").read_text("utf-8"))]
    for module in sorted((ROOT / "src" / "regents_cli" / "techtree").rglob("*.py")):
        tree = ast.parse(module.read_text("utf-8"))
        notes = {
            id(node.body[0].value)
            for node in ast.walk(tree)
            if isinstance(node, ast.Module | ast.ClassDef)
            and node.body
            and isinstance(node.body[0], ast.Expr)
        }
        found += [
            (f"{module.relative_to(ROOT)}:{node.lineno}", node.value)
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and id(node) not in notes
        ]
    return found


def test_no_copy_makes_a_banned_claim() -> None:
    """A sentence that promises privacy, verification, a price, a finish or a reward is refused."""
    offenders = [
        f"{where}: {claim}"
        for where, text in _texts()
        for claim, pattern in BANNED
        if pattern.search(" ".join(text.split()))
    ]
    assert not offenders, "\n".join(offenders)
