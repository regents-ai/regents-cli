"""Content-addressed append-only receipt files."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from verify_runtime.model import EvaluationReceipt, canonical_json_bytes, sha256_bytes, strict_json_loads


def _receipt_directory(state_dir: Path) -> Path:
    return state_dir / "verify" / "receipts" / "sha256"


def emit_receipt(state_dir: Path, receipt: EvaluationReceipt) -> dict[str, Any]:
    validated_receipt = EvaluationReceipt.from_dict(receipt.to_dict())
    receipt_bytes = canonical_json_bytes(validated_receipt.to_dict())
    digest = sha256_bytes(receipt_bytes)
    directory = _receipt_directory(state_dir)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{digest}.json"
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        if path.read_bytes() != receipt_bytes:
            raise RuntimeError(f"immutable receipt collision for {digest}")
    else:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(receipt_bytes)
    return {"digest": digest, "algorithm": "sha256", "path": str(path)}


def show_receipt(state_dir: Path, digest: str) -> dict[str, Any]:
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise ValueError("receipt digest must be 64 lowercase hexadecimal characters")
    path = _receipt_directory(state_dir) / f"{digest}.json"
    if not path.is_file():
        raise FileNotFoundError(f"receipt not found: {digest}")
    receipt_bytes = path.read_bytes()
    observed_digest = sha256_bytes(receipt_bytes)
    if observed_digest != digest:
        raise ValueError(f"receipt digest mismatch: expected {digest}, observed {observed_digest}")
    receipt = EvaluationReceipt.from_dict(strict_json_loads(receipt_bytes))
    return {"schema_version": 1, "digest": digest, "algorithm": "sha256", "verified": True, "receipt": receipt.to_dict()}
