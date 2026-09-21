from datetime import datetime
from typing import Dict, Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from jsonschema import ValidationError

from axis_core.schema_utils import get_validator, validate_payload

router = APIRouter(prefix="/oracle", tags=["oracle"])

# Legacy Attestation validator
ATT_VALIDATOR = get_validator("attestation")

# Simple in-memory storage
_ATTESTATIONS: Dict[str, Dict[str, Any]] = {}


def _ensure_iso8601_z(ts: str) -> None:
    """
    Verify that timestamp is in ISO 8601 UTC format with 'Z' suffix.
    Example of a valid value: '2026-07-25T19:05:00Z'.
    """
    if not isinstance(ts, str):
        raise ValueError("timestamp must be a string")

    if not ts.endswith("Z"):
        raise ValueError("timestamp must end with 'Z'")

    iso = ts[:-1] + "+00:00"
    datetime.fromisoformat(iso)


def _looks_like_attestation(body: dict) -> bool:
    """
    Heuristic: detect legacy Attestation format.
    Tests send fields: device_id, proof, decision, oracle_id, issued_at, oracle_signature.
    """
    attestation_keys = {
        "proof",
        "decision",
        "oracle_id",
        "issued_at",
        "oracle_signature",
        "attestation_id",
    }
    return any(k in body for k in attestation_keys)


def _handle_legacy_attestation(attestation: dict) -> Dict[str, Any]:
    """
    Process legacy Attestation format (used in tests/test_api.py).
    Now:
    - attestation.schema.json is mandatory
    - schema_version == "1.0" is mandatory
    """
    try:
        ATT_VALIDATOR.validate(attestation)
    except ValidationError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Invalid Attestation",
                "error": e.message,
                "path": list(e.path),
            },
        )

    # Validate schema_version
    version = attestation.get("schema_version")
    if version is None:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Invalid Attestation",
                "error": "schema_version is required",
                "path": ["schema_version"],
            },
        )
    if version != "1.0":
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Invalid Attestation",
                "error": f"unsupported schema_version: {version}, expected '1.0'",
                "path": ["schema_version"],
            },
        )

    # Additional validation of issued_at
    issued_at = attestation.get("issued_at")
    if isinstance(issued_at, str):
        try:
            ts = issued_at
            if ts.endswith("Z"):
                ts = ts[:-1] + "+00:00"
            datetime.fromisoformat(ts)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Invalid Attestation",
                    "error": "issued_at is not a valid ISO 8601 timestamp",
                    "path": ["issued_at"],
                },
            )

    att_id = attestation["attestation_id"]
    _ATTESTATIONS[att_id] = attestation

    return {
        "status": "received",
        "attestation_id": att_id,
        "device_id": attestation["device_id"],
        "oracle_id": attestation["oracle_id"],
    }


def _handle_new_attest_request(payload: dict) -> Dict[str, Any]:
    """
    Process new oracle_attest_request payload (tests/test_oracle_attest.py).
    """
    # Backwards-compatible: if client does not send schema_version, assume "1.0"
    if "schema_version" not in payload:
        payload = {**payload, "schema_version": "1.0"}

    # Schema validation
    try:
        validate_payload("oracle_attest_request", payload)
    except ValidationError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "schema_validation_error",
                "message": e.message,
            },
        )

    # Timestamp validation
    ts = payload.get("timestamp")
    try:
        _ensure_iso8601_z(ts)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "schema_validation_error",
                "message": "timestamp is not a valid ISO 8601 string with 'Z'",
            },
        )

    inner_payload = payload.get("payload") or {}
    max_power_kw = inner_payload.get("max_power_kw") if isinstance(inner_payload, dict) else None

    attestation_id = str(uuid4())

    # Simple policy: limit power to 5 kW
    limit_kw = 5.0
    if max_power_kw is not None and max_power_kw > limit_kw:
        decision = {
            "allowed": False,
            "reason": "max_power_exceeded",
            "max_power_kw": max_power_kw,
            "limit_kw": limit_kw,
        }
    else:
        decision = {
            "allowed": True,
            "reason": "ok",
            "max_power_kw": max_power_kw,
        }

    result = {
        "device_id": payload["device_id"],
        "attestation_id": attestation_id,
        "decision": decision,
    }

    _ATTESTATIONS[attestation_id] = {
        "request": payload,
        "result": result,
    }

    return result


@router.post("/attest")
def oracle_attest(body: dict):
    """
    Universal Oracle endpoint:

    1) Legacy mode: accepts a full Attestation, validates against 'attestation'
       schema, returns status 'received'.
    2) New mode: accepts a request with device_id/nonce/timestamp/...,
       validates against 'oracle_attest_request' schema, returns decision.
    """
    if _looks_like_attestation(body):
        return _handle_legacy_attestation(body)
    return _handle_new_attest_request(body)


@router.get("/attestations/{attestation_id}")
def get_attestation(attestation_id: str):
    """
    Return a previously stored attestation or result.
    """
    att = _ATTESTATIONS.get(attestation_id)
    if not att:
        raise HTTPException(status_code=404, detail="Attestation not found")
    return att
