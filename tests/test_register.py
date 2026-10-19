"""`regents auth register`, run whole against a stand-in sign-in server and a stand-in Base node:
- regents builds the registration itself, the same transaction the live sign-in server builds;
- a registration the server alters in any way is refused before anything is signed or sent;
- with the agent key, what regents shows before signing is exactly what it signs and sends, once,
  and bytes the key helper signs differently, or as another kind of transaction, are never sent;
- the most it can cost counts the gas and Base's fee for writing it to Ethereum, and a wallet
  without that much ETH is told the exact amount, and nothing is signed;
- a node number regents cannot read stops it before anything is signed;
- a node's refusal and a server answer regents cannot read end in regents's own words, and once a
  transaction is sent its hash is always kept, with the command that checks it;
- a name, description or image holding bytes that are not text is refused as a usage error.
"""

from __future__ import annotations

import contextlib
import io
import json
import re
import tempfile
from pathlib import Path
from typing import Any

import httpx
import pytest
from eth_account import Account
from eth_account.typed_transactions.typed_transaction import TypedTransaction
from eth_utils.crypto import keccak
from hexbytes import HexBytes
from hypothesis import given, settings
from hypothesis import strategies as st

from regents_cli import app, base, passkey, siwa

KEY = "0x" + "00" * 31 + "07"
ADDRESS = Account.from_key(KEY).address.lower()
SIGN_IN = "https://sign-in.example"
NODE = "https://node.example"
RECORDED = json.loads((Path(__file__).parent / "registration_steps.json").read_text("utf-8"))
TEXT = st.text(st.characters(blacklist_categories=["Cs"]), min_size=1, max_size=40)
PROFILES = st.fixed_dictionaries(
    {"name": TEXT, "description": TEXT},
    optional={"image": st.just("https://example.com/agent.png")},
)
WEI = st.integers(min_value=1, max_value=10**12)


def built(profile: dict[str, str]) -> dict[str, Any]:
    """The registration the stand-in sign-in server offers when it is honest."""
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setenv("SIWA_BROKER", SIGN_IN)
        return siwa.registration_transaction({"wallet_address": ADDRESS, **profile})


class Stand:
    """A sign-in server that offers `step`, and a Base node that prices and accepts it."""

    def __init__(self, step: Any, prices: dict[str, int], outcome: Any = None) -> None:
        self.step, self.prices = step, prices
        self.outcome = outcome or {
            "code": "agent_registered",
            "data": {
                "walletAddress": ADDRESS,
                "agentId": "eip155:8453:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:7",
                "registryUrl": "https://www.8004scan.io/agents/base/7",
                "profileUrl": f"{SIGN_IN}/agent-profiles/x",
                "txHash": "0x" + "ab" * 32,
            },
        }
        self.node: list[tuple[str, list[Any]]] = []
        self.refuse: str | None = None
        self.garble: tuple[str, Any] | None = None
        #: How the sign-in server answers the listing check: a status, or None when unreachable.
        self.outcome_status: int | None = 200

    def post(self, url: str, *, json: dict[str, Any], **_: Any) -> httpx.Response:
        if url == f"{SIGN_IN}/api/shared/siwa/agent/register-step":
            return httpx.Response(200, json={"code": "registration_step", "data": self.step})
        if url == f"{SIGN_IN}/api/shared/siwa/agent/registered":
            if self.outcome_status is None:
                raise httpx.ConnectError("down")
            return httpx.Response(self.outcome_status, json=self.outcome)
        assert url == NODE
        method = json["method"]
        self.node.append((method, json["params"]))
        if method == self.refuse:
            return httpx.Response(200, json={"error": {"message": "secret node words 0xdead"}})
        answers = {
            "eth_estimateGas": hex(self.prices["gas"]),
            "eth_maxPriorityFeePerGas": hex(self.prices["tip"]),
            "eth_getBlockByNumber": {"baseFeePerGas": hex(self.prices["base_fee"])},
            "eth_getTransactionCount": hex(self.prices["nonce"]),
            "eth_getBalance": hex(self.prices["balance"]),
            "eth_call": f"0x{self.prices['l1']:064x}",
            "eth_sendRawTransaction": "0x" + "00" * 32,
        }
        if self.garble is not None and self.garble[0] == method:
            said = self.garble[1]
            answers[method] = {"baseFeePerGas": said} if method == "eth_getBlockByNumber" else said
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": answers[method]})

    def sent(self) -> list[str]:
        return [params[0] for method, params in self.node if method == "eth_sendRawTransaction"]


def register(
    stand: Stand,
    profile: dict[str, str],
    folder: Path,
    monkeypatch: pytest.MonkeyPatch,
    *extra: str,
) -> tuple[int, str, str]:
    home = folder / "agent"
    home.mkdir(mode=0o700)
    (home / "key.json").write_text(json.dumps({"address": ADDRESS, "private_key": KEY}))
    (home / "key.json").chmod(0o600)
    monkeypatch.setenv("SIWA_AGENT_HOME", str(home))
    monkeypatch.setenv("SIWA_BROKER", SIGN_IN)
    monkeypatch.setenv("SIWA_BASE_RPC", NODE)
    monkeypatch.setattr(httpx, "post", stand.post)
    args = ["auth", "register", "--name", profile["name"], "--description", profile["description"]]
    args += ["--image", profile["image"]] if "image" in profile else []
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = app.main([*args, *extra])
    return code, out.getvalue(), err.getvalue()


def plenty(**prices: int) -> dict[str, int]:
    return {
        "gas": 100_000,
        "tip": 10**6,
        "base_fee": 10**7,
        "nonce": 3,
        "balance": 10**18,
        "l1": 10**9,
        **prices,
    }


def most_it_costs(prices: dict[str, int]) -> int:
    """Gas with a fifth more than the estimate, at twice the base fee plus the tip, and Base's
    fee for writing the transaction to Ethereum; the registration sends no ETH."""
    return (prices["gas"] * 6 // 5) * (prices["base_fee"] * 2 + prices["tip"]) + prices["l1"]


@pytest.mark.parametrize("case", RECORDED, ids=["unicode", "image", "control characters"])
def test_regents_builds_the_registration_the_live_sign_in_server_builds(
    case: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SIWA_BROKER", "https://siwa.regents.sh")
    assert siwa.registration_transaction(case["profile"]) == case["step"]


TAMPERED = st.one_of(
    st.sampled_from(["to", "data", "agentUri", "from"]).map(lambda f: (f, "0x" + "de" * 20)),
    st.tuples(st.just("value"), WEI.map(hex)),
    st.tuples(st.just("chainId"), st.integers(1, 10**6).filter(lambda c: c != 8453)),
    st.tuples(st.just("extra"), st.just("field")),
    st.tuples(st.just("missing"), st.sampled_from(["to", "data", "value", "chainId"])),
)


@given(profile=PROFILES, tamper=TAMPERED)
@settings(deadline=None, max_examples=60)
def test_a_registration_the_server_alters_is_refused_before_anything_is_signed(
    profile: dict[str, str], tamper: tuple[str, Any]
) -> None:
    field, value = tamper
    step = built(profile)
    if field == "missing":
        del step[value]
    else:
        step[field] = value
    stand = Stand(step, plenty())
    with tempfile.TemporaryDirectory() as folder, pytest.MonkeyPatch.context() as monkeypatch:
        code, out, err = register(stand, profile, Path(folder), monkeypatch, "--json")
    assert code == 3, err
    told = json.loads(out)
    assert told["error"]["code"] == "registration_step_differs"
    assert "Send nothing" in json.dumps(told["next_steps"])
    assert stand.node == []
    assert "Traceback" not in err


@given(
    profile=PROFILES,
    gas=st.integers(21_000, 10**7),
    tip=WEI,
    base_fee=WEI,
    nonce=st.integers(0, 2**32),
    l1=st.integers(0, 10**15),
)
@settings(deadline=None, max_examples=40)
def test_what_regents_shows_before_signing_is_what_it_signs_and_sends(
    profile: dict[str, str], gas: int, tip: int, base_fee: int, nonce: int, l1: int
) -> None:
    prices = plenty(gas=gas, tip=tip, base_fee=base_fee, nonce=nonce, balance=10**30, l1=l1)
    stand = Stand(built(profile), prices)
    with tempfile.TemporaryDirectory() as folder, pytest.MonkeyPatch.context() as monkeypatch:
        code, out, err = register(stand, profile, Path(folder), monkeypatch, "--json")
    assert code == 0, err
    [signing] = [json.loads(line)["signing"] for line in err.splitlines() if '"signing"' in line]
    step = built(profile)
    assert (signing["from"], signing["agentUri"]) == (ADDRESS, step["agentUri"])
    assert signing["most_it_costs"] == base.eth(most_it_costs(prices))
    shown = signing["transaction"]
    [raw] = stand.sent()
    signed = TypedTransaction.from_bytes(HexBytes(raw)).as_dict()
    as_signed = {
        "chainId": hex(signed["chainId"]),
        "nonce": hex(signed["nonce"]),
        "to": "0x" + bytes(signed["to"]).hex(),
        "data": "0x" + bytes(signed["data"]).hex(),
        "value": hex(signed["value"]),
        "gas": hex(signed["gas"]),
        "maxFeePerGas": hex(signed["maxFeePerGas"]),
        "maxPriorityFeePerGas": hex(signed["maxPriorityFeePerGas"]),
    }
    assert json.dumps(shown) == json.dumps(as_signed)
    assert (shown["chainId"], shown["to"], shown["data"], shown["value"]) == (
        "0x2105",
        siwa.REGISTRY,
        step["data"],
        "0x0",
    )
    assert shown["gas"] == hex(gas * 6 // 5)
    assert shown["maxFeePerGas"] == hex(base_fee * 2 + tip)
    assert Account.recover_transaction(raw).lower() == ADDRESS
    assert json.loads(out)["listed"] is True


def test_the_readable_review_names_the_wallet_chain_registry_and_amount(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    profile = {"name": "Probe", "description": "A test agent."}
    stand = Stand(built(profile), plenty())
    code, out, err = register(stand, profile, tmp_path, monkeypatch)
    assert code == 0, err
    # Read without the panel's border or line breaks, however wide the terminal is.
    flat = re.sub(r"[\s│╭╮╰╯─]", "", out)
    for said in (
        f"{ADDRESS}, the agent key on this machine, signs and sends this on Base (chain 8453).",
        f"It calls register on the agent registry {siwa.REGISTRY}",
        f"Amount: 0 ETH. Gas: at most 0.000002521 ETH, paid by {ADDRESS}.",
        *(f"{field}: {value}" for field, value in shown_by_json(profile).items()),
    ):
        assert re.sub(r"\s", "", said) in flat
    assert flat.index("Review") < flat.index("agentid") < flat.index("Next")


def shown_by_json(profile: dict[str, str]) -> dict[str, str]:
    """The transaction `register --json` shows before signing, against the same stand-ins."""
    stand = Stand(built(profile), plenty())
    with tempfile.TemporaryDirectory() as folder, pytest.MonkeyPatch.context() as monkeypatch:
        _code, _out, err = register(stand, profile, Path(folder), monkeypatch, "--json")
    shown: dict[str, str] = json.loads(err)["signing"]["transaction"]
    return shown


@given(shortfall=st.integers(1, 10**15))
@settings(deadline=None, max_examples=30)
def test_a_wallet_short_of_eth_is_told_exactly_how_much_and_nothing_is_signed(
    shortfall: int,
) -> None:
    profile = {"name": "Probe", "description": "A test agent."}
    prices = plenty()
    needs = most_it_costs(prices)
    stand = Stand(built(profile), {**prices, "balance": max(needs - shortfall, 0)})
    with tempfile.TemporaryDirectory() as folder, pytest.MonkeyPatch.context() as monkeypatch:
        code, out, _ = register(stand, profile, Path(folder), monkeypatch, "--json")
    told = json.loads(out)
    assert (code, told["error"]["code"]) == (1, "base_needs_eth")
    assert f"can take up to {base.eth(needs)} ETH" in told["error"]["message"]
    holds = max(needs - shortfall, 0)
    assert f"at least {base.eth(needs - holds)} ETH" in json.dumps(told["next_steps"])
    assert stand.sent() == []


@pytest.mark.parametrize(
    "method", ["eth_estimateGas", "eth_call", "eth_getBalance", "eth_sendRawTransaction"]
)
def test_a_node_refusal_is_told_in_regents_words(
    method: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    profile = {"name": "Probe", "description": "A test agent."}
    stand = Stand(built(profile), plenty())
    stand.refuse = method
    code, out, err = register(stand, profile, tmp_path, monkeypatch)
    assert code == 1
    assert "nothing was sent" in " ".join(err.split())
    assert "secret node words" not in out + err
    assert "Traceback" not in err


PRICED = [
    "eth_estimateGas",
    "eth_maxPriorityFeePerGas",
    "eth_getBlockByNumber",
    "eth_getTransactionCount",
    "eth_call",
    "eth_getBalance",
]
#: Answers that are not a number as a node writes one, or not a 32-byte word for eth_call.
GARBLED = st.one_of(
    st.sampled_from(["-0x1", "0x", "0x01", "0xzz", "12", "", " 0x1", "0x1 "]),
    st.integers(),
    st.none(),
    st.lists(st.just("0x1"), max_size=1),
    st.text(max_size=8)
    .map(lambda said: "0x" + said)
    .filter(lambda said: not re.fullmatch(r"0x(0|[1-9a-fA-F][0-9a-fA-F]*)", said)),
)


@given(method=st.sampled_from(PRICED), said=GARBLED)
@settings(deadline=None, max_examples=80)
def test_a_node_number_regents_cannot_read_stops_it_before_signing(method: str, said: Any) -> None:
    profile = {"name": "Probe", "description": "A test agent."}
    stand = Stand(built(profile), plenty())
    stand.garble = (method, said)
    with tempfile.TemporaryDirectory() as folder, pytest.MonkeyPatch.context() as monkeypatch:
        code, out, err = register(stand, profile, Path(folder), monkeypatch, "--json")
    told = json.loads(out)
    assert (code, told["error"]["code"]) == (1, "base_answer_unreadable"), err
    assert NODE in json.dumps(told["next_steps"])
    assert stand.sent() == []


@given(
    tamper=st.sampled_from(["nonce", "to", "value", "gas", "maxFeePerGas", "data", "chainId"]),
)
@settings(deadline=None, max_examples=20)
def test_bytes_the_key_helper_signs_differently_are_never_sent(tamper: str) -> None:
    profile = {"name": "Probe", "description": "A test agent."}
    stand = Stand(built(profile), plenty())
    real = siwa.sign_transaction

    def helper(key: siwa.Key, transaction: dict[str, str]) -> str:
        other = dict(transaction)
        other[tamper] = "0x" + "de" * 20 if tamper == "to" else hex(int(other[tamper], 16) + 1)
        return real(key, other)

    with tempfile.TemporaryDirectory() as folder, pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(siwa, "sign_transaction", helper)
        code, out, _ = register(stand, profile, Path(folder), monkeypatch, "--json")
    assert (code, json.loads(out)["error"]["code"]) == (3, "signed_transaction_differs")
    assert stand.sent() == []


def other_kind(kind: str, transaction: dict[str, str]) -> dict[str, Any]:
    """`transaction`, with all it shows unchanged, as a kind of transaction the agent key never
    signs."""
    fields = passkey.dynamic_fee(transaction)
    if kind == "access list":
        held = [
            {"address": "0x" + f"{n:040x}", "storageKeys": ["0x" + "00" * 32]} for n in range(40)
        ]
        return {**fields, "accessList": held}
    if kind == "delegation":
        handed = Account.sign_authorization(
            {
                "chainId": fields["chainId"],
                "address": "0x" + "de" * 20,
                "nonce": fields["nonce"] + 1,
            },
            KEY,
        )
        return {**fields, "type": 4, "authorizationList": [handed]}
    fee = {"gasPrice": fields.pop("maxFeePerGas")}
    del fields["maxPriorityFeePerGas"], fields["accessList"], fields["type"]
    return {**fields, **fee, **({"type": 1, "accessList": []} if kind == "type 1" else {})}


@pytest.mark.parametrize("kind", ["access list", "delegation", "type 1", "legacy"])
def test_another_kind_of_transaction_the_key_helper_signs_is_never_sent(
    kind: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    profile = {"name": "Probe", "description": "A test agent."}
    stand = Stand(built(profile), plenty())

    def helper(_key: siwa.Key, transaction: dict[str, str]) -> str:
        signed = Account.sign_transaction(other_kind(kind, transaction), KEY)
        return "0x" + bytes(signed.raw_transaction).hex()

    monkeypatch.setattr(siwa, "sign_transaction", helper)
    code, out, err = register(stand, profile, tmp_path, monkeypatch, "--json")
    assert (code, json.loads(out)["error"]["code"]) == (3, "signed_transaction_differs"), err
    assert stand.sent() == []


def test_the_shown_transaction_signed_by_another_key_is_never_sent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    profile = {"name": "Probe", "description": "A test agent."}
    stand = Stand(built(profile), plenty())
    other = "0x" + "00" * 31 + "08"
    monkeypatch.setattr(
        siwa, "sign_transaction", lambda _key, t: passkey.sign_transaction_with(other, t)
    )
    code, out, err = register(stand, profile, tmp_path, monkeypatch, "--json")
    assert (code, json.loads(out)["error"]["code"]) == (3, "signed_transaction_differs"), err
    assert stand.sent() == []


@pytest.mark.parametrize("raw", ["0x", "0x02c0", "not hex", 7, None], ids=repr)
def test_bytes_the_key_helper_cannot_have_signed_are_never_sent(
    raw: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    profile = {"name": "Probe", "description": "A test agent."}
    stand = Stand(built(profile), plenty())
    monkeypatch.setattr(siwa, "sign_transaction", lambda _key, _transaction: raw)
    code, out, err = register(stand, profile, tmp_path, monkeypatch, "--json")
    assert (code, json.loads(out)["error"]["code"]) == (3, "signed_transaction_differs")
    assert stand.sent() == []
    assert "Traceback" not in err


@pytest.mark.parametrize("flag", ["name", "description", "image"])
def test_bytes_that_are_not_text_are_a_usage_error(
    flag: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # What Python makes of the bytes 0xff in an argument on a UTF-8 system.
    profile = {"name": "Probe", "description": "A test agent.", flag: "agent\udcff"}
    stand = Stand(built({"name": "Probe", "description": "A test agent."}), plenty())
    code, out, err = register(stand, profile, tmp_path, monkeypatch, "--json")
    assert code == 2, err
    assert f"--{flag} holds bytes that are not text" in json.loads(out)["error"]["message"]
    assert stand.node == []
    assert "Traceback" not in err


def sent_hash(stand: Stand) -> str:
    [raw] = stand.sent()
    return "0x" + keccak(hexstr=raw).hex()


@pytest.mark.parametrize(
    ("status", "outcome"),
    [
        (200, {"code": "something_else"}),
        (200, {"code": "agent_registered"}),
        (200, {"code": "agent_registered", "data": {}}),
        (500, {"error": {"message": "secret server words"}}),
        (None, None),
    ],
    ids=["unknown code", "no listing", "empty listing", "server error", "unreachable"],
)
def test_once_sent_a_failed_listing_check_keeps_the_hash_and_how_to_check_it(
    status: int | None,
    outcome: Any,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = {"name": "Probe", "description": "A test agent."}
    stand = Stand(built(profile), plenty(), outcome)
    stand.outcome_status = status
    code, out, err = register(stand, profile, tmp_path, monkeypatch, "--json")
    told = json.loads(out)
    tx_hash = sent_hash(stand)
    assert code != 0, err
    assert told["error"]["code"] == "registration_unchecked"
    assert told["error"]["tx_hash"] == tx_hash
    assert f"--tx-hash {tx_hash}" in json.dumps(told["next_steps"])
    assert "secret server words" not in out + err
    assert "Traceback" not in err
