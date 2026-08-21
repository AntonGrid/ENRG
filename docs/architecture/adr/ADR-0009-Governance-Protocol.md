# ADR-0009: Governance Model for Axis Protocol

**Status:** Draft  
**Date:** 2026-07-27  
**Authors:** Axis Protocol Team  
**Related:** ADR-0007, ADR-0008

---

## Context

Axis Protocol is a decentralized protocol with critical on-chain and off-chain components (root keys, registries, programs, oracles). Governance defines how decisions are made, who has which rights to change protocol parameters, manage root keys, and initiate significant changes (migration, new features).

The model must provide:

- **Security** for critical operations (root key rotation, emergency actions).
- **Sufficient decentralization and representation** for parametric changes.
- **Predictable, auditable, and reversible flows** (timelocks, multisig, fallbacks).
- A process for adding features and transitioning to new protocol levels with rehearsals and testnet stages.

---

## Decision

A **hybrid governance model** combining on-chain voting for parametric changes and off-chain/threshold multisig (Guardians) for critical emergency operations.

### Components

#### 1. Token Holders Governance (On-chain Voting)
- Used for changing economic and behavioral parameters (fees, slashing thresholds, timelocks, upgrade policies), and for adopting new RFCs/ADRs for functional changes.
- Voting flow: **Propose → Deposit → Discussion → Voting (configurable period) → Result** (if quorum and threshold are reached).

#### 2. Guardians Multisig (Off-chain / On-chain-backed)
- A set of trusted participants (initially: core maintainers, infrastructure operators, major stakeholders) managing emergency operations: root key rotation, emergency freezes, emergency anchors.
- Multisig threshold (e.g., 5 of 7) is configurable and reflected in the on-chain contract/registry.
- Guardians can initiate emergency actions with a short timelock (emergency flow) or with a regular timelock (safer flow).

#### 3. Timelocks & Escrow
- All critical changes (e.g., contract upgrades, root key rotations) are subject to a timelock (e.g., 48–72 hours) before execution, except for the emergency flow (which requires a stricter quorum and subsequent audit).

#### 4. Proposal Lifecycle & RFC/ADR Process
- Changes start as ADRs/RFCs in `docs/rfc/`.
- For protocol-level changes, a formal proposal containing tests, an upgrade plan, and migration scripts must be submitted.
- Proposals are subject to acceptance criteria and automated test suites (on testnet) before being scheduled for an on-chain vote or Guardian action.

#### 5. Role Definitions
- **Token Holders:** Vote on parameters, long-term direction.
- **Guardians:** Manage emergency ops; possess multisig keys; must publish signed justification for emergency actions.
- **Maintainers/Core Developers:** Prepare code, tests, PRs, and run rehearsals on testnet.
- **Auditors:** External parties that review security-critical changes.

#### 6. Root Key Management
- Root keys are critical artifacts; managed via Guardians multisig with on-chain anchoring.
- Routine rotations are scheduled via governance proposals; emergency rotations can be executed by Guardians with a higher threshold plus post-action community review.
- All root key changes are logged, anchored on-chain, and must include a signed rotation manifest and rollover plan.

---

### Voting Mechanics (On-chain)

- **Proposal Submission:**
  - Proposer submits a proposal contract with metadata and a deposit (to prevent spam).
  - Voting period: configurable (default 7 days).
- **Quorum & Threshold:**
  - Quorum is defined as a percentage of total voting power (e.g., 15%).
  - Approval threshold: simple majority (≥50%) or supermajority (≥66%) depending on the change type.
- **Execution:**
  - If the proposal passes and the timelock expires, it can be executed by anyone (permissionless execution).

---

### Emergency Flow

1. **Detection & Initiation:**
   - Any Guardian can detect an emergency and propose an action (freeze, key rotation, halt).
   - The Guardian provides an on-chain or off-chain signed justification.
2. **Emergency Vote:**
   - Guardians vote with a short timeframe (e.g., 6–12 hours).
   - Threshold: higher than normal (e.g., 6 of 7).
3. **Execution:**
   - If approved, the action is executed immediately or with a very short timelock (e.g., 1 hour).
4. **Post-action Review:**
   - A post-mortem report is published and discussed by the community.

---

## Consequences

### Positive
- **Security:** Critical operations are protected by multisig and timelocks.
- **Flexibility:** Parametric changes are governed by token holders; emergency actions are handled by Guardians.
- **Auditability:** All changes are logged, anchored, and auditable.
- **Decentralization:** Hybrid model balances efficiency and decentralization.

### Negative
- **Complexity:** More moving parts (multisig, timelocks, voting contracts) increase complexity.
- **Centralization risk:** Guardians may become a single point of failure if threshold is too low or if collusion occurs.
- **Governance overhead:** Proposal and voting processes require significant community engagement.

### Trade-offs
- **Speed vs. Security:** Emergency flows are faster but more centralized; normal flows are slower but more decentralized.
- **Complexity vs. Flexibility:** The hybrid model is more complex but allows for a wide range of governance scenarios.

---

## Related ADRs

- ADR-0001: Keys Never Leave the Device
- ADR-0007: Security Key Management
- ADR-0008: Secure Firmware Updates (OTA)

---

## Implementation Status

The governance model is accepted at the architectural level. Implementation details (multisig contracts, voting contracts, Guardian registry) reside in the Axis-core repository.
