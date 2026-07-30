# 4. Architecture Overview

## 4.1 Overview

The ENRG Protocol consists of independent protocol components that collectively establish trust between physical devices and distributed digital infrastructure.

Each component has a clearly defined responsibility.

No protocol component SHALL perform responsibilities assigned to another component unless explicitly defined by this specification.

---

## 4.2 Architectural Goals

The architecture is designed to achieve the following objectives:

- Cryptographic trust
- Component independence
- Horizontal scalability
- Protocol interoperability
- Long-term maintainability
- Implementation independence

---

## 4.3 Core Architecture

The logical architecture of the ENRG Protocol is defined below.

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

This diagram represents logical responsibilities rather than deployment architecture.

---

## 4.4 Architectural Layers

The protocol is organized into the following logical layers.

### Device Layer

Responsible for physical measurements, cryptographic identity, and Proof generation.

---

### Registry Layer

Responsible for maintaining the authoritative state of protocol devices.

---

### Policy Layer

Responsible for evaluating protocol rules and making policy decisions.

---

### Verification Layer

Responsible for cryptographic verification of protocol messages.

---

### Execution Layer

Responsible for immutable on-chain execution and protocol state transitions.

---

### Governance Layer

Responsible for protocol evolution and decentralized governance.

---

## 4.5 Component Responsibilities

The responsibilities of each component are summarized below.

| Component | Responsibility |
|----------|----------------|
| Device | Produces cryptographically signed Proofs |
| Provisioning Service | Registers and provisions devices |
| Device Registry | Stores authoritative protocol state |
| Policy Engine | Evaluates protocol policies |
| Oracle | Performs cryptographic verification |
| Smart Contract | Executes protocol state transitions |
| DAO | Governs protocol evolution |

---

## 4.6 Architectural Rules

Every compliant implementation SHALL satisfy the following architectural rules.

- Components SHALL communicate only through defined protocol interfaces.
- Responsibilities SHALL remain separated.
- Registry SHALL remain the Source of Truth.
- Oracle SHALL NOT make policy decisions.
- Policy Engine SHALL NOT perform cryptographic verification.
- Smart Contract SHALL NOT perform off-chain policy evaluation.

---

## 4.7 Client Applications

Applications such as:

- Dashboard
- Mobile Applications
- SDKs
- CLI
- Third-party Services

are NOT protocol components.

They are protocol clients.

Clients MAY differ in implementation while remaining fully compatible with this specification.

---

## 4.8 Reference Implementation

The official ENRG implementation demonstrates one compliant implementation of this architecture.

Reference implementations SHALL NOT redefine protocol behavior.

Whenever implementation details differ from this specification, this specification SHALL prevail.

---

## 4.9 Architectural Stability

The architecture defined by this specification SHALL remain stable across protocol versions unless modified through the ENRG RFC process.

Reference implementations MAY evolve independently while preserving protocol compatibility.
