"""The agent key locked with a passkey.

- A stuck key helper ends the command with a clear error and never unlocks the key a second time
  behind it (WD-002: without a limit, every signed command hung with no message).
- A locked key opens only with its own passkey's secret and only for its own address.
- The helper signs exactly the transaction it is given, as the key's own address.
"""

from __future__ import annotations

import os
import socket
import tempfile
import threading
import time
from collections.abc import Iterator
from typing import Any

import pytest
from cryptography.exceptions import InvalidTag
from eth_account import Account
from eth_account.typed_transactions.typed_transaction import TypedTransaction
from hexbytes import HexBytes
from hypothesis import given
from hypothesis import strategies as st

from regents_cli import passkey
from regents_cli.errors import CommandError


@pytest.fixture
def stuck_helper(request: pytest.FixtureRequest) -> Iterator[str]:
    """A helper socket that is listening but never answers; it accepts the connection or not."""
    path = os.path.join(tempfile.mkdtemp(prefix="rc", dir="/tmp"), "h.sock")
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(path)
    listener.listen(1)
    held: list[socket.socket] = []
    if request.param == "accepts":
        threading.Thread(target=lambda: held.append(listener.accept()[0]), daemon=True).start()
    yield path
    for connection in held:
        connection.close()
    listener.close()
    os.unlink(path)
    os.rmdir(os.path.dirname(path))


@pytest.mark.parametrize("stuck_helper", ["never_accepts", "accepts"], indirect=True)
def test_a_silent_helper_ends_the_command(
    stuck_helper: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    def must_not_unlock(*_: Any) -> None:
        raise AssertionError("unlocked the key again behind a stuck helper")

    monkeypatch.setattr(passkey, "HELPER_ANSWER_SECONDS", 0.5)
    monkeypatch.setattr(passkey, "_helper_socket", lambda _address: stuck_helper)
    monkeypatch.setattr(passkey, "_open_box", must_not_unlock)
    monkeypatch.setattr(passkey, "start_helper", must_not_unlock)

    started = time.monotonic()
    with pytest.raises(CommandError) as raised:
        passkey.unlocked("0x" + "ab" * 20, {}, {"op": "address"})
    assert raised.value.code == "key_helper_not_answering"
    assert stuck_helper in raised.value.message
    assert time.monotonic() - started < 5


ADDRESSES = st.binary(min_size=20, max_size=20).map(lambda raw: "0x" + raw.hex())
SECRETS = st.binary(min_size=32, max_size=32).map(bytes.hex)


@given(
    key=st.binary(min_size=32, max_size=32).map(lambda raw: "0x" + raw.hex()),
    address=ADDRESSES,
    secret=SECRETS,
    other_address=ADDRESSES,
    other_secret=SECRETS,
)
def test_a_locked_key_opens_only_with_its_passkey_for_its_address(
    key: str, address: str, secret: str, other_address: str, other_secret: str
) -> None:
    def passkey_secret(mode: str, _address: str, _credential: str | None) -> dict[str, str]:
        return {"credential_id": "credential", "secret": given_secret[0]}

    given_secret = [secret]
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(passkey, "_passkey_secret", passkey_secret)
        locked = passkey.lock(address, key)
        assert key not in locked["box"]
        assert passkey._open_box(address, locked) == key
        if other_address != address:
            with pytest.raises(InvalidTag):
                passkey._open_box(other_address, locked)
        if other_secret != secret:
            given_secret[0] = other_secret
            with pytest.raises(InvalidTag):
                passkey._open_box(address, locked)


QUANTITY = st.integers(min_value=0, max_value=2**256 - 1)
#: Every key secp256k1 accepts: 1 up to one below the curve's order.
PRIVATE_KEYS = st.integers(
    min_value=1, max_value=0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140
)


@given(
    private_key=PRIVATE_KEYS,
    chain=st.integers(min_value=1, max_value=2**64 - 1),
    nonce=st.integers(min_value=0, max_value=2**64 - 2),
    value=QUANTITY,
    gas=st.integers(min_value=0, max_value=2**64 - 1),
    fees=st.tuples(QUANTITY, QUANTITY),
    to=st.binary(min_size=20, max_size=20),
    data=st.binary(max_size=200),
)
def test_the_helper_signs_exactly_the_transaction_it_is_given(
    private_key: int,
    chain: int,
    nonce: int,
    value: int,
    gas: int,
    fees: tuple[int, int],
    to: bytes,
    data: bytes,
) -> None:
    key = "0x" + private_key.to_bytes(32, "big").hex()
    asked = {
        "chainId": hex(chain),
        "nonce": hex(nonce),
        "to": "0x" + to.hex(),
        "data": "0x" + data.hex(),
        "value": hex(value),
        "gas": hex(gas),
        "maxFeePerGas": hex(fees[0]),
        "maxPriorityFeePerGas": hex(fees[1]),
    }
    raw = passkey.sign_transaction_with(key, asked)
    signed = TypedTransaction.from_bytes(HexBytes(raw)).as_dict()
    assert Account.recover_transaction(raw) == Account.from_key(key).address
    assert (signed["type"], signed["accessList"]) == (2, ())
    assert {name: signed[name] for name in asked} == {
        "chainId": chain,
        "nonce": nonce,
        "to": HexBytes(to),
        "data": HexBytes(data),
        "value": value,
        "gas": gas,
        "maxFeePerGas": fees[0],
        "maxPriorityFeePerGas": fees[1],
    }
