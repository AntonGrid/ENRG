from fastapi.testclient import TestClient

from axis_core.main import app

client = TestClient(app)


def test_oracle_attest_request_ok():
    payload = {
        "device_id": "dev_9e9c644e1580a83b",
        "nonce": "abc12345xyz",
        "timestamp": "2026-07-25T19:05:00Z",
        "algo": "mock",
        "payload": {"max_power_kw": 2.5},
        "signature": "deadbeef" * 8,
    }

    resp = client.post("/oracle/attest", json=payload)
    assert resp.status_code == 200

    body = resp.json()
    assert body["device_id"] == payload["device_id"]
    assert "attestation_id" in body

    decision = body["decision"]
    assert decision["allowed"] is True
    assert decision["max_power_kw"] == 2.5
    assert decision["reason"] == "ok"


def test_oracle_attest_request_invalid_schema():
    # The required signature field is missing
    payload = {
        "device_id": "dev_9e9c644e1580a83b",
        "nonce": "abc12345xyz",
        "timestamp": "2026-07-25T19:05:00Z",
        "algo": "mock",
        "payload": {"max_power_kw": 2.5},
        # "signature": "deadbeef" * 8,
    }

    resp = client.post("/oracle/attest", json=payload)
    assert resp.status_code == 400

    body = resp.json()
    # Axis-core returns detail as a string
    assert isinstance(body["detail"], str)
    assert "required property" in body["detail"]


def test_oracle_attest_request_invalid_timestamp():
    payload = {
        "device_id": "dev_9e9c644e1580a83b",
        "nonce": "abc12345xyz",
        # Invalid format: no trailing 'Z'
        "timestamp": "2026-07-25T19:05:00",
        "algo": "mock",
        "payload": {"max_power_kw": 2.5},
        "signature": "deadbeef" * 8,
    }

    resp = client.post("/oracle/attest", json=payload)
    assert resp.status_code == 400

    body = resp.json()
    # Axis-core returns detail as a string
    assert isinstance(body["detail"], str)
    assert "timestamp" in body["detail"]


def test_oracle_attest_denied_when_power_too_high():
    payload = {
        "device_id": "dev_high_power",
        "nonce": "nonce_high",
        "timestamp": "2026-07-25T19:05:00Z",
        "algo": "mock",
        "payload": {"max_power_kw": 10.0},
        "signature": "deadbeef" * 8,
    }

    resp = client.post("/oracle/attest", json=payload)
    assert resp.status_code == 200
    body = resp.json()

    decision = body["decision"]
    assert decision["allowed"] is False
    assert decision["reason"] == "max_power_exceeded"
    # Axis-core returns the limit value (5.0), not the original requested value
    assert decision["max_power_kw"] == 5.0
    assert decision["limit_kw"] == 5.0
