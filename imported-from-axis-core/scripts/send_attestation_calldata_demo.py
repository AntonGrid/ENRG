import argparse
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

# --- Импортируем on-chain bridge ---

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from axis_core.onchain_bridge import build_attestation_params  # noqa: E402


@dataclass
class SimpleENRGClient:
    """
    Минимальный клиент только для /health и /oracle/attest (новый формат запроса).
    """
    base_url: str = "http://localhost:8000"

    def __post_init__(self) -> None:
        self._client = httpx.Client(base_url=self.base_url, timeout=10.0)

    def health(self) -> Dict[str, Any]:
        resp = self._client.get("/health")
        resp.raise_for_status()
        return resp.json()

    def oracle_attest_request(
        self,
        device_id: str,
        nonce: str,
        max_power_kw: float,
        algo: str = "mock",
        signature: Optional[str] = None,
        timestamp: Optional[str] = None,
    ) -> Dict[str, Any]:
        if timestamp is None:
            now = datetime.now(timezone.utc).replace(microsecond=0)
            timestamp = now.isoformat().replace("+00:00", "Z")

        if signature is None:
            signature = "deadbeef" * 8

        payload: Dict[str, Any] = {
            "device_id": device_id,
            "nonce": nonce,
            "timestamp": timestamp,
            "algo": algo,
            "payload": {"max_power_kw": max_power_kw},
            "signature": signature,
        }

        resp = self._client.post("/oracle/attest", json=payload)
        resp.raise_for_status()
        return resp.json()


def build_full_attestation_from_oracle_response(
    oracle_resp: Dict[str, Any],
    device_id: str,
    max_power_kw: float,
    oracle_id: str = "oracle_main_1",
) -> Dict[str, Any]:
    """
    Строим полную Attestation (schema_version=1.0) из ответа /oracle/attest.
    """
    now = datetime.now(timezone.utc).replace(microsecond=0)
    ts_str = now.isoformat().replace("+00:00", "Z")

    decision = oracle_resp["decision"]

    attestation: Dict[str, Any] = {
        "schema_version": "1.0",
        "attestation_id": oracle_resp["attestation_id"],
        "device_id": device_id,
        "proof": {
            "device_id": device_id,
            "nonce": "demo_nonce_123",
            "timestamp": ts_str,
            "algo": "mock",
            "payload": {
                "max_power_kw": max_power_kw,
            },
            "signature": "deadbeef" * 8,
        },
        "decision": {
            "allowed": bool(decision.get("allowed")),
            "reason": decision.get("reason", "auto-generated-from-oracle-response"),
            "max_power_kw": float(decision.get("max_power_kw", max_power_kw)),
        },
        "oracle_id": oracle_id,
        "issued_at": ts_str,
        "oracle_signature": "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
    }
    return attestation


def encode_submit_attestation_calldata(
    attestation_id: bytes,
    device_id: bytes,
    allowed: bool,
    max_power_w: int,
    issued_at: int,
) -> str:
    """
    Encoder для:
      submitAttestation(bytes32 attestationId, bytes32 deviceId, bool allowed, uint64 maxPowerW, uint64 issuedAt)

    selector уже известен: 0x44b67025
    """
    selector = "44b67025"

    def word_from_bytes32(b: bytes) -> str:
        if len(b) != 32:
            raise ValueError("bytes32 argument must be 32 bytes")
        return b.hex()

    def word_from_bool(v: bool) -> str:
        return ("1" if v else "0").rjust(64, "0")

    def word_from_uint(v: int) -> str:
        if v < 0:
            raise ValueError("uint must be non-negative")
        return hex(v)[2:].rjust(64, "0")

    words = [
        word_from_bytes32(attestation_id),
        word_from_bytes32(device_id),
        word_from_bool(allowed),
        word_from_uint(max_power_w),
        word_from_uint(issued_at),
    ]

    return "0x" + selector + "".join(words)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Demo: call /oracle/attest, build full Attestation (schema 1.0) "
                    "and encode calldata for submitAttestation(...)"
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="Base URL of ENRG backend (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--device-id",
        default="dev_demo_calldata",
        help="Device ID to use in oracle request and attestation.",
    )
    parser.add_argument(
        "--max-power-kw",
        type=float,
        default=3.3,
        help="Requested max power in kW (used in oracle request).",
    )
    parser.add_argument(
        "--nonce",
        default="demo_nonce_123",
        help="Nonce for oracle_attest_request().",
    )
    parser.add_argument(
        "--algo",
        default="mock",
        help="Algo field for oracle_attest_request().",
    )
    parser.add_argument(
        "--contract-address",
        default="<CONTRACT_ADDRESS>",
        help="Optional: contract address to show in cast send example.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    # 1) Health check
    client = SimpleENRGClient(base_url=args.base_url)
    print("=== Step 1: /health ===")
    health = client.health()
    print(health)
    print()

    # 2) Call /oracle/attest (new format)
    print("=== Step 2: POST /oracle/attest (new format) ===")
    oracle_resp = client.oracle_attest_request(
        device_id=args.device_id,
        nonce=args.nonce,
        max_power_kw=args.max_power_kw,
        algo=args.algo,
    )
    print(json.dumps(oracle_resp, indent=2))
    print()

    # 3) Build full Attestation (schema_version=1.0)
    print("=== Step 3: Build full Attestation from oracle response ===")
    attestation = build_full_attestation_from_oracle_response(
        oracle_resp=oracle_resp,
        device_id=args.device_id,
        max_power_kw=args.max_power_kw,
    )
    print(json.dumps(attestation, indent=2))
    print()

    # 4) Build on-chain params via build_attestation_params
    print("=== Step 4: Build on-chain params via build_attestation_params ===")
    params = build_attestation_params(attestation)
    print("On-chain parameters:")
    print(f"  attestationId (bytes32): 0x{params.attestation_id.hex()}")
    print(f"  deviceId      (bytes32): 0x{params.device_id.hex()}")
    print(f"  allowed       (bool)   : {params.allowed}")
    print(f"  maxPowerW     (uint64) : {params.max_power_w}")
    print(f"  issuedAt      (uint64) : {params.issued_at}")
    print()

    # 5) Encode calldata for submitAttestation(...)
    print("=== Step 5: Build calldata for submitAttestation(...) ===")
    calldata = encode_submit_attestation_calldata(
        attestation_id=params.attestation_id,
        device_id=params.device_id,
        allowed=params.allowed,
        max_power_w=params.max_power_w,
        issued_at=params.issued_at,
    )
    print("function selector: 0x44b67025")
    print(f"calldata: {calldata}")
    print()

    # Готовая команда для cast send
    allowed_str = str(params.allowed).lower()
    cast_cmd = (
        f'cast send {args.contract_address} '
        f'"submitAttestation(bytes32,bytes32,bool,uint64,uint64)" '
        f'"0x{params.attestation_id.hex()}" '
        f'"0x{params.device_id.hex()}" '
        f"{allowed_str} "
        f"{params.max_power_w} "
        f"{params.issued_at}"
    )
    print("You can use this calldata with eth_sendRawTransaction or cast send, e.g.:")
    print("  " + cast_cmd)


if __name__ == "__main__":
    main()
