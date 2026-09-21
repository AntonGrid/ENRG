"""
SDK tests — Python client (audit 2026-09-21).

The interesting part is cross-language: `sdk/vectors/wire_format.json` is
generated from `policy.js` (the mirror the conformance suite validates against
the Rust engine) and asserted here byte for byte, so the Python client cannot
silently disagree with the chain or with the JavaScript client.

The HTTP part runs against a throwaway ``http.server`` in a thread — hermetic, no
network, no devnet.
"""

import json
import pathlib
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

# Import the SDK the same way a partner would, without requiring an install step
# (CI runs pytest from the repository root; this keeps local runs identical).
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sdk.python.enrg_client import (  # noqa: E402  (import after sys.path setup)
    EnrgApiError,
    EnrgClient,
    attest_message,
    b58decode,
    b58encode,
    build_device_proof,
    device_message_to_sign,
    le8,
    oracle_message_to_sign,
    proof_hash,
    verify_device_proof,
)

VECTORS_PATH = pathlib.Path(__file__).resolve().parents[1] / "sdk" / "vectors" / "wire_format.json"
VECTORS = json.loads(VECTORS_PATH.read_text())


def test_all_committed_wire_vectors_match():
    """Every fixture in wire_format.json, byte for byte."""
    assert VECTORS["vectors"], "vector file must not be empty"
    for v in VECTORS["vectors"]:
        device_id = bytes.fromhex(v["device_id_hex"])
        assert device_message_to_sign(
            device_id, v["nonce"], v["device_timestamp"], v["energy_wh"]
        ).hex() == v["device_message_hex"], v["name"]

        oracle_msg = oracle_message_to_sign(
            device_id, v["nonce"], v["device_timestamp"], v["verified_at"], v["energy_wh"]
        )
        assert oracle_msg.hex() == v["oracle_message_hex"], v["name"]

        digest = proof_hash(oracle_msg)
        assert digest.hex() == v["proof_hash_hex"], v["name"]

        assert attest_message(device_id, v["nonce"], digest).hex() == v["attest_message_hex"], v["name"]


def test_message_lengths_match_the_documented_formats():
    device_id = bytes(range(32))
    assert len(device_message_to_sign(device_id, 1, 2, 3)) == 32 + 8 + 8 + 8
    assert len(oracle_message_to_sign(device_id, 1, 2, 3, 4)) == 32 + 8 + 8 + 8 + 8
    assert len(attest_message(device_id, 1, b"\x00" * 32)) == len(b"enrg:oracle:attest") + 32 + 8 + 32


def test_le8_refuses_out_of_range_values():
    with pytest.raises(ValueError):
        le8(-1)
    with pytest.raises(ValueError):
        le8(2 ** 64)
    # Python has no 2^53 float trap: this value is exactly representable.
    assert le8(2 ** 60).hex() == "0000000000000010"


def test_build_and_verify_device_proof_round_trip():
    proof = build_device_proof(seed=bytes([9]) * 32, nonce=5, device_timestamp=1700000000, energy_wh=2500)
    assert len(proof["device_id"]) == 44  # base58-encoded 32 byte key
    assert len(proof["device_signature"]) == 64
    assert verify_device_proof(proof) is True

    tampered = dict(proof, energy_wh=999999)
    assert verify_device_proof(tampered) is False
    assert verify_device_proof(dict(proof, device_signature=[0] * 64)) is False


def test_base58_round_trip_including_leading_zero_bytes():
    for raw in (bytes([9]) * 32, b"\x00" + bytes([7]) * 31, b"\x00\x00" + bytes([3]) * 30):
        assert b58decode(b58encode(raw)) == raw


class _MockOracleHandler(BaseHTTPRequestHandler):
    """Minimal stand-in for the real routes, including a flaky first request."""

    flaky_calls = 0

    def _json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):  # noqa: N802 (http.server API)
        if self.path == "/api/v1/stats":
            self._json(200, {"total_proofs": 28, "minted_proofs": 15})
        elif self.path.startswith("/api/v1/device/") and self.path.endswith("/balance"):
            self._json(200, {"balance": 0.000536313, "balance_atomic": "536313"})
        elif self.path.endswith("/status"):
            self._json(404, {"error": "device not found"})
        elif self.path == "/flaky":
            type(self).flaky_calls += 1
            if type(self).flaky_calls == 1:
                self._json(503, {"error": "starting"})
            else:
                self._json(200, {"ok": True})
        else:
            self._json(404, {"error": "unknown path"})

    def log_message(self, *_args):  # keep the test output clean
        return


@pytest.fixture(scope="module")
def mock_api():
    server = HTTPServer(("127.0.0.1", 0), _MockOracleHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    thread.join(timeout=5)


def test_client_reads_protocol_stats(mock_api):
    client = EnrgClient(base_url=mock_api, timeout=5, retries=0)
    assert client.stats()["minted_proofs"] == 15


def test_client_reads_device_balance(mock_api):
    client = EnrgClient(base_url=mock_api, timeout=5, retries=0)
    balance = client.device_balance("EAv5NDihqp2JyH4JpZqg9QkMpqxDFBskWdt56YDRmFm2")
    assert balance["balance"] == 0.000536313
    assert balance["balance_atomic"] == "536313"


def test_client_raises_typed_error_with_body(mock_api):
    client = EnrgClient(base_url=mock_api, timeout=5, retries=0)
    with pytest.raises(EnrgApiError) as err:
        client.device_status("11111111111111111111111111111111")
    assert err.value.status == 404
    assert err.value.body["error"] == "device not found"


def test_client_retries_a_503(mock_api):
    _MockOracleHandler.flaky_calls = 0
    client = EnrgClient(base_url=mock_api, timeout=5, retries=1)
    assert client.request("/flaky")["ok"] is True
    assert _MockOracleHandler.flaky_calls >= 2
