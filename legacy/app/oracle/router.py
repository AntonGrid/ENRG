from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime
from typing import Dict, Optional, Any, Literal
import uuid
import json
from jsonschema import validate as jsonschema_validate, ValidationError

from axis_core.schemas_loader import load_attestation_schema

router = APIRouter(prefix="/oracle", tags=["oracle"])


LifecycleState = Literal["provisioned", "active", "suspended", "retired"]
PolicyDecision = Literal["allow", "deny", "review"]
AttesterType = Literal["device", "oracle"]


class AttestationPayload(BaseModel):
    manifest_ref: str
    firmware_version: str
    lifecycle_state: LifecycleState
    policy_decision: Optional[PolicyDecision] = None
    metrics: Optional[Dict[str, float]] = None
    extra: Optional[Dict[str, Any]] = None


class Attestation(BaseModel):
    attestation_id: str
    device_id: str
    nonce: str
    timestamp: datetime
    payload: AttestationPayload
    signature: str
    signing_key_id: str
    attester_type: AttesterType


class AttestationResponse(BaseModel):
    status: str
    attestation_id: str
    device_id: str
    received_at: datetime
    echo: Dict[str, Any]


_ATTESTATIONS: Dict[str, Dict[str, Any]] = {}


@router.post("/attest", response_model=AttestationResponse, status_code=201)
async def create_attestation(attestation: Attestation) -> AttestationResponse:
    """Mock Oracle endpoint that validates attestation against JSON Schema and stores it in memory."""
    schema = load_attestation_schema()

    # Pydantic -> plain dict
    attestation_dict = json.loads(attestation.model_dump_json())

    try:
        jsonschema_validate(instance=attestation_dict, schema=schema)
    except ValidationError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "attestation_schema_validation_failed",
                "message": e.message,
                "path": list(e.path),
            },
        )

    attestation_id = attestation.attestation_id or str(uuid.uuid4())

    _ATTESTATIONS[attestation_id] = {
        "attestation": attestation_dict,
        "stored_at": datetime.utcnow().isoformat(),
    }

    return AttestationResponse(
        status="accepted",
        attestation_id=attestation_id,
        device_id=attestation.device_id,
        received_at=datetime.utcnow(),
        echo={
            "attester_type": attestation.attester_type,
            "nonce": attestation.nonce,
            "payload": attestation.payload.model_dump(),
        },
    )
