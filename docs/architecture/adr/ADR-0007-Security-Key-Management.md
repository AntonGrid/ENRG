# ADR-0007: Security & Key Management

**Status:** Draft (Approved)
**Date:** 2026-07-17 (revised 2026-07-27)
**Authors:** Axis Protocol Team
**Related:** ADR-0001, ADR-0008, ADR-0009

---

## Context

Axis Protocol connects physical devices and trust/coordination layers (which MAY include blockchains, audit logs, or other registries). Deployments can include firmware, oracle services, on-chain or off-chain registries, and other components. To ensure system security, it is critical to define a unified, documented, and verifiable approach to key management and signing: which keys are used by whom and where, how they are generated, how the root of trust is stored, how device attestation is performed, how key rotation/revocation is handled, and how firmware signatures are linked to registries and governance.

Without a formalized ADR, different subsystems (firmware production, oracle operators, contracts, registration services) would have incompatible or insecure procedures.

---

## Decision

### 1. Root of Trust

A single root of trust for each manufacturing/supply chain is stored and managed through a **Governance-managed Root Key Registry** (on-chain or off-chain registry, optionally with anchoring to an immutable audit log or blockchain).

### 2. Key Types

| Key Type | Algorithm | Purpose |
|----------|-----------|---------|
| **Infrastructure / registry keys** | ED25519 | Registry operations, critical configuration changes, governance actions |
| **Device signing keys** | ED25519 | Signing device manifests and messages |
| **Device attestation keys** | ED25519 | Stored in Secure Element; attestation format: COSE/CBOR (primary), X.509 (optional) |
| **Firmware signing keys** | ED25519 | Offline, cold key — signing firmware images |
| **Transport keys (TLS)** | ECDSA P-256 or x25519 | Secure connection (OTA, provisioning) |

Implementations MAY introduce additional key types (e.g., for log signing, metrics, debug access) but MUST document them and ensure they do not break this model.

### 3. Root-of-Trust Model

- **Chain of trust:** Root CA / Root Public Key (Governance-managed) → Manufacturer CA (or signing authority) → Device attestation key.
- **Alternative (lightweight deployments):** Root public key directly signs device public keys (acceptable with a documented and auditable production process).

The choice between these models MUST be explicitly documented per deployment.

### 4. Key Lifecycle

- **Generation:**
  - Private keys **MUST** be generated in a secure environment (HSM / Secure Element / TPM or equivalent).
  - Device keys **MUST** be generated in the device secure element when possible; otherwise, generated in a provisioning environment with a documented secure transfer to the device.
- **Storage:**
  - Private keys **MUST** be stored in a secure hardware module on the device (Secure Element / eFuse / TPM).
  - For infrastructure keys, HSMs or equivalent secure modules are RECOMMENDED.
- **Provisioning:**
  - Devices are enrolled with a signed Device Enrollment Certificate / Manifest containing `device_id`, public keys, and provisioning metadata.
  - This manifest is registered in the Manifest Registry and can be referenced in governance and operational flows.
- **Rotation:**
  - Keys **MUST** support rotation.
  - The rotation process **MUST** produce new key material, submit the new public key and attestation to the registry, and, when required, re-sign device manifests.
  - Old keys **MUST** be revocable in the registry.
- **Revocation:**
  - The Registry supports revocation records and reasons.
  - Chain-of-trust checks **MUST** validate revocation status for all keys involved in trust decisions.

### 5. Attestation

- Devices **SHALL** produce attestation statements binding device identity to the measured firmware image and device public key.
- **Attestation format:** COSE/CBOR-based (PRIMARY) or optional X.509-based for interoperability. COSE/CBOR is preferred for compactness and ease of parsing on constrained devices.
- **Fields expected in attestation (COSE/CBOR):**
  - `device_id` (UUID or equivalent stable identifier)
  - `device_pubkey`
  - `firmware_manifest_hash`
  - `nonce`
  - `timestamp`
  - `attestation_signature` (signed by device attestation key or via TPM/secure element quote)
- **Verifiers** (e.g., registries, oracles, remote services, or on-chain verifiers) **SHALL** validate attestation using manifest registry root keys and firmware signature checks.

### 6. Firmware Signing & OTA

- Firmware images **MUST** be signed by a Firmware Signing Key (cold/offline).
- Signature information and firmware manifest (hash, version, allowed device models, minimum attestation policy) are stored in the Manifest Registry and distributed to devices and verifiers.
- Devices **MUST** verify firmware signature and manifest constraints before installing new firmware.
- Rollback protection and version constraints **SHOULD** be enforced as part of manifest policy evaluation.

### 7. Anchoring and Registries

- Public keys for root-of-trust and manufacturer authorities **MUST** be publishable in the Manifest Registry.
- Implementations MAY additionally anchor registry state (e.g., Merkle roots) in an immutable system such as a blockchain, append-only log, or hardware-protected log.
- **Anchoring policy (recommended default):**
  - Periodic anchoring once per 24 hours (daily Merkle root or equivalent) is **RECOMMENDED**.
  - Emergency revocation anchors **MUST** be supported and performed as needed to record urgent revocations or trust-root changes.

Exact anchoring frequency and mechanisms MAY vary between deployments but MUST be documented and auditable.

### 8. Governance

- Governance-managed Root Key rotations and trust root changes **MUST** be performed via the protocol governance process (see ADR-0009).
- An emergency rotation flow with multi-party approval (e.g., multisig or equivalent) and optional time-locks is REQUIRED for high-impact operations.
- Governance processes MUST define:
  - who can propose rotations and revocations;
  - quorum and approval thresholds;
  - how emergency overrides are logged, justified, and audited.

### 9. Device Key Storage Trust Tiers

To make "stored in a secure hardware module" (Section 4) operational, device key
storage is classified into three trust tiers. The tier is a property of the
deployment (device + provisioning process), not of the protocol message format,
and it MUST be documented per device model.

| Tier | Key storage | Signing | Section 4 compliance | Production (mainnet) |
| :--- | :--- | :--- | :--- | :--- |
| `basic` | Plain flash / NVS (Preferences) | CPU | No | MUST NOT be used |
| `hardware-aided` | Secure Element data slot (e.g. ATECC608A) | CPU (key material appears in RAM) | Partial | Allowed only with a documented risk assessment and an explicit governance decision |
| `conforming` | Secure Element with on-chip signing (e.g. NXP SE050) | Inside the Secure Element; key never leaves it | Full | REQUIRED |

- **`basic`** — the private key is stored in ordinary flash memory (e.g. ESP32
  NVS/Preferences). Suitable for development and education only; MUST NOT be
  used in production.
- **`hardware-aided`** — the seed is stored in a Secure Element slot, but the
  device cannot sign the required algorithm on-chip (e.g. ATECC608A does not
  support Ed25519), so the key material is present in CPU RAM during signing.
  This reduces exposure compared to `basic` but is not full Section 4
  compliance.
- **`conforming`** — the key is generated inside a Secure Element that performs
  Ed25519 signing on-chip (e.g. NXP SE050); the private key never leaves the
  Secure Element. This is the only tier that fully satisfies Section 4
  ("Private keys MUST be stored in a secure hardware module").

**Mainnet requirement:** device keys MUST be stored in the `conforming` tier.
`hardware-aided` MAY be used on mainnet only with a documented risk assessment
and an explicit governance decision (ADR-0009). `basic` MUST NOT be used in
production.

---

## Related ADRs

- ADR-0001: Private Key Never Leaves the Device
- ADR-0005: Device States and Lifecycle
- ADR-0008: Secure Firmware Updates (OTA)
- ADR-0009: Governance Model

---

## Implementation Notes

- This decision is **protocol-level** and MUST be respected by all conforming implementations of Axis Protocol.
- Concrete implementation details (hardware choices, specific attestation encodings, integration with particular blockchains or trust systems) are defined in **implementation-specific repositories and deployment guides**.
- The **Axis-core** project is intended to serve as a reference implementation of these decisions. Other implementations MAY diverge in internal structure and technology choices, but MUST preserve the security and interoperability guarantees defined by this ADR.
