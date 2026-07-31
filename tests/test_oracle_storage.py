from datetime import datetime, timezone

from axis_core.oracle_storage import InMemoryOracleStorage


def _now_utc_no_microseconds() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def test_oracle_store_and_get_attestation():
    storage = InMemoryOracleStorage()

    now = _now_utc_no_microseconds()
    issued_at = now.isoformat().replace("+00:00", "Z")

    attestation = {
        "attestation_id": "att_123",
        "device_id": "dev_123",
        "decision": {
            "allowed": True,
            "reason": "ok",
            "max_power_kw": 2.5,
        },
        "issued_at": issued_at,
    }

    storage.store_attestation(attestation)

    fetched = storage.get_attestation("att_123")
    assert fetched is not None
    assert fetched["attestation_id"] == "att_123"
    assert fetched["device_id"] == "dev_123"
    assert fetched["decision"]["allowed"] is True
    assert fetched["decision"]["max_power_kw"] == 2.5
    assert fetched["issued_at"] == issued_at
