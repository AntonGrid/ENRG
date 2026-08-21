# ADR-0005: Device States and Lifecycle

**Status:** Accepted  
**Date:** 2025-06-28 (revised 2026-07-27)  
**Authors:** Axis Protocol Team  

---

## Context

A device in the Axis Protocol goes through several stages: from first power-on to revocation or decommissioning. Without clearly defined states and transition rules, the system becomes ambiguous and difficult to manage.

## Decision

Introduce a finite set of states and transition rules.

### State Diagram
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
├── (error, suspicion) → QUARANTINE
│
QUARANTINE
│
├── (diagnostics, resolution) → ACTIVE
│
├── (maintenance needed) → MAINTENANCE
│
▼
MAINTENANCE
│
├── (completion) → ACTIVE
│
ACTIVE
│
├── (transfer, revocation) → REVOKED
│
▼
REVOKED### State Definitions

| State | Description |
|-------|-------------|
| **UNREGISTERED** | Device is unknown to the system. |
| **REGISTERED** | Device has a cryptographic identity but is not yet linked to an owner. |
| **CLAIMED** | Device is linked to an owner but not yet configured. |
| **PROVISIONED** | Network configured, time synchronized, configuration received. |
| **ACTIVE** | Device is fully operational, sending Proofs. |
| **QUARANTINE** | Device is suspected of malfunction or compromise; requires investigation. |
| **MAINTENANCE** | Device is undergoing maintenance (firmware update, hardware check, etc.). |
| **REVOKED** | Device is permanently decommissioned. |

---

## Transition Rules

### FROM UNREGISTERED
- **TO REGISTERED:** Device presents a valid cryptographic identity and registers with the system.

### FROM REGISTERED
- **TO CLAIMED:** Device is assigned to an owner (wallet) via the Registry.

### FROM CLAIMED
- **TO PROVISIONED:** Device successfully provisions: connects to network, syncs time, receives configuration.

### FROM PROVISIONED
- **TO ACTIVE:** Device completes initial checks and begins normal operation.

### FROM ACTIVE
- **TO QUARANTINE:** Suspicious activity, policy violation, or security alert.
- **TO REVOKED:** Permanent decommissioning (by owner or system).
- **TO MAINTENANCE:** Scheduled or unscheduled maintenance.

### FROM QUARANTINE
- **TO ACTIVE:** Diagnostics complete and issue resolved.
- **TO REVOKED:** Issue cannot be resolved or device is compromised.
- **TO MAINTENANCE:** Maintenance is required.

### FROM MAINTENANCE
- **TO ACTIVE:** Maintenance complete, device returns to normal operation.
- **TO REVOKED:** Device cannot be restored.

### FROM REVOKED
- **No transitions out.** This is a terminal state.

---

## Rationale

- **Clarity:** each state has a well-defined meaning and purpose.
- **Traceability:** state transitions are auditable.
- **Security:** suspicious devices can be quarantined and investigated.
- **Operational flexibility:** maintenance can be performed without losing state context.

---

## Consequences

- The Registry must store the current state of each device.
- State transitions must be signed or authorized by a trusted entity.
- Policies (Policy Engine) can use the state to determine behavior.

---

## Related ADRs

- ADR-0002: Device Registry as the Single Source of Truth
- ADR-0003: Oracle and Policy Engine
- ADR-0007: Security Key Management

---

## Implementation Notes

- This decision is **protocol-level** and must be respected by all implementations.
- Implementation details (state transition authentication, storage) are defined in the Axis-core repository.
