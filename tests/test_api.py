from fastapi.testclient import TestClient

from axis_core.main import app


client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_register_and_get_device():
    # Register device
    resp = client.post("/provisioning/register", json={"public_key": "test-public-key-123"})
    assert resp.status_code == 200
    data = resp.json()
    assert "device_id" in data
    device_id = data["device_id"]

    # Get from registry
    resp2 = client.get(f"/registry/devices/{device_id}")
    assert resp2.status_code == 200
    record = resp2.json()
    assert record["device_id"] == device_id
    assert record["public_key"] == "test-public-key-123"


def test_attest_ok():
    # First register device
    resp = client.post("/provisioning/register", json={"public_key": "test-public-key-456"})
    assert resp.status_code == 200
    device_id = resp.json()["device_id"]

    # Send valid attest
    proof = {
        "device_id": device_id,
        "nonce": "abc12345xyz",
        "timestamp": "2026-07-25T19:00:00Z",
        "algo": "mock",
        "payload": {"max_power_kw": 2.5},
        "signature": "deadbeef" * 8,
    }
    resp2 = client.post("/provisioning/attest", json=proof)
    assert resp2.status_code == 200
    body = resp2.json()
    assert body["status"] == "ok"
    assert body["device_id"] == device_id
    assert body["decision"]["allowed"] is True


def test_attest_bad_device_id():
    proof = {
        "device_id": "BAD_ID",
        "nonce": "abc12345xyz",
        "timestamp": "2026-07-25T19:00:00Z",
        "algo": "mock",
        "payload": {"max_power_kw": 2.5},
        "signature": "deadbeef" * 8,
    }
    resp = client.post("/provisioning/attest", json=proof)
    assert resp.status_code == 400
    body = resp.json()
    assert body["detail"]["message"] == "Invalid DeviceProof"
    assert body["detail"]["path"] == ["device_id"]


def test_oracle_attest_ok():
    # Take an example attestation from the file and send it to /oracle/attest
    import json
    from pathlib import Path

    base_dir = Path(__file__).resolve().parent.parent
    example_path = base_dir / "attestation-example.json"
    with example_path.open("r", encoding="utf-8") as f:
        att = json.load(f)

    resp = client.post("/oracle/attest", json=att)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "received"
    assert body["attestation_id"] == att["attestation_id"]
    assert body["device_id"] == att["device_id"]
    assert body["oracle_id"] == att["oracle_id"]


def test_oracle_attest_invalid_missing_field():
    att = {
        # "attestation_id" missing — falls into Mode 2 as oracle_attest_request
        "device_id": "dev_9e9c644e1580a83b",
        "proof": {},
        "decision": {"allowed": True, "reason": "ok"},
        "oracle_id": "oracle_main_1",
        "issued_at": "2026-07-25T19:05:00Z",
        "oracle_signature": "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
    }
    resp = client.post("/oracle/attest", json=att)
    # Axis-core returns 400 with a string in detail
    assert resp.status_code == 400
    body = resp.json()
    assert isinstance(body["detail"], str)
