# ADR-0002: ENRG Part II Architecture and Trust Model

## Status

Accepted

## Context

ENRG must provide secure, verifiable operation of physical devices (energy and adjacent scenarios) together with on-chain logic (smart contracts, DAO, tokenomics).

To do this we need:

- To clearly define the device role and its identity.
- To separate off-chain infrastructure (Provisioning, Registry, Policy, Oracle) from the on-chain part (smart contracts, DAO).
- To minimize the data and logic that reaches on-chain.
- To have a reproducible, testable "minimal slice" of the system (Part II) that can be extended to mainnet-readiness.

## Decision

Part II adopts the following architecture and trust model.

### Components

1. **Device**  
   - Generates and stores a private key (e.g. Ed25519).
   - Signs payloads (DeviceProof) with its private key.
   - Never exposes the private key.

2. **Provisioning Service (PS)**  
   - Accepts the `public_key` from the device (or from a factory/integration process).
   - Assigns the `device_id` and binds it to `public_key` and `manifest_ref`.
   - Creates a `DeviceRecord` in the Device Registry.
   - Issues a base `bootstrap_policy` (minimal rights/limits to start).

3. **Device Registry (DR)**  
   - Keeps `DeviceRecord` as the **source of truth for device identity and lifecycle**.
   - `DeviceRecord` fields include:
     - `device_id`
     - `public_key`
     - `owner` (optional)
     - `lifecycle_state` (`provisioned`, `active`, `suspended`, `retired`)
     - `firmware_version` (optional)
     - `manifest_ref`
     - `created_at`, `updated_at`
     - `labels` (arbitrary tags)
   - All records are validated with the `device_record.schema.json` JSON Schema.

4. **Policy Engine (PE)** *(currently a mock/stub)*  
   - Accepts a `DeviceProof` and context (policies, device state).
   - Decides: allow/deny an action, limits (e.g. `max_power_kw`).
   - In the current mock service this is part of the `/provisioning/attest` endpoint, returning a fixed decision (`mock-allowed`).

5. **Oracle Service (OR)** *(to be implemented in later parts)*  
   - Accepts Policy Engine decisions and/or DeviceProofs.
   - Builds the on-chain attestation (an artifact signed with the oracle key).
   - Sends transactions to smart contracts (e.g. records events or changes limits).

6. **Smart Contracts (SC)** *(to be implemented in later parts)*  
   - Accept attestations from trusted Oracles.
   - Account for device states (active/suspended/retired) and their limits.
   - Affect tokenomics, reward/penalty calculations and other on-chain effects.

7. **DAO / Governance** *(later)*  
   - Manages the list of trusted Oracles.
   - Decides on protocol parameters, limits, updates.

### Trust model

1. **Root of trust — the private key on the device**  
   - The device generates a key pair.
   - The private key never leaves the device.
   - Everything the device "says" within a DeviceProof is confirmed by a signature.

2. **Device Registry as the source of truth for identity and lifecycle**  
   - Binds `device_id` to `public_key`, `manifest_ref` and the state (`lifecycle_state`).
   - Any Policy Engine and Oracle decision depends on the correctness and integrity of the DR.
   - The DR validates data via JSON Schema, minimizing structural drift.

3. **Policy Engine / Oracle as interpreters of trusted information**  
   - The Policy Engine reads:
     - the DeviceProof (signed device data),
     - the current DR state,
     - policies.
   - The Oracle trusts the Policy Engine (or embeds it) and builds attestations for on-chain.

4. **The on-chain part is minimal and works with attestations**  
   - Smart contracts do not validate raw DeviceProofs.
   - Smart contracts trust only attestations from trusted Oracles (whose list is managed by the DAO).
   - This reduces on-chain load and complexity and keeps flexibility at the off-chain level.

## Consequences

1. **A clear off-chain skeleton is in place**  
   - `Provisioning Service` + `Device Registry` + `Attestation endpoint` are implemented as a FastAPI service.
   - Artifact formats are fixed via JSON Schema:
     - `device_record.schema.json`
     - `device_manifest.schema.json`
     - `device_proof.schema.json`
   - The API is described in `openapi.yaml`.
   - Behavior is covered by pytest tests.

2. **The on-chain part can evolve independently**  
   - Contracts will work with Oracle attestations and do not depend on DeviceProof formatting details.
   - Changes to internal schemas (e.g. adding fields to `DeviceRecord` or `DeviceManifest`) do not require contract migrations as long as the attestation format is stable.

3. **A clear evolution path to mainnet**  
   - Part II (current stage): a mock service with Provisioning, Registry and a simple Attest.
   - Part III: moving Policy Engine and Oracle into separate services, defining the attestation format.
   - Part IV: implementing smart contracts and base tokenomics, integrating with the Oracle.
   - Part V: pilots, audit, moving to testnet/mainnet.

4. **Risks and limitations**  
   - Until the DR and Policy Engine/Oracle are replicated and decentralized, they are a point of trust (a trusted service).
   - Additional measures are needed:
     - authentication/authorization for admin DR operations,
     - audit of DR record changes,
     - monitoring and logging of Policy Engine decisions.
   - These aspects will be addressed in later parts (after Part II).

## Implementation Notes (as of today)

- The mock service implementation:
  - Python + FastAPI.
  - JSON validation via `jsonschema` (`Draft7Validator`).
  - An in-memory Device Registry (a dict) for the prototype.
- Main endpoints:
  - `GET /health`
  - `POST /provisioning/register`
  - `GET /registry/devices/{device_id}`
  - `POST /provisioning/attest`
- Tests:
  - `tests/test_api.py`
  - `tests/test_smoke.py`

This ADR records the Part II architectural decisions and serves as the base for later stages (Oracle, on-chain contracts, DAO).
