"""ENRG Python client (reference SDK).

Same two halves as `sdk/js/enrg-client.js`:

1. the **wire format** — the exact bytes a device signs and an oracle hashes
   (little-endian u64s). Pinned by `sdk/vectors/wire_format.json`, which is
   generated from `policy.js` (the mirror the conformance suite validates
   against the Rust engine) and asserted by both language suites, so a Python
   client cannot drift from the chain.
2. a thin **HTTP client** for the live oracle API (`server.js`).

Only the standard library plus PyNaCl (already in `requirements.txt`) is used —
so this file is safe to copy into a device- or partner-side codebase.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional

from nacl.signing import SigningKey, VerifyKey

B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
U64_MAX = 0xFFFFFFFFFFFFFFFF


def b58decode(value: str) -> bytes:
    """Decode a base58 string (device ids and public keys travel as base58)."""
    num = 0
    for ch in value:
        idx = B58_ALPHABET.find(ch)
        if idx == -1:
            raise ValueError(f"invalid base58 character: {ch}")
        num = num * 58 + idx
    raw = num.to_bytes((num.bit_length() + 7) // 8, "big") if num else b""
    leading = len(value) - len(value.lstrip("1"))
    return b"\x00" * leading + raw


def b58encode(data: bytes) -> str:
    """Encode bytes as base58 (for deriving a device id from a public key)."""
    num = int.from_bytes(data, "big")
    out = ""
    while num > 0:
        num, rem = divmod(num, 58)
        out = B58_ALPHABET[rem] + out
    return "1" * (len(data) - len(data.lstrip(b"\x00"))) + out


def le8(value: int) -> bytes:
    """Little-endian u64, exactly as the on-chain program reads it.

    Python integers are arbitrary precision, so there is no
    ``Number.MAX_SAFE_INTEGER`` trap here — but the range is still checked so a
    mistake fails loudly instead of producing a different proof hash.
    """
    value = int(value)
    if value < 0 or value > U64_MAX:
        raise ValueError(f"u64 out of range: {value}")
    return value.to_bytes(8, "little")


def _to32(value: Any) -> bytes:
    raw = value if isinstance(value, (bytes, bytearray)) else b58decode(str(value))
    if len(raw) != 32:
        raise ValueError(f"expected 32 bytes, got {len(raw)}")
    return bytes(raw)


def device_message_to_sign(device_id: Any, nonce: int, device_timestamp: int, energy_wh: int) -> bytes:
    """device_id(32) ‖ nonce(8 LE) ‖ device_timestamp(8 LE) ‖ energy_wh(8 LE)"""
    return _to32(device_id) + le8(nonce) + le8(device_timestamp) + le8(energy_wh)


def oracle_message_to_sign(
    device_id: Any, nonce: int, device_timestamp: int, verified_at: int, energy_wh: int
) -> bytes:
    """device_id(32) ‖ nonce(8 LE) ‖ device_timestamp(8 LE) ‖ verified_at(8 LE) ‖ energy_wh(8 LE)"""
    return (
        _to32(device_id)
        + le8(nonce)
        + le8(device_timestamp)
        + le8(verified_at)
        + le8(energy_wh)
    )


def proof_hash(oracle_message: bytes) -> bytes:
    """SHA-256(oracle_message_to_sign) — the hash oracles vote on."""
    return hashlib.sha256(oracle_message).digest()


def attest_message(device_id: Any, nonce: int, proof: bytes) -> bytes:
    """b"enrg:oracle:attest" ‖ device_id(32) ‖ nonce(8 LE) ‖ proof_hash(32)"""
    if len(proof) != 32:
        raise ValueError("proof_hash must be 32 bytes")
    return b"enrg:oracle:attest" + _to32(device_id) + le8(nonce) + proof


def build_device_proof(
    seed: bytes, nonce: int, device_timestamp: int, energy_wh: int
) -> Dict[str, Any]:
    """Build a device-signed proof payload ready for ``POST /api/v1/proof/submit``."""
    signing_key = SigningKey(seed)
    device_id = bytes(signing_key.verify_key)
    message = device_message_to_sign(device_id, nonce, device_timestamp, energy_wh)
    signature = signing_key.sign(message).signature
    return {
        "device_id": b58encode(device_id),
        "nonce": int(nonce),
        "device_timestamp": int(device_timestamp),
        "energy_wh": int(energy_wh),
        "device_signature": list(signature),
    }


def verify_device_proof(proof: Dict[str, Any], public_key: Optional[Any] = None) -> bool:
    """Verify a device signature the way the oracle and the chain do."""
    try:
        device_id = _to32(public_key) if public_key is not None else b58decode(proof["device_id"])
        message = device_message_to_sign(
            device_id, proof["nonce"], proof["device_timestamp"], proof["energy_wh"]
        )
        VerifyKey(device_id).verify(message, bytes(proof["device_signature"]))
        return True
    except Exception:
        return False


class EnrgApiError(Exception):
    """Non-2xx response: carries the HTTP status and the parsed body."""

    def __init__(self, status: int, body: Any, path: str):
        detail = ""
        if isinstance(body, dict):
            detail = body.get("error") or body.get("reason") or ""
        super().__init__(f"{path} → HTTP {status}" + (f": {detail}" if detail else ""))
        self.status = status
        self.body = body
        self.path = path


@dataclass
class EnrgClient:
    """Client for the live oracle API (``server.js``).

    ``base_url`` defaults to the devnet deployment. It is a free instance, so the
    first call after an idle period can answer 503 while it wakes up — ``retries``
    (default 2) handles that transparently.
    """

    base_url: str = "https://enrg-oracle.onrender.com"
    timeout: float = 20.0
    retries: int = 2

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")

    def request(self, path: str, method: str = "GET", body: Optional[dict] = None) -> Any:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"content-type": "application/json"} if data else {}
        last_error: Optional[Exception] = None

        for attempt in range(self.retries + 1):
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read().decode("utf-8")
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as e:
                raw = e.read().decode("utf-8")
                try:
                    parsed = json.loads(raw) if raw else None
                except ValueError:
                    parsed = {"raw": raw}
                if e.code == 503 and attempt < self.retries:
                    last_error = EnrgApiError(e.code, parsed, path)
                    time.sleep(1.5 * (attempt + 1))
                    continue
                raise EnrgApiError(e.code, parsed, path) from None
            except (urllib.error.URLError, TimeoutError) as e:  # network/timeout
                last_error = e
                if attempt < self.retries:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                raise
        raise last_error  # pragma: no cover - loop always returns or raises

    # ── public endpoints ────────────────────────────────────────────────────
    def health(self) -> Any:
        return self.request("/health")

    def stats(self) -> Any:
        """Protocol metrics (proofs, minted, energy, producers)."""
        return self.request("/api/v1/stats")

    def oracles(self) -> Any:
        """On-chain trusted set + per-oracle attribution."""
        return self.request("/api/v1/oracles")

    def proofs(self, device_id: Optional[str] = None, limit: Optional[int] = None) -> Any:
        params = []
        if device_id:
            params.append(f"device_id={urllib.parse.quote(device_id)}")
        if limit:
            params.append(f"limit={int(limit)}")
        return self.request("/api/v1/proofs" + (f"?{'&'.join(params)}" if params else ""))

    def device_status(self, device_id: str) -> Any:
        return self.request(f"/api/v1/device/{urllib.parse.quote(device_id)}/status")

    def device_balance(self, device_id: str) -> Any:
        """SRC balance of the device owner, read from its on-chain token account."""
        return self.request(f"/api/v1/device/{urllib.parse.quote(device_id)}/balance")

    def device_history(self, device_id: str, limit: Optional[int] = None) -> Any:
        qs = f"?limit={int(limit)}" if limit else ""
        return self.request(f"/api/v1/device/{urllib.parse.quote(device_id)}/history{qs}")

    def submit_proof(self, proof: Dict[str, Any]) -> Any:
        """Submit a signed proof (see :func:`build_device_proof`)."""
        return self.request("/api/v1/proof/submit", method="POST", body=proof)

    def manifest(self, device_id: str) -> Any:
        """Founder-signed device manifest (ADR-0004)."""
        return self.request(f"/api/v1/manifest/{urllib.parse.quote(device_id)}")

    def firmware_latest(self) -> Any:
        """Latest signed firmware metadata (ADR-0008)."""
        return self.request("/api/v1/firmware/latest")
