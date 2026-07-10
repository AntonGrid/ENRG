# 18. Protocol Interfaces

## 18.1 Overview

Protocol Interfaces define how compliant components exchange information within the ENRG Protocol.

This specification defines interface behavior rather than implementation details.

All interfaces SHALL remain deterministic, interoperable, and implementation-independent.

---

## 18.2 Purpose

Protocol Interfaces provide standardized communication between:

- Devices
- Provisioning Service
- Device Registry
- Policy Engine
- Oracle
- Smart Contract
- Client Applications

Every compliant implementation SHALL preserve interface compatibility.

---

## 18.3 Communication Principles

All protocol communication SHALL satisfy the following principles:

- Deterministic behavior
- Explicit message structure
- Version compatibility
- Cryptographic authenticity
- Replay protection

Protocol messages SHALL be machine-readable.

---

## 18.4 Interface Categories

The ENRG Protocol defines the following interface categories:

- Device Interfaces
- Provisioning Interfaces
- Registry Interfaces
- Oracle Interfaces
- Smart Contract Interfaces
- Client Interfaces

Future protocol versions MAY introduce additional interface categories.

---

## 18.5 Version Compatibility

Every protocol message SHALL include the protocol version.

Implementations SHALL reject unsupported protocol versions.

Backward compatibility SHOULD be preserved whenever technically possible.

---

## 18.6 Authentication

Authenticated protocol interfaces SHALL require:

- Device Identity
- Digital Signature
- Timestamp
- Nonce

Unauthenticated requests SHALL be rejected where authentication is required.

---

## 18.7 Error Handling

Every interface SHALL return deterministic protocol errors.

Implementations SHALL NOT expose internal implementation details through interface responses.

---

## 18.8 Security Considerations

Protocol Interfaces SHALL:

- Protect message integrity.
- Prevent replay attacks.
- Verify authenticated requests.
- Preserve protocol compatibility.
- Reject malformed messages.

---

## 18.9 Implementation Independence

This specification defines interface behavior.

It does not prescribe:

- REST
- gRPC
- WebSocket
- MQTT
- TCP
- HTTP

Compliant implementations MAY choose any transport mechanism while preserving protocol behavior.

---

## 18.10 References

- ADR-0001 — Private Key Never Leaves Device
- ADR-0002 — Device Registry Source of Truth
- ADR-0003 — Oracle Never Makes Policy Decisions
- ADR-0004 — Device Manifest
- ADR-0005 — Device Lifecycle

---

## 18.11 Requirements Summary

Every compliant implementation SHALL satisfy the following requirements.

- Every interface MUST remain deterministic.
- Authenticated interfaces MUST verify identity.
- Protocol messages MUST include version information.
- Interface behavior MUST remain implementation-independent.
- Implementations MUST preserve interoperability.
