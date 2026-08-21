# ADR-0002: Device Registry as the Single Source of Truth

**Status:** Accepted
**Date:** 2025-06-28 (revised 2026-07-27)
**Authors:** Axis Protocol Team

---

## Context

In the Axis Protocol, device state (active, quarantine, maintenance, etc.) could potentially be stored in multiple places. This creates a risk of desynchronization and complicates diagnostics.

## Decision

The **Device Registry** is the **single source of truth** for device state.

All components query the Registry to obtain the current state.

The Registry stores:

- Current device state.
- Owner.
- Trust Level.
- Capabilities.
- Timestamp of the last heartbeat.
- Firmware version.
- State history (Audit Log).

### Identifiers

- `device_id`: deterministic identifier derived from the device public key and stable attributes. Format: **base58**, length 32–64.
- `manifest_ref`: reference to the Device Manifest. Format: **base58**, length 32–64.
- `public_key`: base58‑encoded key material.
- `nonce`: anti‑replay value, hex‑encoded, length 16–64.
- `signature`: base64‑encoded signature over a canonical representation of (`device_id`, `manifest_ref`, `nonce`, `timestamp`, `payload`).

### Core Components

- **Device** — physical or virtual entity holding the private key.
- **Provisioning Service** — handles initial onboarding, binds Device Manifest to a concrete device, assigns `device_id` and owner.
- **Device Registry** — canonical source of truth for device identity, keys, manifest reference, and lifecycle state.
- **Policy Engine** — evaluates policies over proofs and registry state, returns decisions.
- **Verifier** — verifies proofs and issues Digital Claims.
- **Digital System** — consumes Digital Claims (blockchain, ledger, etc.).
- **Governance** — governs policies, trusted verifiers, and protocol parameters.

### Interaction Flow
Device → Provisioning Service → Device Registry → Policy Engine → Verifier → Digital System

text

### Data Artifacts

- **DeviceManifest** — describes device model, manufacturer, capabilities. Identified by `manifest_id`.
- **DeviceRecord** — canonical record of a device instance in the Registry, including `device_id`, `manifest_ref`, `owner`, `public_key`, `lifecycle_state`, timestamps, and metadata.
- **DeviceProof** — signed proof from a device, binding `device_id`, `manifest_ref`, `nonce`, `timestamp`, and payload, with a signature verifiable against the device public key.

All artifacts are versioned and validated via JSON Schema.

### Root of Trust

- The **root of trust** is the private key stored on the Device.
- The Device generates its keypair locally; the private key never leaves the Device.
- The public key is used for verification.

## Rationale

- **Single point of control** for state simplifies diagnostics and auditing.
- **Eliminates the risk of desynchronization** between components.
- **Enables easy scaling:** new components simply query the Registry.
- **Ensures data integrity.**

## Consequences

- The Verifier **does not store** device state — it only verifies signatures and issues Digital Claims.
- The Policy Engine makes decisions based on data from the Registry.
- Client Applications display state obtained from the Registry.
- The Registry must have **high availability** (replication, backups).

## Alternatives Considered

- **Storing state separately in each component** — rejected due to the risk of desynchronization.
- **Using the blockchain as the source of truth** — rejected due to latency and cost.

---

## Related ADRs

- ADR-0001: Private Key Never Leaves the Device
- ADR-0003: Verifier and Policy Engine
- ADR-0005: Device Lifecycle States

---

## Implementation Notes

- This decision is **protocol-level** and must be respected by all implementations.
- Implementation details (database schema, API design) are defined in the Axis-core repository.
