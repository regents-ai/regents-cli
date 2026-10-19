"""`regents auth register`, run whole against a stand-in sign-in server and a stand-in Base node:
- regents builds the registration itself, the same transaction the live sign-in server builds;
- a registration the server alters in any way is refused before anything is signed or sent;
- with the agent key, what regents shows before signing is exactly what it signs and sends, once;
- a wallet without enough ETH for the most the transaction can cost is told the exact amount,
  and nothing is signed;
- a node's refusal and a server answer regents cannot read end in regents's own words.
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
from hexbytes import HexBytes
from hypothesis import given, settings
from hypothesis import strategies as st

from regents_cli import app, base, siwa

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

    def post(self, url: str, *, json: dict[str, Any], **_: Any) -> httpx.Response:
        if url == f"{SIGN_IN}/api/shared/siwa/agent/register-step":
            return httpx.Response(200, json={"code": "registration_step", "data": self.step})
        if url == f"{SIGN_IN}/api/shared/siwa/agent/registered":
            return httpx.Response(200, json=self.outcome)
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
            "eth_sendRawTransaction": "0x" + "00" * 32,
        }
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
        **prices,
    }


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
    assert json.loads(out)["error"]["code"] == "registration_step_differs"
    assert stand.node == []
    assert "Traceback" not in err


@given(
    profile=PROFILES,
    gas=st.integers(21_000, 10**7),
    tip=WEI,
    base_fee=WEI,
    nonce=st.integers(0, 2**32),
)
@settings(deadline=None, max_examples=40)
def test_what_regents_shows_before_signing_is_what_it_signs_and_sends(
    profile: dict[str, str], gas: int, tip: int, base_fee: int, nonce: int
) -> None:
    prices = plenty(gas=gas, tip=tip, base_fee=base_fee, nonce=nonce, balance=10**30)
    stand = Stand(built(profile), prices)
    with tempfile.TemporaryDirectory() as folder, pytest.MonkeyPatch.context() as monkeypatch:
        code, out, err = register(stand, profile, Path(folder), monkeypatch, "--json")
    assert code == 0, err
    [shown] = [json.loads(line)["signing"] for line in err.splitlines() if '"signing"' in line]
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
    step = built(profile)
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
        f"Amount: 0 ETH. Gas: at most 0.00000252 ETH, paid by {ADDRESS}.",
        *(f"{field}: {value}" for field, value in shown_by_json(profile).items()),
    ):
        assert re.sub(r"\s", "", said) in flat
    assert flat.index("Review") < flat.index("agentid") < flat.index("Next")


def shown_by_json(profile: dict[str, str]) -> dict[str, str]:
    """The transaction `register --json` shows before signing, against the same stand-ins."""
    stand = Stand(built(profile), plenty())
    with tempfile.TemporaryDirectory() as folder, pytest.MonkeyPatch.context() as monkeypatch:
        _code, _out, err = register(stand, profile, Path(folder), monkeypatch, "--json")
    shown: dict[str, str] = json.loads(err)["signing"]
    return shown


@given(shortfall=st.integers(1, 10**15))
@settings(deadline=None, max_examples=30)
def test_a_wallet_short_of_eth_is_told_exactly_how_much_and_nothing_is_signed(
    shortfall: int,
) -> None:
    profile = {"name": "Probe", "description": "A test agent."}
    prices = plenty()
    needs = (prices["gas"] * 6 // 5) * (prices["base_fee"] * 2 + prices["tip"])
    stand = Stand(built(profile), {**prices, "balance": max(needs - shortfall, 0)})
    with tempfile.TemporaryDirectory() as folder, pytest.MonkeyPatch.context() as monkeypatch:
        code, out, _ = register(stand, profile, Path(folder), monkeypatch, "--json")
    told = json.loads(out)
    assert (code, told["error"]["code"]) == (1, "base_needs_eth")
    assert f"can take up to {base.eth(needs)} ETH" in told["error"]["message"]
    holds = max(needs - shortfall, 0)
    assert f"at least {base.eth(needs - holds)} ETH" in json.dumps(told["next_steps"])
    assert stand.sent() == []


@pytest.mark.parametrize("method", ["eth_estimateGas", "eth_sendRawTransaction", "eth_getBalance"])
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


@pytest.mark.parametrize(
    "outcome",
    [
        {"code": "something_else"},
        {"code": "agent_registered"},
        {"code": "agent_registered", "data": {}},
    ],
    ids=["unknown code", "no listing", "empty listing"],
)
def test_an_unreadable_registration_answer_is_told_in_regents_words(
    outcome: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    profile = {"name": "Probe", "description": "A test agent."}
    stand = Stand(built(profile), plenty(), outcome)
    code, out, err = register(stand, profile, tmp_path, monkeypatch, "--json")
    assert code == 1, err
    assert json.loads(out)["error"]["code"] == "registration_answer_unreadable"
    assert "Traceback" not in err
