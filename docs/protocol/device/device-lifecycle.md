# 8. Device Lifecycle

## 8.1 Overview

Every device participating in the ENRG Protocol SHALL follow a well-defined lifecycle.

The lifecycle defines the operational state of a device from initial registration through permanent revocation.

Every compliant implementation SHALL implement the lifecycle defined by this specification.

---

## 8.2 Lifecycle States

The ENRG Protocol defines the following lifecycle states.

```
UNREGISTERED
      │
      ▼
REGISTERED
      │
      ▼
CLAIMED
      │
      ▼
PROVISIONED
      │
      ▼
ACTIVE
      │
 ┌────┴────┐
 ▼         ▼
MAINTENANCE QUARANTINE
      │         │
      └────┬────┘
           ▼
        REVOKED
```

---

## 8.3 State Definitions

### UNREGISTERED

The device has not yet joined the protocol.

No protocol operations are permitted.

---

### REGISTERED

The device identity has been registered.

Ownership has not yet been established.

---

### CLAIMED

Ownership has been successfully verified.

The device is associated with a protocol participant.

---

### PROVISIONED

The device has successfully received and validated its Device Manifest.

The device is prepared to participate in protocol operations.

---

### ACTIVE

The device is authorized to generate Proof-of-Production.

All protocol services are available.

---

### MAINTENANCE

The device is temporarily unavailable for protocol participation.

Identity and ownership remain valid.

The device MAY return to ACTIVE.

---

### QUARANTINE

The device has been isolated due to policy evaluation.

Proofs SHALL NOT be accepted while the device remains in this state.

The device MAY return to ACTIVE only after successful policy evaluation.

---

### REVOKED

The device is permanently removed from protocol participation.

This state is terminal.

No further protocol operations SHALL be permitted.

---

## 8.4 Allowed State Transitions

Only the following lifecycle transitions are permitted.

| From | To |
|------|----|
| UNREGISTERED | REGISTERED |
| REGISTERED | CLAIMED |
| CLAIMED | PROVISIONED |
| PROVISIONED | ACTIVE |
| ACTIVE | MAINTENANCE |
| MAINTENANCE | ACTIVE |
| ACTIVE | QUARANTINE |
| QUARANTINE | ACTIVE |
| QUARANTINE | REVOKED |

All other transitions SHALL be considered invalid unless defined by a future version of this specification.

---

## 8.5 Transition Authority

Lifecycle transitions SHALL be initiated only by authorized protocol components.

| Transition | Authority |
|------------|-----------|
| Registration | Provisioning Service |
| Claim | Provisioning Service |
| Provisioning | Provisioning Service |
| Activation | Policy Engine |
| Maintenance | Policy Engine |
| Quarantine | Policy Engine |
| Revocation | Policy Engine or Governance |

---

## 8.6 Lifecycle Integrity

The current lifecycle state SHALL be maintained by the Device Registry.

No other protocol component SHALL maintain the authoritative lifecycle state.

---

## 8.7 Lifecycle Events

Every lifecycle transition SHOULD generate an auditable protocol event.

Events SHOULD include:

- Device Identifier
- Previous State
- New State
- Timestamp
- Initiating Component
- Reason (if applicable)

---

## 8.8 Terminal State

REVOKED is a terminal lifecycle state.

A revoked device SHALL NOT return to any previous lifecycle state.

Participation MAY resume only after a completely new registration process with a new Device Identity, if permitted by protocol policy.

---

## 8.9 Requirements Summary

Every compliant implementation SHALL satisfy the following requirements.

- Every device MUST follow the lifecycle defined by this specification.
- Only defined lifecycle transitions SHALL be permitted.
- Lifecycle state MUST be maintained by the Device Registry.
- REVOKED MUST be treated as a terminal state.
- Every lifecycle transition SHOULD be auditable.
