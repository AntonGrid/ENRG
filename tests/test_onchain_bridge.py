from datetime import datetime, timezone

from eth_utils import keccak

from axis_core.onchain_bridge import build_attestation_params


def _example_attestation():
    return {
        "attestation_id": "att_1a2b3c4d5e6f7890",
        "device_id": "dev_9e9c644e1580a83b",
        "proof": {
            "device_id": "dev_9e9c644e1580a83b",
            "nonce": "abc12345xyz",
            "timestamp": "2026-07-25T19:00:00Z",
            "algo": "mock",
            "payload": {"max_power_kw": 2.5},
            "signature": "deadbeef" * 8,
        },
        "decision": {
            "allowed": True,
            "reason": "mock-allowed",
            "max_power_kw": 2.5,
        },
        "oracle_id": "oracle_main_1",
        "issued_at": "2026-07-25T19:05:00Z",
        "oracle_signature": "cafebabe" * 8,
    }


def test_build_attestation_params_basic():
    att = _example_attestation()

    params = build_attestation_params(att)

    # Проверяем хэши
    assert params.attestation_id == keccak(text=att["attestation_id"])
    assert params.device_id == keccak(text=att["device_id"])

    # allowed
    assert params.allowed is True

    # max_power_w = 2.5 kW * 1000 = 2500 W
    assert params.max_power_w == 2500

    # issued_at -> unix timestamp
    # сверим только что он > 0 и совпадает с ручным парсом
    dt = datetime.fromisoformat("2026-07-25T19:05:00+00:00")
    expected_ts = int(dt.replace(tzinfo=timezone.utc).timestamp())
    assert params.issued_at == expected_ts


def test_build_attestation_params_missing_field():
    att = _example_attestation()
    del att["attestation_id"]

    try:
        build_attestation_params(att)
        assert False, "Expected KeyError for missing attestation_id"
    except KeyError as e:
        assert "attestation_id" in str(e)
