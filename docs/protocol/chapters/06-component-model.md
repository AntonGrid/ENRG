# 6. Component Model

## 6.1 Overview

The ENRG Protocol is composed of independent logical components.

Each component performs one well-defined responsibility.

Protocol components SHALL communicate exclusively through documented protocol interfaces.

No component SHALL assume responsibilities assigned to another component unless explicitly defined by this specification.

---

## 6.2 Component Hierarchy

The ENRG Protocol consists of the following logical components.

```
Device
    │
    ▼
Provisioning Service
    │
    ▼
Device Registry
    │
    ▼
Policy Engine
    │
    ▼
Oracle
    │
    ▼
Smart Contract
    │
    ▼
DAO
```

This hierarchy represents logical responsibility rather than deployment topology.

---

## 6.3 Device

Purpose:

Produce cryptographically verifiable Proof-of-Production.

Primary responsibilities:

- Measure physical events.
- Protect the private key.
- Generate signed Proofs.
- Execute the Device Manifest.

The Device SHALL NOT:

- evaluate protocol policy;
- modify Registry state;
- mint protocol assets.

---

## 6.4 Provisioning Service

Purpose:

Provision devices for participation in the ENRG Protocol.

Primary responsibilities:

- Register devices.
- Verify claim requests.
- Deliver Device Manifest.
- Initialize protocol participation.

The Provisioning Service SHALL NOT:

- evaluate protocol policy;
- verify Proofs;
- execute Smart Contract operations.

---

## 6.5 Device Registry

Purpose:

Maintain the authoritative state of protocol devices.

Primary responsibilities:

- Device identity.
- Ownership.
- Lifecycle state.
- Manifest version.
- Device capabilities.
- Audit metadata.

The Device Registry SHALL remain the single Source of Truth for protocol device state.

---

## 6.6 Policy Engine

Purpose:

Evaluate protocol rules.

Primary responsibilities:

- Evaluate policy.
- Determine device eligibility.
- Apply protocol rules.
- Produce deterministic policy decisions.

The Policy Engine SHALL be the only component authorized to make protocol policy decisions.

---

## 6.7 Oracle

Purpose:

Perform cryptographic verification.

Primary responsibilities:

- Verify digital signatures.
- Validate timestamps.
- Validate nonces.
- Verify protocol messages.
- Submit valid operations for execution.

The Oracle SHALL NOT:

- evaluate policy;
- own protocol state;
- establish trust without successful verification.

---

## 6.8 Smart Contract

Purpose:

Execute immutable protocol state transitions.

Primary responsibilities:

- Execute protocol transactions.
- Manage protocol assets.
- Maintain on-chain state.
- Execute governance-approved operations.

The Smart Contract SHALL NOT perform off-chain verification or policy evaluation.

---

## 6.9 DAO

Purpose:

Govern protocol evolution.

Primary responsibilities:

- Protocol governance.
- Parameter updates.
- Protocol evolution.
- Community decision making.

The DAO SHALL operate according to governance rules defined by this specification.

---

## 6.10 Component Communication

Protocol components SHALL communicate only through documented protocol interfaces.

Direct implementation-specific dependencies SHOULD be avoided.

Components MAY be replaced independently provided protocol compatibility is preserved.

---

## 6.11 Component Independence

The failure or replacement of one component SHALL NOT require architectural redesign of unrelated protocol components.

This requirement enables long-term protocol evolution while preserving interoperability.

---

## 6.12 Summary

Every protocol component has exactly one primary responsibility.

Verification, policy evaluation, state management, execution, and governance SHALL remain independent responsibilities throughout the lifetime of the ENRG Protocol.
