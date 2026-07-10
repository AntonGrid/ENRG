# 10. Device Registry

## 10.1 Overview

The Device Registry is the authoritative source of device information within the ENRG Protocol.

Every compliant implementation SHALL maintain a Device Registry or an equivalent mechanism providing identical protocol behavior.

The Device Registry SHALL remain the single Source of Truth for all protocol device state.

---

## 10.2 Responsibilities

The Device Registry SHALL be responsible for maintaining:

- Device Identity
- Device Ownership
- Lifecycle State
- Manifest Version
- Firmware Version
- Device Capabilities
- Registration Metadata
- Audit Metadata

The Device Registry SHALL NOT perform cryptographic verification or policy evaluation.

---

## 10.3 Registry Records

Each registered device SHALL possess exactly one Registry Record.

A Registry Record SHOULD contain:

- Device Identifier
- Public Key
- Current Owner
- Lifecycle State
- Manifest Version
- Firmware Version
- Registration Timestamp
- Last Update Timestamp

Additional implementation-specific metadata MAY be stored provided interoperability is preserved.

---

## 10.4 Source of Truth

The Device Registry SHALL remain the authoritative source for:

- Device existence
- Ownership
- Lifecycle
- Registration status

No protocol component SHALL maintain an authoritative copy of Registry state.

Cached or replicated data SHALL NOT replace the Registry as the Source of Truth.

---

## 10.5 Immutable Fields

The following Registry fields SHALL remain immutable after successful registration.

- Device Identifier
- Public Key
- Registration Timestamp

Modification of immutable fields SHALL require a new device registration.

---

## 10.6 Mutable Fields

The following Registry fields MAY change during device operation.

- Owner
- Lifecycle State
- Manifest Version
- Firmware Version
- Capabilities
- Last Update Timestamp

All modifications SHALL be auditable.

---

## 10.7 Registry Versioning

Every Registry Record SHOULD maintain a monotonically increasing version.

Version changes SHALL occur whenever mutable Registry data changes.

Version history SHOULD remain available for audit purposes.

---

## 10.8 Audit Trail

Registry implementations SHOULD maintain an audit history of significant state changes.

Audit entries SHOULD include:

- Timestamp
- Previous Value
- New Value
- Initiating Component
- Reason (if available)

---

## 10.9 Component Interaction

The Device Registry MAY be queried by:

- Provisioning Service
- Policy Engine
- Oracle
- Smart Contract
- Client Applications

Read access SHALL NOT imply authority to modify Registry state.

---

## 10.10 Security Requirements

Registry implementations SHALL:

- Protect record integrity.
- Prevent unauthorized modification.
- Preserve audit history.
- Reject duplicate identities.
- Reject duplicate public keys.

---

## 10.11 Implementation Independence

This specification defines Registry behavior.

It does not prescribe:

- Database engine
- Storage model
- Replication strategy
- Deployment architecture

Implementations MAY differ while preserving protocol compatibility.

---

## 10.12 Requirements Summary

Every compliant implementation SHALL satisfy the following requirements.

- The Device Registry MUST remain the Source of Truth.
- Every device MUST possess exactly one Registry Record.
- Immutable fields MUST NOT change after registration.
- Mutable fields MUST be auditable.
- Registry behavior MUST remain implementation-independent.
