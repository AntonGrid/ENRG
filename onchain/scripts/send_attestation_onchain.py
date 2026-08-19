#!/usr/bin/env python
import os
from dataclasses import dataclass
from datetime import datetime, timezone

from web3 import Web3


def get_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required env var: {name}")
    return value


RPC_URL = os.environ.get("ENRG_RPC_URL", "http://127.0.0.1:8545")
PRIVATE_KEY = get_env("ENRG_PRIVATE_KEY")
CONTRACT_ADDRESS = get_env("ENRG_ORACLE_CONTRACT_ADDRESS")

w3 = Web3(Web3.HTTPProvider(RPC_URL))
account = w3.eth.account.from_key(PRIVATE_KEY)

print(f"Using RPC: {RPC_URL}")
print(f"Using account: {account.address}")
print(f"Contract: {CONTRACT_ADDRESS}")


# --- Inline version of build_attestation_params ---


@dataclass
class OnchainAttestationParams:
    attestation_id: bytes
    device_id: bytes
    allowed: bool
    max_power_w: int
    issued_at: int


def iso_to_unix(ts: str) -> int:
    """Convert ISO8601 (with 'Z') to a unix timestamp (seconds)."""
    # Examples: "2024-01-01T00:00:00Z"
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    dt = datetime.fromisoformat(ts)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def build_attestation_params(attestation: dict) -> OnchainAttestationParams:
    """
    Approximate equivalent of app.onchain_bridge.build_attestation_params:
    - attestation_id, device_id -> keccak(text)
    - max_power_kw -> W (uint64)
    - issued_at (ISO) -> unix timestamp (uint64)
    """
    att_id_text = attestation["attestation_id"]
    dev_id_text = attestation["device_id"]
    decision = attestation["decision"]

    allowed = bool(decision["allowed"])
    max_power_kw = float(decision["max_power_kw"])
    max_power_w = int(max_power_kw * 1000)

    issued_at_raw = attestation["issued_at"]
    issued_at = iso_to_unix(issued_at_raw)

    attestation_id = w3.keccak(text=att_id_text)
    device_id = w3.keccak(text=dev_id_text)

    return OnchainAttestationParams(
        attestation_id=attestation_id,
        device_id=device_id,
        allowed=allowed,
        max_power_w=max_power_w,
        issued_at=issued_at,
    )


# --- Contract ABI ---


CONTRACT_ABI = [
    {
        "type": "constructor",
        "inputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "attestationExists",
        "inputs": [
            {
                "name": "",
                "type": "bytes32",
                "internalType": "bytes32"
            }
        ],
        "outputs": [
            {
                "name": "",
                "type": "bool",
                "internalType": "bool"
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "attestations",
        "inputs": [
            {
                "name": "",
                "type": "bytes32",
                "internalType": "bytes32"
            }
        ],
        "outputs": [
            {
                "name": "attestationId",
                "type": "bytes32",
                "internalType": "bytes32"
            },
            {
                "name": "deviceId",
                "type": "bytes32",
                "internalType": "bytes32"
            },
            {
                "name": "allowed",
                "type": "bool",
                "internalType": "bool"
            },
            {
                "name": "maxPowerW",
                "type": "uint64",
                "internalType": "uint64"
            },
            {
                "name": "oracle",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "issuedAt",
                "type": "uint64",
                "internalType": "uint64"
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [
            {
                "name": "",
                "type": "address",
                "internalType": "address"
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "setTrustedOracle",
        "inputs": [
            {
                "name": "oracle",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "trusted",
                "type": "bool",
                "internalType": "bool"
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "submitAttestation",
        "inputs": [
            {
                "name": "attestationId",
                "type": "bytes32",
                "internalType": "bytes32"
            },
            {
                "name": "deviceId",
                "type": "bytes32",
                "internalType": "bytes32"
            },
            {
                "name": "allowed",
                "type": "bool",
                "internalType": "bool"
            },
            {
                "name": "maxPowerW",
                "type": "uint64",
                "internalType": "uint64"
            },
            {
                "name": "issuedAt",
                "type": "uint64",
                "internalType": "uint64"
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "trustedOracles",
        "inputs": [
            {
                "name": "",
                "type": "address",
                "internalType": "address"
            }
        ],
        "outputs": [
            {
                "name": "",
                "type": "bool",
                "internalType": "bool"
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "event",
        "name": "Attested",
        "inputs": [
            {
                "name": "attestationId",
                "type": "bytes32",
                "indexed": True,
                "internalType": "bytes32"
            },
            {
                "name": "deviceId",
                "type": "bytes32",
                "indexed": True,
                "internalType": "bytes32"
            },
            {
                "name": "allowed",
                "type": "bool",
                "indexed": False,
                "internalType": "bool"
            },
            {
                "name": "maxPowerW",
                "type": "uint64",
                "indexed": False,
                "internalType": "uint64"
            },
            {
                "name": "oracle",
                "type": "address",
                "indexed": True,
                "internalType": "address"
            },
            {
                "name": "issuedAt",
                "type": "uint64",
                "indexed": False,
                "internalType": "uint64"
            }
        ],
        "anonymous": False
    },
    {
        "type": "event",
        "name": "OracleUpdated",
        "inputs": [
            {
                "name": "oracle",
                "type": "address",
                "indexed": True,
                "internalType": "address"
            },
            {
                "name": "trusted",
                "type": "bool",
                "indexed": False,
                "internalType": "bool"
            }
        ],
        "anonymous": False
    },
    {
        "type": "error",
        "name": "AttestationAlreadyExists",
        "inputs": []
    },
    {
        "type": "error",
        "name": "NotOwner",
        "inputs": []
    },
    {
        "type": "error",
        "name": "NotTrustedOracle",
        "inputs": []
    }
]

contract = w3.eth.contract(address=CONTRACT_ADDRESS, abi=CONTRACT_ABI)


def make_example_attestation() -> dict:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    return {
        "attestation_id": "attestation-e2e-1",
        "device_id": "device-e2e-abc",
        "decision": {
            "allowed": True,
            "max_power_kw": 500.0,
        },
        "issued_at": now.isoformat().replace("+00:00", "Z"),
    }


def main():
    attestation = make_example_attestation()
    print("Attestation JSON:")
    print(attestation)

    params = build_attestation_params(attestation)
    print("On-chain params:")
    print(
        f"  attestation_id: {params.attestation_id.hex()}\n"
        f"  device_id:      {params.device_id.hex()}\n"
        f"  allowed:        {params.allowed}\n"
        f"  max_power_w:    {params.max_power_w}\n"
        f"  issued_at:      {params.issued_at}"
    )

    nonce = w3.eth.get_transaction_count(account.address)
    tx = contract.functions.submitAttestation(
        params.attestation_id,
        params.device_id,
        params.allowed,
        params.max_power_w,
        params.issued_at,
    ).build_transaction(
        {
            "from": account.address,
            "nonce": nonce,
            "gas": 500_000,
            "maxFeePerGas": w3.to_wei("2", "gwei"),
            "maxPriorityFeePerGas": w3.to_wei("1", "gwei"),
        }
    )

    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print("Submitted tx:", tx_hash.hex())

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    print("Tx status:", receipt.status)
    print("Gas used:", receipt.gasUsed)

    stored = contract.functions.attestations(params.attestation_id).call()
    print("Stored attestation in contract:")
    print(stored)


if __name__ == "__main__":
    main()
