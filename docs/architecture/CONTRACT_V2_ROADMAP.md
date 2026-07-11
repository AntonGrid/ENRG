# ENRG Smart Contract v2 Roadmap

Status: Draft

---

# Purpose

This document defines the evolution of the ENRG Smart Contract from the current MVP implementation to the production-ready Contract v2.

The objective is to improve security, maintainability, protocol compliance, and long-term extensibility while preserving compatibility with the ENRG Protocol Specification.

---

# Phase 1 — Security

## Ed25519 Verification

Replace the temporary signature verification placeholder with complete Ed25519 signature verification.

Current state:

- Signature verification is stubbed.
- Proof verification is incomplete.

Target:

- Verify every Proof using Ed25519.
- Reject invalid signatures.
- Reject replay attacks.
- Verify signed payload integrity.

---

## PDA Validation

Review every PDA.

Validate:

- Vault
- Producer
- Staking Vault
- Buyback
- DAO
- Emergency Fund
- Founder Vesting

Remove unnecessary PDA seeds.

---

## Account Constraints

Review every account constraint.

Add missing:

- has_one
- constraint
- owner
- mint validation

---

# Phase 2 — Protocol Compliance

Synchronize the contract with the current ENRG Protocol Specification.

---

## Token Model

Replace:

Dynamic asymptotic emission

with

1 MWh = 1 SRC

---

## Proof-of-Production

Synchronize the Proof model with the Protocol Specification.

Review:

- timestamp
- nonce
- energy
- device identity

---

## Events

Remove obsolete events.

Introduce protocol events aligned with the specification.

Examples:

- ProofAccepted
- EnergyMinted
- StakeCreated
- StakeReleased
- RewardsClaimed

---

## Errors

Remove obsolete errors.

Introduce protocol-specific errors.

---

# Phase 3 — Code Cleanup

Remove legacy code.

Includes:

- Anchor template files
- unused modules
- duplicated logic
- obsolete math
- obsolete constants

Replace magic numbers with named constants.

---

# Phase 4 — Modular Architecture

Split lib.rs into modules.

Target structure:

src/

    instructions/

    state/

    events.rs

    errors.rs

    constants.rs

    math.rs

    utils.rs

lib.rs should become the protocol entry point only.

---

# Phase 5 — Performance

Review:

- account sizes
- Vec usage
- compute units
- CPI calls
- duplicated mint operations

Reduce unnecessary allocations.

---

# Phase 6 — Mainnet Readiness

Before Mainnet:

- complete security review
- protocol review
- integration testing
- oracle verification
- device verification
- documentation synchronization
- external audit

---

# Success Criteria

Contract v2 SHALL:

- fully implement the ENRG Protocol Specification;
- support deterministic Proof-of-Production;
- implement 1 MWh = 1 SRC;
- use verified Ed25519 signatures;
- follow modular architecture;
- be ready for external security audit;
- be suitable for Mainnet deployment.
