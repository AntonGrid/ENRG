from fastapi.testclient import TestClient

from axis_core.main import app


client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_provisioning_and_registry():
    prov_resp = client.post(
        "/provisioning/register",
        json={"public_key": "test-public-key-smoke-123"},
    )
    assert prov_resp.status_code == 200
    body = prov_resp.json()
    device_id = body["device_id"]

    reg_resp = client.get(f"/registry/devices/{device_id}")
    assert reg_resp.status_code == 200
    rec = reg_resp.json()
    assert rec["device_id"] == device_id
