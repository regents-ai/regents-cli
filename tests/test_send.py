"""--send: the agent key signs and sends a site's transactions on Base, in order, each after the
one before it lands. One the chain's state makes certain to fail sends nothing; one that lands
and fails stops the rest; without --send nothing reaches the chain."""

from __future__ import annotations

import contextlib
import io
import json
import os
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest
from eth_account.typed_transactions.typed_transaction import TypedTransaction
from eth_utils.crypto import keccak
from hexbytes import HexBytes
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from regents_cli import app, runner, siwa, transactions
from regents_cli.errors import (
    EXIT_AUTH,
    EXIT_CANCELLED,
    EXIT_FAILED,
    EXIT_UNREACHABLE,
    EXIT_USAGE,
)
from regents_cli.http import Request
from regents_cli.platforms import pinned_platforms

ADDRESS = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
NODE = "https://base-node.test"
REGISTRY = "0x" + "4e" * 20
PRESENCE = ["keyfleet", "presence", "mark", "fleet_tech_classic"]


def step(name: str, data: str = "0xabcdef01", value: str = "0", blocked: str | None = None) -> Any:
    return {
        "name": name,
        "title": name,
        "to": REGISTRY,
        "data": data,
        "value": value,
        "blocked": blocked,
    }


class Base:
    """A Base node: prices, balances, and each sent transaction's receipt. `fault` may answer a
    call in its own way (or drop the connection) instead."""

    def __init__(
        self,
        nonce: int = 7,
        balance: int = 10**18,
        statuses: list[str] | None = None,
        chain_id: int = 8453,
        fault: Callable[[str, list[Any]], httpx.Response | None] = lambda *_: None,
    ):
        self.nonce, self.balance, self.chain_id, self.fault = nonce, balance, chain_id, fault
        self.statuses = list(statuses or [])
        self.calls: list[tuple[str, list[Any]]] = []
        self.raw: list[str] = []

    def post(self, url: str, *, json: dict[str, Any], **_: Any) -> httpx.Response:
        assert url == os.environ["SIWA_BASE_RPC"]
        method, params = json["method"], json["params"]
        self.calls.append((method, params))
        if method == "eth_sendRawTransaction":
            self.raw.append(params[0])
        faulty = self.fault(method, params)
        if faulty is not None:
            return faulty
        landed = method == "eth_getTransactionReceipt" and self.statuses
        receipt = {"status": self.statuses.pop(0)} if landed else None
        answers = {
            "eth_estimateGas": hex(50_000),
            "eth_maxPriorityFeePerGas": hex(10**6),
            "eth_getBlockByNumber": {"baseFeePerGas": hex(10**7)},
            "eth_getTransactionCount": hex(self.nonce),
            "eth_getBalance": hex(self.balance),
            "eth_call": f"0x{10**9:064x}",
            "eth_sendRawTransaction": "0x" + "00" * 32,
            "eth_getTransactionReceipt": receipt,
            "eth_chainId": hex(self.chain_id),
        }
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": answers[method]})

    def sent(self) -> list[dict[str, Any]]:
        return [dict(TypedTransaction.from_bytes(HexBytes(raw)).as_dict()) for raw in self.raw]


@pytest.fixture
def site(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """An agent home signed in to Keyfleet, whose presence and vote commands send, and the
    answer Keyfleet gives (change `answer` to change it)."""
    home = tmp_path / "agent"
    (home / "receipts").mkdir(parents=True, mode=0o700)
    home.chmod(0o700)
    files = {
        "key.json": {"address": ADDRESS, "private_key": "0x" + "00" * 31 + "01"},
        "receipts/keyfleet.json": {
            "address": ADDRESS,
            "audience": "keyfleet",
            "receipt": "fixed-receipt",
            "receipt_expires_at": "2999-01-01T00:00:00Z",
            "key_id": ADDRESS,
        },
    }
    for name, content in files.items():
        (home / name).write_text(json.dumps(content), "utf-8")
        (home / name).chmod(0o600)
    monkeypatch.setenv("SIWA_AGENT_HOME", str(home))
    monkeypatch.setenv("SIWA_BASE_RPC", NODE)
    monkeypatch.delenv("SIWA_BROKER", raising=False)
    monkeypatch.delenv("KEYFLEET_BASE_URL", raising=False)
    audiences = [{"audience": "keyfleet", "origin": "https://keyfleet.ai"}]
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, **_: httpx.Response(
            200, json={"code": "audiences", "data": {"audiences": audiences}}
        ),
    )
    state: dict[str, Any] = {
        "answer": {"chain_id": 8453, "says": None, "transactions": [step("present")], "keys": []},
        "requests": [],
    }

    def respond(base: str, request: Request, timeout_ms: int) -> httpx.Response:
        state["requests"].append(request)
        return httpx.Response(200, json=state["answer"])

    monkeypatch.setattr(runner, "respond", respond)
    sending = {
        ("presence", "mark", "<fleet>"),
        ("proposals", "vote", "<fleet>", "<number>", "<choice>"),
    }
    platforms = [
        replace(p, commands=tuple(replace(c, sends=c.words in sending) for c in p.commands))
        if p.name == "keyfleet"
        else p
        for p in pinned_platforms()
    ]
    monkeypatch.setattr(app, "pinned_platforms", lambda: platforms)
    monkeypatch.setattr(transactions, "LANDING_POLL_SECONDS", 0)
    return state


def regents(node: Base, monkeypatch: pytest.MonkeyPatch, *argv: str) -> tuple[int, Any, str]:
    monkeypatch.setattr(httpx, "post", node.post)
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = app.main([*argv, "--json"])
    return code, json.loads(out.getvalue()), err.getvalue()


@settings(
    deadline=None, max_examples=25, suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(
    sent=st.lists(
        st.tuples(
            st.binary(max_size=40).map(lambda b: "0x" + b.hex()),
            st.integers(0, 10**15).map(str),
        ),
        min_size=1,
        max_size=3,
    ),
    nonce=st.integers(0, 2**32),
)
def test_each_transaction_is_signed_as_the_site_built_it_with_nonces_in_order(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch, sent: list[tuple[str, str]], nonce: int
) -> None:
    built = [step(f"step-{i}", data, value) for i, (data, value) in enumerate(sent)]
    site["answer"] = {**site["answer"], "transactions": built}
    node = Base(nonce=nonce, statuses=["0x1"] * len(built))
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == 0
    assert [t["landed"] for t in answer["sent"]] == ["succeeded"] * len(built)
    signed = node.sent()
    assert [s["nonce"] for s in signed] == [nonce + i for i in range(len(built))]
    for transaction, (data, value) in zip(signed, sent, strict=True):
        assert transaction["to"].hex() == REGISTRY[2:]
        assert "0x" + transaction["data"].hex() == data
        assert transaction["value"] == int(value)
        assert transaction["chainId"] == 8453
    counts = [params[1] for method, params in node.calls if method == "eth_getTransactionCount"]
    assert counts == ["latest"]
    # Each is sent only after the one before it has landed.
    order = [
        method
        for method, _ in node.calls
        if method in ("eth_sendRawTransaction", "eth_getTransactionReceipt")
    ]
    assert order == ["eth_sendRawTransaction", "eth_getTransactionReceipt"] * len(built)


def test_a_step_certain_to_fail_sends_nothing(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    site["answer"] = {**site["answer"], "transactions": [step("present", blocked="No Keys to use")]}
    node = Base()
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == 0
    assert node.raw == []
    assert "No Keys to use" in answer["next_steps"][0]["say"]


def test_one_that_lands_and_fails_stops_the_rest(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    site["answer"] = {**site["answer"], "transactions": [step("sweep"), step("propose")]}
    node = Base(statuses=["0x0"])
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == EXIT_FAILED
    assert answer["error"]["code"] == "transaction_failed"
    assert [t["landed"] for t in answer["error"]["sent"]] == ["failed"]
    assert len(node.raw) == 1


def test_one_that_never_lands_stops_the_rest(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(transactions, "LANDING_WAIT_SECONDS", 0)
    site["answer"] = {**site["answer"], "transactions": [step("sweep"), step("propose")]}
    node = Base()
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == EXIT_UNREACHABLE
    assert answer["error"]["code"] == "transaction_not_landed"
    assert answer["next_steps"][0]["url"].startswith(transactions.EXPLORER)
    assert len(node.raw) == 1


def test_too_little_eth_signs_nothing_and_says_how_much(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    node = Base(balance=0)
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == EXIT_FAILED
    assert answer["error"]["code"] == "base_needs_eth"
    assert ADDRESS in answer["next_steps"][0]["say"]
    assert node.raw == []


def test_without_send_nothing_reaches_the_chain(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    node = Base()
    code, answer, _ = regents(node, monkeypatch, *PRESENCE)
    assert code == 0
    assert node.calls == []
    assert answer["next_steps"][0]["kind"] == "wallet"


def test_send_is_offered_only_where_the_site_says_it_sends(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    code, answer, _ = regents(Base(), monkeypatch, "keyfleet", "keys", "buy", "x", "--send")
    assert code == EXIT_USAGE
    assert "--send" in answer["error"]["message"]


def test_send_with_a_phase_is_refused(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    code, answer, _ = regents(Base(), monkeypatch, *PRESENCE, "--send", "--phase", "prepare")
    assert code == EXIT_USAGE
    assert "--phase" in answer["error"]["message"]
    assert site["requests"] == []


def test_a_key_that_signs_only_messages_sends_nothing(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(siwa, "sign", lambda *_: {})
    monkeypatch.setattr(siwa, "load_key", lambda: siwa.Key(address=ADDRESS, signer="sign-somehow"))
    node = Base()
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == EXIT_AUTH
    assert answer["error"]["code"] == "signer_cannot_send"
    assert node.raw == []


def refused(*_: Any) -> httpx.Response:
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "error": {"code": -32000}})


def dropped(method: str, _: list[Any]) -> httpx.Response | None:
    if method == "eth_sendRawTransaction":
        raise httpx.RemoteProtocolError("Server disconnected without sending a response.")
    return None


def assert_look_up_first(answer: dict[str, Any], sent: int) -> None:
    """Stopped after `sent` were handed to the node: each listed with its hash as not confirmed,
    and the one step is to look the last up, never to run it again."""
    assert answer["error"]["code"] == "transaction_not_landed"
    listed = answer["error"]["sent"]
    assert len(listed) == sent and all(t["tx_hash"].startswith("0x") for t in listed)
    assert listed[-1]["landed"] == "not yet"
    assert [s["kind"] for s in answer["next_steps"]] == ["human"]
    assert answer["next_steps"][0]["url"] == transactions.EXPLORER + listed[-1]["tx_hash"]


def test_a_send_the_node_drops_is_looked_up_never_sent_again(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(transactions, "LANDING_WAIT_SECONDS", 0)
    site["answer"] = {**site["answer"], "transactions": [step("approve"), step("stake")]}
    node = Base(fault=dropped)
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == EXIT_UNREACHABLE
    assert_look_up_first(answer, sent=1)
    assert len(node.raw) == 1


@pytest.mark.parametrize(
    "receipt",
    [
        refused,
        lambda *_: httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {"status": 1}}),
    ],
    ids=["refused", "unreadable"],
)
def test_a_receipt_that_cannot_be_read_after_a_send_is_looked_up_never_sent_again(
    site: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    receipt: Callable[..., httpx.Response],
) -> None:
    monkeypatch.setattr(transactions, "LANDING_WAIT_SECONDS", 0)
    site["answer"] = {**site["answer"], "transactions": [step("approve"), step("stake")]}
    node = Base(
        fault=lambda method, params: receipt() if method == "eth_getTransactionReceipt" else None
    )
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == EXIT_UNREACHABLE
    assert_look_up_first(answer, sent=1)
    assert len(node.raw) == 1


def test_too_little_eth_for_all_of_them_sends_none(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    # The stake cannot be priced until the approve lands, but its value is known now.
    site["answer"] = {
        **site["answer"],
        "transactions": [step("approve"), step("stake", data="0xdead", value=str(10**18))],
    }
    node = Base(
        balance=10**17,
        statuses=["0x1", "0x1"],
        fault=lambda method, params: (
            refused() if method == "eth_estimateGas" and params[0]["data"] == "0xdead" else None
        ),
    )
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == EXIT_FAILED
    assert answer["error"]["code"] == "base_needs_eth"
    assert node.raw == []


def test_a_credentialed_node_address_is_never_printed(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(transactions, "LANDING_WAIT_SECONDS", 0)
    monkeypatch.setenv("SIWA_BASE_RPC", "https://zq7user:hunter2@base-node.test/v2/KEY123?k=TOKEN9")

    def unreachable(*_: Any) -> httpx.Response:
        raise httpx.ConnectError("refused")

    for fault in (unreachable, refused, dropped):
        out, err = io.StringIO(), io.StringIO()
        monkeypatch.setattr(httpx, "post", Base(fault=fault).post)
        for flags in (["--json"], []):
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                app.main([*PRESENCE, "--send", *flags])
        printed = out.getvalue() + err.getvalue()
        for secret in ("zq7user", "hunter2", "KEY123", "TOKEN9"):
            assert secret not in printed


def test_a_node_on_another_chain_sends_nothing(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    node = Base(chain_id=1, statuses=["0x1"])
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == EXIT_FAILED
    assert answer["error"]["code"] == "base_wrong_chain"
    assert node.raw == []


def interrupted(on: str) -> Callable[[str, list[Any]], httpx.Response | None]:
    def fault(method: str, _: list[Any]) -> httpx.Response | None:
        if method == on:
            raise KeyboardInterrupt
        return None

    return fault


@pytest.mark.parametrize("on", ["eth_sendRawTransaction", "eth_getTransactionReceipt"])
def test_an_interrupt_once_one_is_signed_keeps_its_hash_and_never_offers_a_rerun(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch, on: str
) -> None:
    site["answer"] = {**site["answer"], "transactions": [step("approve"), step("stake")]}
    node = Base(fault=interrupted(on))
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == EXIT_CANCELLED
    assert_look_up_first(answer, sent=1)
    assert len(node.raw) == 1


def test_a_node_failure_after_one_landed_builds_the_rest_afresh_and_blames_no_site(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    site["answer"] = {**site["answer"], "transactions": [step("approve"), step("stake")]}

    def fault(method: str, _: list[Any]) -> httpx.Response | None:
        if node.raw and method == "eth_estimateGas":
            raise httpx.ConnectError("refused")
        return None

    node = Base(statuses=["0x1"], fault=fault)
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == EXIT_UNREACHABLE
    assert [t["landed"] for t in answer["error"]["sent"]] == ["succeeded"]
    kinds = [s["kind"] for s in answer["next_steps"]]
    assert "patchbay" not in kinds and kinds[-1] == "run"
    assert "--send" in answer["next_steps"][-1]["command"]


@pytest.mark.parametrize(
    "answer_to_send",
    [
        lambda: httpx.Response(504, json={"jsonrpc": "2.0", "id": 1, "error": {"code": -32000}}),
        lambda: httpx.Response(
            200, json={"jsonrpc": "2.0", "id": 1, "error": {"code": -32000, "message": "known"}}
        ),
    ],
    ids=["gateway-504", "already-known"],
)
def test_a_send_the_node_refuses_is_looked_up_by_its_receipt(
    site: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    answer_to_send: Callable[[], httpx.Response],
) -> None:
    site["answer"] = {**site["answer"], "transactions": [step("approve"), step("stake")]}
    node = Base(
        statuses=["0x1", "0x1"],
        fault=lambda method, _: answer_to_send() if method == "eth_sendRawTransaction" else None,
    )
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == 0
    assert [t["landed"] for t in answer["sent"]] == ["succeeded", "succeeded"]


def test_transactions_under_data_are_sent(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    site["answer"] = {"data": {"chain_id": 8453, "transactions": [step("present")]}}
    node = Base(statuses=["0x1"])
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == 0
    assert [t["landed"] for t in answer["sent"]] == ["succeeded"]


def test_one_the_chain_would_refuse_is_built_afresh_not_sent_to_another_node(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    node = Base(fault=lambda method, _: refused() if method == "eth_estimateGas" else None)
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == EXIT_FAILED
    assert node.raw == []
    assert [s["kind"] for s in answer["next_steps"]] == ["run"]
    assert "--send" in answer["next_steps"][0]["command"]


@pytest.mark.parametrize(
    "address",
    [
        "https://zq7user:hunter2@base-node.test/v2/KEY123\x7f",
        "https://zq7user:hunter2@base-node.test:abc/v2/KEY123",
        "https://zq7user:hunter2@[::zz]/v2/KEY123",
    ],
    ids=["control character", "port", "ipv6 host"],
)
def test_a_node_address_regents_cannot_call_names_the_setting_and_nothing_else(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch, address: str
) -> None:
    monkeypatch.setenv("SIWA_BASE_RPC", address)
    # httpx reads the address as it sends; reading it alone keeps this test off the network.
    monkeypatch.setattr(httpx, "post", lambda url, **_: httpx.URL(url))
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = app.main([*PRESENCE, "--send", "--json"])
    answer = json.loads(out.getvalue())
    assert code == EXIT_FAILED
    assert [s["kind"] for s in answer["next_steps"]] == ["human"]
    for secret in ("zq7user", "hunter2", "KEY123"):
        assert secret not in out.getvalue() + err.getvalue()


def test_a_value_over_the_balance_names_the_eth_to_send_before_any_estimate(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    # Like a real node, the gas estimate refuses a value the wallet cannot cover.
    site["answer"] = {**site["answer"], "transactions": [step("stake", value=str(10**18))]}
    node = Base(
        balance=10**17, fault=lambda method, _: refused() if method == "eth_estimateGas" else None
    )
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert (code, answer["error"]["code"]) == (EXIT_FAILED, "base_needs_eth")
    assert ADDRESS in answer["next_steps"][0]["say"]
    assert node.raw == []


def test_a_failure_after_one_landed_keeps_what_a_person_must_do_first(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    site["answer"] = {**site["answer"], "transactions": [step("approve"), step("stake")]}
    sign = siwa.sign_transaction
    monkeypatch.setattr(
        siwa,
        "sign_transaction",
        lambda key, tx: sign(key, tx if tx["nonce"] == hex(7) else {**tx, "value": "0x1"}),
    )
    node = Base(statuses=["0x1"])
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert (code, answer["error"]["code"]) == (EXIT_AUTH, "signed_transaction_differs")
    assert [s["kind"] for s in answer["next_steps"]] == ["human", "run"]
    assert len(node.raw) == 1


def test_an_interrupt_after_the_receipt_wait_still_keeps_the_hash(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(transactions, "LANDING_WAIT_SECONDS", 0)
    record = transactions.record
    calls: list[int] = []

    def interrupted_once(*args: Any) -> dict[str, Any]:
        calls.append(1)
        if len(calls) == 1:
            raise KeyboardInterrupt
        return record(*args)

    monkeypatch.setattr(transactions, "record", interrupted_once)
    site["answer"] = {**site["answer"], "transactions": [step("approve"), step("stake")]}
    node = Base()
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == EXIT_CANCELLED
    assert_look_up_first(answer, sent=1)


def test_the_hash_is_on_screen_before_the_node_is_handed_it(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    err = io.StringIO()
    seen: list[bool] = []

    def look(method: str, params: list[Any]) -> None:
        if method == "eth_sendRawTransaction":
            seen.append("0x" + keccak(hexstr=params[0]).hex() in err.getvalue())

    node = Base(statuses=["0x1"], fault=look)
    monkeypatch.setattr(httpx, "post", node.post)
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
        assert app.main([*PRESENCE, "--send", "--json"]) == 0
    assert seen == [True]


def test_a_blocked_reason_of_only_spaces_blocks_nothing(
    site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    site["answer"] = {**site["answer"], "transactions": [step("present", blocked="  ")]}
    node = Base(statuses=["0x1"])
    code, _, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert code == 0
    assert len(node.raw) == 1


def test_no_agent_key_sends_nothing(site: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(siwa, "sign", lambda *_: {})
    monkeypatch.setattr(siwa, "load_key", lambda: None)
    node = Base()
    code, answer, _ = regents(node, monkeypatch, *PRESENCE, "--send")
    assert (code, answer["error"]["code"]) == (EXIT_AUTH, "no_agent_key")
    assert node.raw == []
