# ADR-0004: Device Manifest as Local Configuration Source

**Status:** Accepted
**Date:** 2025-06-28 (revised 2026-07-27)
**Authors:** Axis Protocol Team

---

## Context

After registration and onboarding, a question arises: how does the device learn its parameters (heartbeat interval, Proof threshold, Trust Level, Capabilities)? Constant requests to the server create load and latency. Storing configuration only on the server makes the device dependent on the network.

## Decision

After registration or policy changes, the device receives a **signed Device Manifest** — a compact document containing all necessary configuration parameters. The device stores it locally and uses it for operation. The server signs the Manifest with its key; the device verifies the signature.

The Manifest contains:

- `device_id`
- `trust_level`
- `capabilities`
- `heartbeat_interval`
- `proof_threshold`
- `policy_version`
- `verifier_endpoint`
- `signature`

## Rationale

- **Reduced server load:** the device does not request configuration at every startup.
- **Autonomy:** the device operates even during temporary network issues.
- **Security:** a signed Manifest cannot be forged.
- **Flexibility:** when policies change, the server issues a new Manifest.

## Consequences

- The device must be able to store the Manifest in persistent storage.
- The device must verify the Manifest signature using the server's public key.
- When configuration changes, the server sends a new Manifest via a secure firmware update mechanism or during the next heartbeat.
- The device compares `policy_version` with the current version and requests an update if they do not match.

## Alternatives Considered

- **Constant requests to the server** — rejected due to load and network dependency.
- **Hardcoded configuration** — rejected due to lack of flexibility.

---

## Related ADRs

- ADR-0001: Private Key Never Leaves the Device
- ADR-0003: Oracle and Policy Engine
- ADR-0005: Device Lifecycle States

---

## Implementation Notes

- This decision is **protocol-level** and must be respected by all implementations.
- Implementation details (Manifest format, storage mechanisms) are defined in the Axis-core repository.
