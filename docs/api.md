# ENRG API

## Basic information

- Base URL (local): `http://localhost:8000`
- Liveness check: `GET /health` → `{"status": "ok"}`

---

## 1. Oracle

### 1.1. POST `/oracle/attest`

The endpoint works in two modes.

#### Mode A: Full Attestation (legacy)

Used by old clients and in `tests/test_api.py`.

**Request (example):**

```json
{
  "attestation_id": "att_123",
  "device_id": "dev_9e9c644e1580a83b",
  "proof": {},
  "decision": { "allowed": true, "reason": "ok" },
  "oracle_id": "oracle_main_1",
  "issued_at": "2026-07-25T19:05:00Z",
  "oracle_signature": "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe"
}
Successful response (200):

{
  "status": "received",
  "attestation_id": "att_123",
  "device_id": "dev_9e9c644e1580a83b",
  "oracle_id": "oracle_main_1"
}
Schema validation error (400):

{
  "detail": {
    "message": "Invalid Attestation",
    "error": "<jsonschema message>",
    "path": ["field", "subfield"]
  }
}
Mode B: Attestation request (new format)
Used in tests/test_oracle_attest.py.

Request (example):

{
  "device_id": "dev_9e9c644e1580a83b",
  "nonce": "abc12345xyz",
  "timestamp": "2026-07-25T19:05:00Z",
  "algo": "mock",
  "payload": {
    "max_power_kw": 2.5
  },
  "signature": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
}
Successful response (200):

{
  "device_id": "dev_9e9c644e1580a83b",
  "attestation_id": "a6ff7c9a-9e75-4f6c-9b18-2cbb2e9b1a77",
  "decision": {
    "allowed": true,
    "max_power_kw": 2.5
  }
}
attestation_id is generated server-side (UUID).

Schema error (missing field, etc.) (400):

{
  "detail": {
    "error": "schema_validation_error",
    "message": "...'signature' is a required property"
  }
}
Timestamp format error (400):

{
  "detail": {
    "error": "schema_validation_error",
    "message": "timestamp is not a valid ISO 8601 string with 'Z'"
  }
}
timestamp must be ISO 8601 UTC with a Z suffix, e.g.:
2026-07-25T19:05:00Z.

2. Provisioning
(brief, based on the tests; can be extended later)

2.1. POST /provisioning/attest
Accepts a DeviceProof (schema device_proof.schema.json).

On a valid payload → 200 and some business logic.
On a schema error → 400:
{
  "detail": {
    "message": "Invalid DeviceProof",
    "path": ["device_id"]
  }
}
3. Registry
Endpoints for the device registry (see app/api/registry.py).
A CRUD description for devices, manifests, etc. can be added later. EOF


---

### 2) API client `tools/client.py`

```bash
cd ~/ENRG
mkdir -p tools

cat << 'EOF' > tools/client.py
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4

import httpx


@dataclass
class ENRGClientConfig:
    base_url: str = "http://localhost:8000"


class ENRGClient:
    def __init__(self, config: Optional[ENRGClientConfig] = None):
        self.config = config or ENRGClientConfig()
        self._client = httpx.Client(base_url=self.config.base_url, timeout=10.0)

    def health(self) -> Dict[str, Any]:
        resp = self._client.get("/health")
        resp.raise_for_status()
        return resp.json()

    # ---------- Oracle: new request format ----------

    def oracle_attest_request(
        self,
        device_id: str,
        nonce: str,
        max_power_kw: float,
        algo: str = "mock",
        signature: Optional[str] = None,
        timestamp: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send an attestation request in the new format (device_id/nonce/timestamp/...).

        Returns a dict with fields:
        - device_id
        - attestation_id
        - decision.allowed
        - decision.max_power_kw
        """
        if timestamp is None:
            now = datetime.now(timezone.utc).replace(microsecond=0)
            timestamp = now.isoformat().replace("+00:00", "Z")

        if signature is None:
            # Real code would put a signature here.
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
        if resp.status_code == 400:
            try:
                data = resp.json()
                print("Oracle attest (new) validation error:", json.dumps(data, indent=2))
            except Exception:
                print("Oracle attest (new) error:", resp.text)
        resp.raise_for_status()
        return resp.json()

    # ---------- Oracle: legacy Attestation format ----------

    def oracle_attest_legacy(self, attestation: Dict[str, Any]) -> Dict[str, Any]:
        """
        Send a full Attestation in the legacy format (uses the attestation schema).
        """
        resp = self._client.post("/oracle/attest", json=attestation)
        if resp.status_code == 400:
            try:
                data = resp.json()
                print("Oracle attest (legacy) validation error:", json.dumps(data, indent=2))
            except Exception:
                print("Oracle attest (legacy) error:", resp.text)
        resp.raise_for_status()
        return resp.json()

    def build_simple_attestation(
        self,
        device_id: str,
        oracle_id: str = "oracle_main_1",
        allowed: bool = True,
        reason: str = "ok",
    ) -> Dict[str, Any]:
        """
        Build a simple valid Attestation for debugging the legacy mode.
        Matches tests/test_api.py.
        """
        now = datetime.now(timezone.utc).replace(microsecond=0)
        issued_at = now.isoformat().replace("+00:00", "Z")

        attestation_id = f"att_{uuid4().hex[:8]}"
        att = {
            "attestation_id": attestation_id,
            "device_id": device_id,
            "proof": {},
            "decision": {"allowed": allowed, "reason": reason},
            "oracle_id": oracle_id,
            "issued_at": issued_at,
            "oracle_signature": "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
        }
        return att


def main() -> None:
    client = ENRGClient()
    print("Health:", client.health())

    # New-format example
    print("\n--- New oracle_attest_request() example ---")
    result_new = client.oracle_attest_request(
        device_id="dev_example_1",
        nonce="nonce123",
        max_power_kw=3.3,
    )
    print(json.dumps(result_new, indent=2))

    # Legacy-format example
    print("\n--- Legacy oracle_attest_legacy() example ---")
    att = client.build_simple_attestation(device_id="dev_example_1")
    result_legacy = client.oracle_attest_legacy(att)
    print(json.dumps(result_legacy, indent=2))


if __name__ == "__main__":
    main()
