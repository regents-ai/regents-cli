"""A proof bundle Techtree 0.3.0 wrote verifies here, and one changed byte makes it fail.

The costly failures: the ported verifier rejects every proof people already hold, or it
accepts a proof whose receipts or signatures were altered after signing. The fixture was made
by Techtree 0.3.0's own bundle writer (`tests/fixtures/receipts/proof.py`) in a throwaway home;
it carries the public key only.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from regents_cli.techtree.canonical import canonical_json_bytes
from regents_cli.techtree.receipts.verify import verify_local_bundle

PROOF = Path(__file__).parent / "fixtures" / "proof-0.3.0"


def test_a_0_3_0_proof_verifies() -> None:
    result = verify_local_bundle(PROOF)
    assert result.verified, [message.detail for message in result.failures]


def test_one_changed_byte_in_a_receipt_fails_at_the_artifact_and_signature_steps(
    tmp_path: Path,
) -> None:
    bundle = shutil.copytree(PROOF, tmp_path / "proof")
    receipt = bundle / "receipts" / "candidate" / "0001.json"
    raw = bytearray(receipt.read_bytes())
    position = raw.index(b'"task_hash":"sha256:') + len(b'"task_hash":"sha256:')
    raw[position] = ord("0") if raw[position] != ord("0") else ord("1")
    receipt.write_bytes(bytes(raw))
    result = verify_local_bundle(bundle)
    assert not result.verified
    failed = {message.id for message in result.failures}
    assert "artifact.receipts/candidate/0001.json" in failed
    assert "receipts/candidate/0001.json.signature" in failed
    assert "receipt_set.candidate" in failed


def test_one_changed_byte_in_a_signature_fails_at_the_signature_step(tmp_path: Path) -> None:
    bundle = shutil.copytree(PROOF, tmp_path / "proof")
    report = bundle / "uplift-report.json"
    document = json.loads(report.read_bytes())
    signature = document["signature"]["signature"]
    changed = "A" if signature[10] != "A" else "B"
    document["signature"]["signature"] = signature[:10] + changed + signature[11:]
    report.write_bytes(canonical_json_bytes(document))
    result = verify_local_bundle(bundle)
    assert not result.verified
    failed = {message.id for message in result.failures}
    assert "uplift-report.signature" in failed
    assert "p1.report_signed" in failed
