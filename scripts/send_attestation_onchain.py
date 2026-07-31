#!/usr/bin/env python
import argparse
import json
import sys
from pathlib import Path

from eth_abi import encode as abi_encode
from eth_utils import keccak, to_hex

# Add repository root to sys.path to allow imports of app.*
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from axis_core.onchain_bridge import build_attestation_params  # noqa: E402


# Signature must match the contract
FUNCTION_SIGNATURE = "submitAttestation(bytes32,bytes32,bool,uint64,uint64)"


def load_attestation(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"Attestation file not found at {path}")
    with path.open("r", encoding="utf-8") as f:
        att = json.load(f)
    # compatibility with the new schema
    att.setdefault("schema_version", "1.0")
    return att


def build_calldata(params) -> str:
    # 4-byte selector
    selector = keccak(text=FUNCTION_SIGNATURE)[:4]

    # type order must match the signature
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
        description="Build submitAttestation calldata from attestation JSON"
    )
    parser.add_argument(
        "--attestation-file",
        default=str(BASE_DIR / "attestation-example.json"),
        help="Path to attestation JSON (default: attestation-example.json in repo root)",
    )
    args = parser.parse_args()

    att = load_attestation(Path(args.attestation_file))
    params = build_attestation_params(att)

    print("=== On-chain parameters for submitAttestation ===")
    print(f"attestationId (bytes32): 0x{params.attestation_id.hex()}")
    print(f"deviceId      (bytes32): 0x{params.device_id.hex()}")
    print(f"allowed       (bool)   : {params.allowed}")
    print(f"maxPowerW     (uint64) : {params.max_power_w}")
    print(f"issuedAt      (uint64) : {params.issued_at}")

    calldata = build_calldata(params)

    print("\n=== Calldata for submitAttestation ===")
    print(calldata)
    print("\n(Script does NOT send a transaction. It only outputs calldata — usable in an EOF transaction / CLI tool.)")


if __name__ == "__main__":
    main()
