# ADR-0001: Private Key Never Leaves the Device

**Status:** Accepted  
**Date:** 2025-06-28 (revised 2026-07-27)  
**Authors:** Axis Protocol Team  

---

## Context

In the Axis Protocol, devices generate cryptographic keys for signing proofs of events (Proof-of-*). A fundamental question arose: should the private key be stored on the device or could it be transferred to a server to simplify the architecture?

## Decision

The private key is **generated on the device** and **never leaves it**. Only the public key is transmitted to the server (oracle, registry). Proof signing is performed **exclusively on the device**. The server only verifies the signature.

## Rationale

- **Security:** The private key cannot be intercepted or compromised on the server side.
- **Decentralization:** The device remains autonomous and does not depend on the server for cryptographic operations.
- **Trust:** The trust model is built on the device independently proving its identity and data.

## Consequences

- The device must have a Secure Element (or equivalent) for secure key storage.
- The device firmware must support key generation and data signing without server involvement.
- Device registration is performed using the public key.
- Device revocation is only possible through a revocation mechanism (server side).

## Alternatives Considered

- **Key generation on the server and transmission to the device** — rejected due to the risk of compromise during transmission.
- **Using a single key for all devices** — rejected due to lack of device identification.

---

## Related ADRs

- ADR-0002: Device Registry as Source of Truth
- ADR-0005: Device Lifecycle States
- ADR-0007: Security Key Management

---

## Implementation Notes

- This decision is **protocol-level** and must be respected by all implementations.
- Implementation details (Secure Element integration, key generation algorithms) are defined in the Axis-core repository.
