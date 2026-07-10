# 15. Smart Contract

## 15.1 Overview

The Smart Contract is the authoritative on-chain execution component of the ENRG Protocol.

Its responsibilities include maintaining protocol state, enforcing on-chain invariants, executing approved protocol operations, and recording immutable protocol events.

The Smart Contract SHALL execute only operations that have successfully completed protocol verification and policy evaluation.

---

## 15.2 Responsibilities

The Smart Contract SHALL be responsible for:

- Maintaining protocol state
- Recording immutable transactions
- Executing approved state transitions
- Minting protocol assets when authorized
- Enforcing on-chain validation rules
- Preserving protocol integrity

The Smart Contract SHALL NOT perform cryptographic verification.

The Smart Contract SHALL NOT evaluate protocol policy.

---

## 15.3 Execution Flow

Every protocol operation SHALL follow the execution flow below.

```
Device
      │
      ▼
Oracle Verification
      │
      ▼
Policy Engine
      │
      ▼
Smart Contract
      │
      ▼
Blockchain State
```

Only operations accepted by the Policy Engine MAY be executed on-chain.

---

## 15.4 State Management

The Smart Contract SHALL maintain the authoritative blockchain state.

Examples include:

- Device registration records
- Energy production records
- Token balances
- Pool state
- Governance state

All state transitions SHALL be deterministic.

---

## 15.5 Transaction Validation

Before executing a state transition, the Smart Contract SHALL validate:

- Transaction format
- Required accounts
- Program ownership
- Protocol constraints
- Authorization requirements

Invalid transactions SHALL be rejected.

---

## 15.6 Token Issuance

Token issuance SHALL occur only after:

1. Successful Proof verification.
2. Successful Policy evaluation.
3. Successful Smart Contract validation.

Proof generation alone MUST NOT authorize minting.

---

## 15.7 Deterministic Execution

Every state transition SHALL be deterministic.

Given identical inputs, compliant implementations SHALL produce identical protocol state.

---

## 15.8 Security Requirements

The Smart Contract SHALL:

- Reject unauthorized operations.
- Protect protocol state.
- Prevent invalid state transitions.
- Preserve deterministic execution.
- Enforce protocol invariants.

---

## 15.9 Upgradeability

Protocol upgrades SHOULD preserve compatibility whenever possible.

Breaking protocol changes SHOULD be introduced through governance and documented in future protocol versions.

---

## 15.10 Implementation Independence

This specification defines Smart Contract behavior.

It does not prescribe:

- Blockchain implementation
- Virtual machine
- Programming language
- Deployment model

The current reference implementation uses Solana and Anchor.

Future implementations MAY support additional blockchain platforms while preserving protocol compatibility.

---

## 15.11 Requirements Summary

Every compliant implementation SHALL satisfy the following requirements.

- The Smart Contract MUST execute only verified and approved operations.
- The Smart Contract MUST preserve deterministic protocol state.
- The Smart Contract MUST NOT evaluate protocol policy.
- The Smart Contract MUST NOT perform cryptographic verification.
- Token issuance MUST occur only after successful protocol validation.
