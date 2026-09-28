"""Techtree's digests and signatures stay byte-identical to 0.3.0.

The costly failure: a change to canonical JSON or signing makes every run, proof and published
entry fail to verify at once. The expected values were made by Techtree 0.3.0 from these inputs.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from regents_cli.techtree.canonical import canonical_json_bytes, digest_object
from regents_cli.techtree.crypto import load_private_key, public_key_to_base64, sign_digest

VALUE = {
    "z": [1, 2.5, 1e21, -0.0, True, None],
    "a": 'é\u2028\U0001f600"\\',
    "t": datetime(2026, 9, 27, 12, 0, tzinfo=timezone(timedelta(hours=2))),
    "d": Decimal("0.1"),
    "n": {"b": 1, "a": {"c": [], "": "x"}},
}
CANONICAL = (
    '{"a":"é\u2028\U0001f600\\"\\\\","d":0.1,"n":{"a":{"":"x","c":[]},"b":1},'
    '"t":"2026-09-27T10:00:00Z","z":[1,2.5,1e+21,0,true,null]}'
).encode()
DIGEST = "sha256:99321461c7b44cbe4dfe24c9ae589fa2b1b3b7986d23b88a89ace5e7a4fd8c51"
SIGNATURE = (
    "0xYi0u7lc1XXb0i7z8ERsm96fr8w1/RFyXswbJ6IIbx2+HiI0ln1doYHj0bCig40a3XJsAcAwejHSL+9LNsqAg=="
)
PUBLIC_KEY = "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg="


def test_canonical_bytes_and_digest_match_0_3_0() -> None:
    assert canonical_json_bytes(VALUE) == CANONICAL
    assert digest_object(VALUE) == DIGEST


def test_a_signature_over_the_digest_matches_0_3_0() -> None:
    key = load_private_key(bytes(range(32)))
    assert public_key_to_base64(key.public_key()) == PUBLIC_KEY
    assert sign_digest(key, DIGEST, key_id="sha256:" + "0" * 64).signature == SIGNATURE
