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
        Send a full Attestation in the legacy format (but against the new 1.0 schema).
        Does not raise on 400 — instead prints the error and returns the body.
        """
        resp = self._client.post("/oracle/attest", json=attestation)
        try:
            data = resp.json()
        except Exception:
            data = {"raw": resp.text}

        if resp.status_code == 400:
            print("Oracle attest (legacy) validation error:", json.dumps(data, indent=2))
        elif resp.status_code != 200:
            print(f"Oracle attest (legacy) unexpected status {resp.status_code}:", json.dumps(data, indent=2))

        # Do not call raise_for_status() so the script does not crash
        return data

    def build_simple_attestation(
        self,
        device_id: str,
        oracle_id: str = "oracle_main_1",
        allowed: bool = True,
        reason: str = "ok",
    ) -> Dict[str, Any]:
        """
        Build a simple Attestation for debugging the legacy mode.
        Follows attestation.schema.json: schema_version=1.0,
        the proof contains at least device_id, nonce, timestamp, payload.max_power_kw.
        """
        now = datetime.now(timezone.utc).replace(microsecond=0)
        issued_at = now.isoformat().replace("+00:00", "Z")
        proof_timestamp = issued_at

        attestation_id = f"att_{uuid4().hex[:8]}"
        nonce = "legacy_nonce_123"

        att: Dict[str, Any] = {
            "schema_version": "1.0",
            "attestation_id": attestation_id,
            "device_id": device_id,
            "proof": {
                "device_id": device_id,
                "nonce": nonce,
                "timestamp": proof_timestamp,
                "algo": "mock",
                "payload": {
                    "max_power_kw": 3.3
                },
                "signature": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
            },
            "decision": {
                "allowed": allowed,
                "reason": reason,
                "max_power_kw": 3.3
            },
            "oracle_id": oracle_id,
            "issued_at": issued_at,
            "oracle_signature": "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe"
        }
        return att


def main() -> None:
    client = ENRGClient()
    print("Health:", client.health())

    print("\n--- New oracle_attest_request() example ---")
    result_new = client.oracle_attest_request(
        device_id="dev_example_1",
        nonce="nonce123",
        max_power_kw=3.3,
    )
    print(json.dumps(result_new, indent=2))

    print("\n--- Legacy oracle_attest_legacy() example ---")
    att = client.build_simple_attestation(device_id="dev_example_1")
    result_legacy = client.oracle_attest_legacy(att)
    print(json.dumps(result_legacy, indent=2))


if __name__ == "__main__":
    main()
