from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Any

from eth_utils import keccak


@dataclass
class OnchainAttestationParams:
    attestation_id: bytes   # 32 bytes for bytes32
    device_id: bytes        # 32 bytes for bytes32
    allowed: bool
    max_power_w: int        # uint64
    issued_at: int          # unix timestamp (uint64)


def _to_bytes32_hash(value: str) -> bytes:
    """
    keccak256 of UTF-8 string -> 32-byte hash (for bytes32).
    """
    if not isinstance(value, str):
        raise TypeError("value must be a string")
    return keccak(text=value)


def _parse_issued_at(issued_at: str) -> int:
    """
    Converts ISO 8601 with 'Z' suffix to unix timestamp (seconds).
    Example: '2026-07-25T19:05:00Z' -> 1780001100
    """
    if not isinstance(issued_at, str):
        raise TypeError("issued_at must be a string")

    ts = issued_at
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    dt = datetime.fromisoformat(ts)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def build_attestation_params(attestation: Dict[str, Any]) -> OnchainAttestationParams:
    """
    Builds parameters for submitAttestation(...) from JSON Attestation.

    Expects structure:
    {
      "attestation_id": "...",
      "device_id": "...",
      "decision": {
        "allowed": true,
        "max_power_kw": 2.5,
        ...
      },
      "issued_at": "2026-07-25T19:05:00Z",
      ...
    }

    Mapping:
    - attestation_id -> keccak256(attestation_id) (bytes32)
    - device_id      -> keccak256(device_id) (bytes32)
    - allowed        -> decision.allowed (bool)
    - max_power_w    -> int(decision.max_power_kw * 1000)
    - issued_at      -> unix timestamp (int)
    """
    try:
        att_id_str = attestation["attestation_id"]
        dev_id_str = attestation["device_id"]
        decision = attestation["decision"]
        allowed = bool(decision["allowed"])
        max_power_kw = float(decision.get("max_power_kw", 0.0))
        issued_at_str = attestation["issued_at"]
    except KeyError as e:
        raise KeyError(f"Missing required attestation field: {e!s}") from e

    att_id = _to_bytes32_hash(att_id_str)
    dev_id = _to_bytes32_hash(dev_id_str)
    max_power_w = int(max_power_kw * 1000)
    issued_at = _parse_issued_at(issued_at_str)

    return OnchainAttestationParams(
        attestation_id=att_id,
        device_id=dev_id,
        allowed=allowed,
        max_power_w=max_power_w,
        issued_at=issued_at,
    )
