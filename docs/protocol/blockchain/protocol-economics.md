# 16. Protocol Economics

> **Current implementation state** (addresses, constants, PDA structure,
> lifecycle, test status, roadmap) is in **`docs/STATE.md`** — the single
> source of truth, verified against the code (`programs/enrg-mvp/src`). This section is
> the normative description of the protocol economics; concrete on-chain values
> (allocations, vesting, governance parameters) — in `docs/STATE.md`.

## 16.1 Overview

The ENRG Protocol defines the economic rules governing the issuance and circulation of the native protocol token, SRC.

The protocol itself is blockchain-independent.

SRC is the native economic asset used by compliant ENRG implementations.

---

## 16.2 Native Token

The native token of the ENRG Protocol SHALL be identified as:

**SRC**

SRC represents verified energy production recorded by the protocol.

---

## 16.3 Minting Principle

The protocol defines the following minting rule:

> **1 MWh of verified energy production = 1 SRC**

Minting SHALL occur only after successful completion of the protocol verification pipeline.

---

## 16.4 Verification Requirements

SRC MAY be minted only after successful completion of:

- Proof-of-Production verification
- Oracle verification
- Policy Engine approval
- Smart Contract validation

Failure at any stage SHALL prevent token issuance.

---

## 16.5 Minting Flow

```
Energy Production
        │
        ▼
Proof-of-Production
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
SRC Mint
```

---

## 16.6 Supply Integrity

SRC SHALL only be created through protocol-defined minting procedures.

No component SHALL mint SRC independently.

All issuance SHALL be auditable.

---

## 16.7 Deterministic Issuance

Given identical verified inputs, compliant implementations SHALL produce identical minting results.

Minting behavior SHALL remain deterministic.

---

## 16.8 Fraud Prevention

The protocol SHALL prevent:

- Double minting
- Replay attacks
- Duplicate Proofs
- Invalid measurements
- Unauthorized issuance

---

## 16.9 Economic Independence

This specification defines protocol economics only.

It does not prescribe:

- Market value
- Exchange mechanisms
- Trading platforms
- Price discovery

These are external to the protocol.

---

## 16.10 Future Extensions

Future protocol versions MAY introduce:

- Incentive mechanisms
- Staking
- Delegation
- Reward distribution
- Fee models

Such extensions SHALL preserve compatibility whenever possible.

---

## 16.11 Requirements Summary

Every compliant implementation SHALL satisfy the following requirements.

- SRC MUST be minted only after successful protocol validation.
- 1 MWh of verified production MUST correspond to 1 SRC.
- Token issuance MUST be deterministic.
- Unauthorized minting MUST be impossible.
- All issuance MUST be auditable.

---

## 16.12 Founder Allocation & Vesting

Fixed economic model (single variant, no alternatives):

- **Allocation**: 20% of `MAX_SUPPLY_ATOMIC` (1e18) = **2e17 atomic = 200,000,000 SRC** (`FOUNDER_ALLOCATION_ATOMIC`).
- **Beneficiary / owner of the ATA**: `FOUNDER_WALLET` = `6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8`.
- **Premine at launch**: tokens are minted to the founder ATA (owner = `FOUNDER_WALLET`) once, during protocol launch, via `allocate_founder`. The premine:
  - is counted in `vault.total_supply`;
  - MUST NOT exceed `MAX_SUPPLY_ATOMIC` (guarded by `SupplyLimitExceeded`);
  - is strictly one-shot (guarded by `TokenMint.founder_minted` flag and `FounderPremineAlreadyMinted`);
  - is minted only by `FOUNDER_WALLET` (payer) into an ATA owned by `FOUNDER_WALLET`.
- **Vesting** on the same founder ATA blocks withdrawal until the cliff:
  - `FOUNDER_VESTING_CLIFF` = 1 year (`365*24*60*60`) — fully locked, zero tokens;
  - `FOUNDER_VESTING_RELEASE` = 3 years (`3*365*24*60*60`) — linear release (≈1/36 per month);
  - full cycle = CLIFF + RELEASE = 4 years; after 4 years everything is unlocked.
- **claim_vested** performs a REAL `token::transfer` from the founder ATA to the founder's destination ATA. The source is strictly the founder ATA (controlled by the program), so tokens cannot be withdrawn early. The claimable amount is bounded by the vested schedule minus already withdrawn amounts.

> **Runtime-testing note:** `claim_vested` after the cliff is covered at the LOGIC level by the unit invariant test `claim_transfer_moves_claimable_only` (`state/vesting.rs`). The runtime TS baseline (`tests/founder-vesting.ts`) covers `initialize_token`, `allocate_founder`, `initialize_founder_vesting` and will fire `claim_vested` once the on-chain Clock passes the cliff — a standard Solana practice (TS tests cannot warp the Clock on localnet; trust in Clock on mainnet).

After the premine `vault.total_supply = 2e17`; it is used by `energy_per_src` / `supply_fraction`, so the starting emission difficulty already accounts for the occupied supply share.

## 16.13 Governance Emission (`governance_mint`, ADR-0009)

Post-premine issuance is **only** possible through governance (ADR-0009). Mint
authority remains the PDA `[b"mint-authority"]` — it is **never** changed.

Governance model (MVP):

- **Roles**: `authority` (owner; creates proposals, manages `members`) and
  `members` (3..=5 addresses with voting rights).
- **Proposal**: `id`, `proposer`, `title` (≤ 64 bytes), `amount_atomic`,
  `destination` (ATA, owner == proposer, mint == SRC mint), status
  (Pending/Approved/Rejected/Cancelled/Executed), `created_at`,
  `approved_at`, `executed_at`, `yes_votes`, `no_votes`,
  `member_snapshot_count`, `voted_members`.
- **Quorum**: `yes > no` AND `yes + no > member_snapshot_count / 2` →
  `Approved` (+ `approved_at`). All members voted without quorum → `Rejected`.
- **Timelock**: `TIMELOCK_DELAY = 604_800 s` (7 days) between `approved_at`
  and execution.
- **Emission cap**: `PROPOSAL_AMOUNT_MAX_ATOMIC = 1e15` per proposal
  (0.1% of `MAX_SUPPLY_ATOMIC`); total checked against
  `vault.max_supply` (`total_supply + amount <= max_supply`).

Flow: `create_proposal (authority)` → `vote (members)` → wait `TIMELOCK_DELAY`
→ `governance_mint` → CPI `token::mint_to` (signed by mint-authority PDA)
directly to the destination ATA, `vault.total_supply` incremented, proposal
`Executed`.

> **Runtime-testing note:** the full pass «Approved → 7 days → Executed»
> cannot be run in TS (no Clock warp). It is covered by the unit invariant
> `approved_after_majority_and_timelock` (`state/governance.rs`); the TS
> baseline (`tests/governance.ts`) verifies `governance_mint` fails with
> `TimelockNotElapsed` when called immediately after approval.


