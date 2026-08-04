import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Добавляем корень репозитория в sys.path, чтобы можно было импортировать app.* и tools.*
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from axis_core.onchain_bridge import build_attestation_params  # noqa: E402
from tools.client import ENRGClient  # noqa: E402


def build_full_attestation_from_oracle_response(resp: dict) -> dict:
    """
    Превращает ответ /oracle/attest (новый формат) в полную Attestation,
    совместимую с attestation.schema.json и demo_onchain_bridge.
    """
    device_id = resp["device_id"]
    attestation_id = resp["attestation_id"]
    decision = resp["decision"]

    now = datetime.now(timezone.utc).replace(microsecond=0)
    issued_at = now.isoformat().replace("+00:00", "Z")

    # Имитация исходного запроса (proof) на основе решения
    proof = {
        "device_id": device_id,
        "nonce": "demo_nonce_123",
        "timestamp": issued_at,
        "algo": "mock",
        "payload": {
            "max_power_kw": decision.get("max_power_kw"),
        },
        "signature": "deadbeef" * 8,
    }

    full_attestation = {
        "schema_version": "1.0",  # явно указываем версию схемы
        "attestation_id": attestation_id,
        "device_id": device_id,
        "proof": proof,
        "decision": {
            "allowed": bool(decision.get("allowed", True)),
            "reason": "auto-generated-from-oracle-response",
            "max_power_kw": decision.get("max_power_kw"),
        },
        "oracle_id": "oracle_main_1",
        "issued_at": issued_at,
        "oracle_signature": "cafebabe" * 8,
    }
    return full_attestation


def main():
    client = ENRGClient()

    print("=== Step 1: /health ===")
    print(client.health())

    print("\n=== Step 2: POST /oracle/attest (new format) ===")
    oracle_resp = client.oracle_attest_request(
        device_id="dev_demo_full_cycle",
        nonce="nonce_full_cycle_123",
        max_power_kw=3.3,
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


if __name__ == "__main__":
    main()
