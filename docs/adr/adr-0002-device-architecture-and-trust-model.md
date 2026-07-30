# ADR-0002: Device Architecture and Trust Model

## Status

Proposed

## Context

ENRG needs a coherent architecture and trust model that connects physical devices with on-chain state. We must:

- Have a single source of truth for device identity and lifecycle.
- Separate concerns between Device, Provisioning Service, Device Registry, Policy Engine, Oracle, Smart Contract, and DAO.
- Minimize on-chain complexity while preserving verifiability.
- Base trust around device-held private keys and verifiable attestations.

## Decision

We standardize the following roles and flows:

### Roles

- **Device** — physical or virtual node with a private key, able to sign payloads.
- **Provisioning Service (PS)** — handles initial onboarding, binds DeviceManifest to a concrete device, assigns `device_id` and owner.
- **Device Registry (DR)** — canonical source of truth for device identity, keys, manifest reference, and lifecycle state.
- **Policy Engine (PE)** — evaluates policies over proofs/attestations and registry state, returns decisions (ALLOW / DENY / CHALLENGE / QUARANTINE).
- **Oracle (OR)** — bridges off-chain decisions and on-chain contracts by submitting attestations to the blockchain.
- **Smart Contract (SC)** — minimal on-chain representation of device state and trust-relevant flags. Validates Oracle attestations.
- **DAO** — governs policies, trusted oracles, and protocol parameters.

### Data Artifacts

We standardize three primary JSON-based artifacts:

- **DeviceManifest** — describes hardware/firmware, capabilities, manufacturer, and keying material. Identified by `manifest_id`. Schema: `schemas/device-manifest.schema.json`.
- **DeviceRecord** — canonical record of a device instance in the Registry, including `device_id`, `manifest_ref`, `owner`, `public_key`, `lifecycle_state`, timestamps, and metadata. Schema: `schemas/device-record.schema.json`.
- **DeviceProof** — signed proof/attestation from a device or on its behalf, binding `device_id`, `manifest_ref`, `nonce`, `timestamp`, and payload, with a signature verifiable against the device public key. Schema: `schemas/device-proof.schema.json`.

These artifacts are versioned and reusable across services via JSON Schema (draft-07).

### Identifiers and Encodings

- `device_id` — deterministic, derived from device public key and production attributes; encoded as base58 with pattern `^[1-9A-HJ-NP-Za-km-z]{32,64}$`.
- `manifest_ref` — reference to `DeviceManifest.manifest_id`, also base58 with the same pattern.
- `public_key` — base58 encoded key material, consistent across Manifest and DeviceRecord.
- `nonce` — anti-replay value, hex-encoded, pattern `^[0-9a-f]{16,64}$`.
- `signature` — base64-encoded signature over a canonical representation of (`device_id`, `manifest_ref`, `nonce`, `timestamp`, `payload`).

Concrete derivation and canonicalization rules are defined in implementation docs, but all APIs assume these forms.

### Root of Trust

- The **root of trust** is the private key stored on the Device.
- The Device generates its keypair locally; the private key never leaves the Device.
- Provisioning binds the device public key to a `device_id` and a `manifest_ref`.
- All subsequent trust decisions (policy evaluation, on-chain acknowledgements) ultimately rely on verifying signatures produced by this private key, plus consistency with the Device Registry.

### Interaction Flow (High-Level)

1. **Provisioning**
   - Device ships with or is associated to a DeviceManifest.
   - Provisioning Service receives a manifest (and optional owner) and creates a DeviceRecord in the Device Registry.
   - PS returns `device_id`, `manifest_ref`, and a `bootstrap_policy` to the caller (operator, manufacturing pipeline, etc.).

2. **Bootstrap**
   - Device generates a DeviceProof of type `provisioning` or `attestation`, including `nonce`, `timestamp`, and a payload with basic state.
   - Provisioning Service verifies the signature using the public key in the DeviceRegistry/Manifest.
   - On success, PS returns minimal configuration and current `bootstrap_policy`.

3. **Attestation and Policy**
   - Device periodically or on-demand sends DeviceProofs of type `attestation`.
   - Policy Engine evaluates these proofs in context of registry state and configured policies.
   - PE returns decisions (ALLOW / DENY / CHALLENGE / QUARANTINE) used by higher-level systems and the Oracle.

4. **On-chain Integration**
   - Oracle submits attestations/decisions on-chain in a minimal, canonical format.
   - Smart Contract validates Oracle identity and attestation format, updates on-chain device flags/state.
   - DAO governs which oracles are trusted and how policies map to on-chain consequences.

### On-Chain Minimization

We deliberately keep most complexity off-chain:

- Continuous telemetry and detailed proofs are processed by PS/DR/PE and not stored on-chain.
- On-chain state contains:
  - Device identifiers and minimal trust flags (e.g., active / quarantined / retired).
  - References to off-chain attestations (hashes, URIs, or Merkle roots).
- Oracle is responsible for projecting off-chain decisions into on-chain-friendly attestations.

### API Boundaries

- **Provisioning Service API** — described by `openapi/provisioning-service.yaml`:
  - `POST /devices` — create device via manifest.
  - `GET /devices/{device_id}` — retrieve provisioned device.
  - `POST /devices/{device_id}/bootstrap` — device bootstrap with signed proof.
  - `POST /devices/{device_id}/attestations` — submit attestation.

- **Device Registry API** — described by `openapi/device-registry.yaml`:
  - `GET /devices` — list/filter devices.
  - `POST /devices` — create/upsert DeviceRecord (administrative / internal).
  - `GET /devices/{device_id}` — retrieve DeviceRecord.
  - `PATCH /devices/{device_id}` — partial update.
  - `DELETE /devices/{device_id}` — administrative deletion.
  - `POST /devices/{device_id}/lifecycle` — lifecycle transitions.
  - `GET /devices/{device_id}/attestations` — registry-level view of attestations (optional).

Both OpenAPI specs reuse the shared schemas via `$ref` to files in `schemas/`.

## Consequences

- Clear separation of concerns between provisioning, registry, policy, oracle, and chain.
- Consistent identity and proof formats across services.
- Backwards-compatible evolution via schema versioning and ADRs.
- Implementation teams can work against stable OpenAPI contracts using shared schemas.

Future ADRs will detail:

- Policy Engine interfaces and decision schemas.
- Oracle data model and on-chain contract interfaces.
- Canonical encoding and signing rules for DeviceProofs.
