import json
import sys
from pathlib import Path

# Добавляем корень репозитория в sys.path, чтобы можно было импортировать app.*
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from axis_core.onchain_bridge import build_attestation_params  # noqa: E402


def main():
    att_path = BASE_DIR / "attestation-example.json"

    if not att_path.exists():
        raise FileNotFoundError(f"attestation-example.json not found at {att_path}")

    with att_path.open("r", encoding="utf-8") as f:
        att = json.load(f)

    # Обеспечиваем наличие schema_version для совместимости с новой схемой
    att.setdefault("schema_version", "1.0")

    params = build_attestation_params(att)

    print("=== On-chain parameters for submitAttestation ===")
    print(f"attestationId (bytes32): 0x{params.attestation_id.hex()}")
    print(f"deviceId      (bytes32): 0x{params.device_id.hex()}")
    print(f"allowed       (bool)   : {params.allowed}")
    print(f"maxPowerW     (uint64) : {params.max_power_w}")
    print(f"issuedAt      (uint64) : {params.issued_at}")


if __name__ == "__main__":
    main()
