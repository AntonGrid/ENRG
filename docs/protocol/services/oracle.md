# 13. Oracle

## 13.1 Overview

The Oracle is responsible for cryptographic verification within the ENRG Protocol.

The Oracle verifies protocol messages, validates Proof-of-Production, and submits verified operations for protocol execution.

The Oracle SHALL NOT perform policy evaluation.

The Oracle SHALL NOT maintain authoritative protocol state.

---

## 13.2 Responsibilities

The Oracle SHALL perform the following operations:

- Verify digital signatures
- Validate timestamps
- Validate nonces
- Verify Proof-of-Production
- Verify Manifest signatures
- Submit verified operations for execution

The Oracle SHALL NOT evaluate protocol policy.

The Oracle SHALL NOT authorize protocol operations.

---

## 13.3 Verification Pipeline

Every Proof SHALL pass through the following verification pipeline.

```
Receive Proof
        │
        ▼
Verify Signature
        │
        ▼
Verify Nonce
        │
        ▼
Verify Timestamp
        │
        ▼
Verify Manifest
        │
        ▼
Proof Verified
        │
        ▼
Forward to Policy Engine
```

Policy evaluation SHALL occur only after successful verification.

---

## 13.4 Signature Verification

Every authenticated protocol message SHALL be verified using the device public key registered in the Device Registry.

Signature verification SHALL reject:

- Invalid signatures
- Unknown public keys
- Revoked device identities

Verification SHALL occur before any protocol processing.

---

## 13.5 Timestamp Validation

Every Proof SHALL include a timestamp.

The Oracle SHALL reject Proofs with timestamps outside the acceptable protocol validation window.

The acceptable validation window MAY be implementation-defined.

---

## 13.6 Nonce Validation

Every authenticated protocol message SHALL contain a unique nonce.

The Oracle SHALL reject reused nonces.

Nonce validation SHALL provide replay attack protection.

---

## 13.7 Manifest Verification

The Oracle SHALL verify that the Device Manifest satisfies protocol requirements.

Verification SHALL include:

- Manifest Signature
- Manifest Version
- Protocol Version
- Device Identifier

Invalid Manifests SHALL cause protocol rejection.

---

## 13.8 Smart Contract Interaction

Only successfully verified protocol operations MAY be submitted for execution.

The Oracle SHALL NOT bypass Policy Engine decisions.

The Oracle SHALL NOT execute protocol state transitions independently.

---

## 13.9 Error Handling

Verification failures SHALL generate protocol errors.

Typical verification failures include:

- INVALID_SIGNATURE
- INVALID_NONCE
- INVALID_TIMESTAMP
- INVALID_MANIFEST
- DEVICE_REVOKED

Implementations MAY define additional verification errors.

---

## 13.10 Audit Requirements

Oracle implementations SHOULD maintain an audit log containing:

- Verification Timestamp
- Device Identifier
- Verification Result
- Failure Reason
- Policy Request Identifier

Audit records SHOULD support operational diagnostics and security investigations.

---

## 13.11 Security Requirements

The Oracle SHALL:

- Verify every authenticated message.
- Reject invalid protocol messages.
- Prevent replay attacks.
- Preserve verification integrity.
- Remain independent from policy evaluation.

---

## 13.12 Implementation Independence

This specification defines Oracle behavior.

It does not prescribe:

- Programming language
- Server architecture
- Deployment topology
- Database technology

Different Oracle implementations MAY exist provided protocol behavior remains compliant.

---

## 13.13 Requirements Summary

Every compliant implementation SHALL satisfy the following requirements.

- The Oracle MUST perform cryptographic verification.
- The Oracle MUST NOT evaluate protocol policy.
- Every authenticated message MUST be verified.
- Invalid protocol messages MUST be rejected.
- Verification behavior MUST remain implementation-independent.
