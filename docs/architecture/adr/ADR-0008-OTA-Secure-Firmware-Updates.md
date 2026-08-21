# ADR-0008: OTA & Secure Firmware Updates

**Status:** Draft (Approved)
**Date:** 2026-07-17 (revised 2026-07-27)
**Authors:** Axis Protocol Team
**Related:** ADR-0007, docs/registry, firmware/

---

## Context

Axis Protocol reference hardware requires a secure mechanism for delivering and installing firmware updates: image integrity and authenticity, protection of private keys, minimization of bricking risk, rollback on failed updates, and notification/coordination with registries and anchoring.

Without a strict OTA model, the following risks exist:
- Image substitution
- Installation of unsigned images
- Inability to roll back
- Desynchronization between registries and devices

---

## Decision

### Core Principles

- Firmware images are signed by a **Firmware Signing Key** (ED25519, offline/cold).
- Signature and metadata (Firmware Manifest) are published in the **Manifest Registry** (see ADR-0007).
- Transport: **TLS 1.3** (HTTPS, CoAP+DTLS/TLS, MQTTs) — secure channel for image download and notifications.
- Device verifies manifest → image hash → image signature → compatibility, and only then installs.
- **Atomicity:** dual-bank (A/B) or verified-boot + pending-flag + fallback (if supported), with smoke-tests and automatic rollback on error within a probation window.
- **Anti-rollback:** monotonic counter or secure version stored/protected in a secure element (preferred). If secure element is absent — fallback protection with higher risk and limited capabilities.
- **Notifications:** push (Notification Service signed by Verifier/Registry) or pull (poll Manifest Registry with ETag/If-Modified-Since).
- **Emergency update flow:** emergency flag in manifest + immediate emergency anchor to an immutable registry + accelerated delivery.

---

### Firmware Manifest Format (Required Fields)

| Field | Type | Description |
|-------|------|-------------|
| `firmware_version` | string | Semver-like version |
| `image_hash` | string | SHA-256 hash of the image |
| `image_size` | integer | Size in bytes |
| `compatible_models` | array | List of compatible device models |
| `min_attestation_policy` | string | Reference to policy for smoke-tests/verification |
| `firmware_signature` | string | Base64-encoded ED25519 signature (over canonical manifest or image) |
| `issued_by` | string | Signing entity ID |
| `issued_at` | string | ISO8601 timestamp |
| `emergency` | boolean | Emergency flag (default: false) |
| `rollout_policy` | object (optional) | Percentage, regions, schedule |

The Manifest is published in the Manifest Registry and can be verified via Merkle anchoring (see ADR-0007).

---

### Update Flow

1. **Manifest Source:**
   - **Push:** Notification Service (signed notification) sends manifest URI/ID.
   - **Pull:** Device polls → `GET /manifests?model=<device-model>`

2. **Verification:**
   - Device verifies manifest signature against the Firmware Signing Key published in the Manifest Registry / Root Key Registry.
   - Checks `compatible_models` and `min_attestation_policy`.

3. **Download:**
   - Downloads image via HTTPS (TLS 1.3).

4. **Integrity Check:**
   - Computes SHA-256 of the image and compares to `image_hash`.

5. **Signature Verification:**
   - Verifies image signature (if signature covers image) or canonical manifest signature that binds `image_hash`.

6. **Installation:**
   - Stores image in staging/inactive bank.
   - Performs smoke-tests.
   - Marks as active if successful; rolls back if failure.

---

## Rationale

- **Security:** Signed images and secure boot prevent unauthorized code execution.
- **Reliability:** Dual-bank and rollback mechanisms minimize bricking risk.
- **Flexibility:** Emergency updates allow rapid response to critical issues.
- **Traceability:** All updates are logged in the Manifest Registry and anchored to an immutable registry.

---

## Consequences

- Devices **MUST** implement secure boot and signature verification.
- The Manifest Registry **MUST** support versioning, rollback, and emergency flags.
- Notification Service **MUST** be signed by a trusted entity.

---

## Related ADRs

- ADR-0001: Private Key Never Leaves the Device
- ADR-0007: Security & Key Management
- ADR-0009: Governance Model

---

## Implementation Notes

- This decision is **protocol-level** and must be respected by all implementations.
- Implementation details (dual-bank specifics, secure element integration) are defined in the Axis-core repository.
