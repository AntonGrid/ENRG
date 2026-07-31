#!/usr/bin/env python
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from eth_abi import encode as abi_encode
from eth_utils import keccak, to_hex

# Add repository root to sys.path to allow imports of app.* and tools.*
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from axis_core.onchain_bridge import build_attestation_params  # noqa: E402
from tools.client import ENRGClient  # noqa: E402


FUNCTION_SIGNATURE = "submitAttestation(bytes32,bytes32,bool,uint64,uint64)"


def build_full_attestation_from_oracle_response(resp: dict) -> dict:
    """
    Convert /oracle/attest response (new format) into a full Attestation
    compatible with attestation.schema.json and onchain_bridge.
    """
    device_id = resp["device_id"]
    attestation_id = resp["attestation_id"]
    decision = resp["decision"]

    now = datetime.now(timezone.utc).replace(microsecond=0)
    issued_at_iso = now.isoformat().replace("+00:00", "Z")

    proof = {
        "device_id": device_id,
        "nonce": resp.get("nonce", "demo_nonce_123"),
        "timestamp": issued_at_iso,
        "algo": "mock",
        "payload": {
            "max_power_kw": decision.get("max_power_kw"),
        },
        "signature": "deadbeef" * 8,
    }

    full_attestation = {
        "schema_version": "1.0",
        "attestation_id": attestation_id,
        "device_id": device_id,
        "proof": proof,
        "decision": {
            "allowed": bool(decision.get("allowed", True)),
            "reason": decision.get(
                "reason",
                "auto-generated-from-oracle-response",
            ),
            "max_power_kw": decision.get("max_power_kw"),
        },
        "oracle_id": resp.get("oracle_id", "oracle_main_1"),
        "issued_at": issued_at_iso,
        "oracle_signature": "cafebabe" * 8,
    }
    return full_attestation


def build_calldata(params) -> str:
    selector = keccak(text=FUNCTION_SIGNATURE)[:4]
    encoded_args = abi_encode(
        [
            "bytes32",  # attestationId
            "bytes32",  # deviceId
            "bool",     # allowed
            "uint64",   # maxPowerW
            "uint64",   # issuedAt
        ],
        [
            params.attestation_id,
            params.device_id,
            params.allowed,
            params.max_power_w,
            params.issued_at,
        ],
    )
    return to_hex(selector + encoded_args)


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Full online demo: /oracle/attest -> Attestation -> "
            "on-chain params -> submitAttestation calldata"
        )
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="(reserved; current ENRGClient uses the base URL from its settings)",
    )
    parser.add_argument(
        "--device-id",
        default="dev_demo_full_cycle",
        help='Device ID to use in /oracle/attest (default: "dev_demo_full_cycle")',
    )
    parser.add_argument(
        "--max-power-kw",
        type=float,
        default=3.3,
        help="Requested max power for oracle attest (kW, default: 3.3)",
    )
    parser.add_argument(
        "--nonce",
        default="nonce_full_cycle_123",
        help="Nonce for oracle attest request (default: nonce_full_cycle_123)",
    )
    args = parser.parse_args()

    # Current ENRGClient implementation does not accept base_url,
    # so we call it without arguments.
    client = ENRGClient()

    print("=== Step 1: /health ===")
    try:
        health = client.health()
        print(json.dumps(health, indent=2))
    except Exception as e:
        print(f"Health check failed: {e}")
        sys.exit(1)

    print("\n=== Step 2: POST /oracle/attest (new format) ===")
    oracle_resp = client.oracle_attest_request(
        device_id=args.device_id,
        nonce=args.nonce,
        max_power_kw=args.max_power_kw,
    )
    print(json.dumps(oracle_resp, indent=2))

    print("\n=== Step 3: Build full Attestation from oracle response ===")
    full_att = build_full_attestation_from_oracle_response(oracle_resp)
    print(json.dumps(full_att, indent=2))

    print("\n=== Step 4: Build on-chain params via build_attestation_params ===")
    params = build_attestation_params(full_att)

    print("On-chain parameters for submitAttestation:")
    print(f"  attestationId (bytes32): 0x{params.attestation_id.hex()}")
    print(f"  deviceId      (bytes32): 0x{params.device_id.hex()}")
    print(f"  allowed       (bool)   : {params.allowed}")
    print(f"  maxPowerW     (uint64) : {params.max_power_w}")
    print(f"  issuedAt      (uint64) : {params.issued_at}")

    print("\n=== Step 5: Build calldata for submitAttestation ===")
    calldata = build_calldata(params)
    print(calldata)
    print(
        "\n(Script does NOT send a transaction. It only prints calldata — "
        "usable in an EOF transaction / CLI tool.)"
    )


if __name__ == "__main__":
    main()
