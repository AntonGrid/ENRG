# 0009 – Governance MVP (Enrg MVP)

*Status*: Adopted (MVP)  \
*Date*: 2026-08-13  \
*Authors*: ENRG Architecture WG  \
*Supersedes*: — (ADR-0003 Policy Engine is NOT implemented at this stage)

## Context

The `enrg-mvp` program (Anchor 0.32, Solana) has full tokenomics and
founder vesting (commit `ec7cf36`). The next stage is a base governance module
for controlled issuance of new tokens.

At this stage the full Policy Engine (ADR-0003) is **not** implemented. We introduce
a simple two-level model: `authority` (contract owner) + `members`
(a list of addresses with voting rights). All numbers are atomic units
(1 SRC = 1e9 atomic; MAX_SUPPLY_ATOMIC = 1e18). The mint-authority stays a PDA
`[b"mint-authority"]` and is **never changed**; emission is possible only through
`governance_mint`.

## Decision

### 1. Roles (two-level model)

- `authority` — the contract owner. Creates proposals (`create_proposal`),
  manages the member list (`update_members`).
- `members` — a list of addresses (3..=GOVERNANCE_MEMBER_MAX=5) allowed to
  vote (`vote`). Validation on every update: 3..=5 unique.

### 2. Timelock (MVP minimalism)

- `TIMELOCK_DELAY = 7 * 24 * 60 * 60 = 604_800` seconds.
- **One active proposal** at a time. When creating a new
  proposal, if one is active, the client must pass the previous
  one (`prev_proposal`) — it is automatically marked `Cancelled`.
  Without `prev_proposal` the creation is rejected (`ProposalNotActive`).
- After voting, if a quorum is reached — the proposal moves to
  `Approved` and is executed automatically `TIMELOCK_DELAY` after
  `approved_at`.

### 3. Quorum and voting

- One vote per member (the `voted_members` list).
- After each vote the quorum is checked:
  `yes > no` **AND** `yes + no > member_snapshot_count / 2`.
- If the quorum is reached → `Approved`, `approved_at` is recorded.
- If all snapshot members voted and there is no quorum → `Rejected`.

### 4. Emission (derived rights, NOT the mint authority)

- The mint-authority stays the PDA `[b"mint-authority"]` (as in `initialize_token`).
- The new `governance_mint` instruction: callable **only** for a proposal
  with `Approved` status whose `TIMELOCK_DELAY` has elapsed since
  `approved_at`. Executes the CPI `token::mint_to` (signer — the mint-authority PDA)
  directly to the recipient ATA (`destination`, mint == SRC mint,
  owner == proposer) and adds the amount to `vault.total_supply`
  (check `total_supply + amount <= max_supply`). On success — status
  `Executed`, `executed_at` is recorded.
- `PROPOSAL_AMOUNT_MAX_ATOMIC = 1e15` — the emission limit per proposal
  (0.1% of MAX_SUPPLY_ATOMIC).

### 5. Accounts (PDA seeds, initialized from TS)

Unlike `FounderVesting` (a genesis account), the governance accounts have
PDA seeds and are created via `init`:

- `GovernanceState` — PDA `[b"governance"]`.
- `Proposal` — PDA `[b"proposal", id.to_le_bytes()]`, where `id` is monotonic
  `proposal_count + 1`.

This lets us fully initialize and test the lifecycle
with runtime calls from TS (`tests/governance.ts`).

### 6. Execution flow

```
create_proposal (authority)
  → vote (members, >50% "for" with a quorum)  → Approved
  → wait TIMELOCK_DELAY (604_800 s)
  → governance_mint → tokens to the given ATA (Executed)
```

## Consequences

- Emission is impossible without a passed vote and the timelock.
- The mint-authority stays a PDA; the "emission only via governance_mint" principle
  holds (the founder premine is a one-time exception recorded by this ADR).
- One active proposal simplifies the MVP and rules out races.

## Runtime-testing

`tests/governance.ts` covers the localnet runtime:
`initialize_governance`, `update_members` (3..=5 bounds),
`create_proposal` (amount limit), `vote` (majority→Approved,
outsider/double votes rejected, minority→Rejected), `collision`
(auto-cancel via `prev_proposal`), `governance_mint`
(an immediate call → `TimelockNotElapsed`).

The full "Approved → 7 days → Executed" pass is **not tested at runtime**:
`approved_at` is fixed by the on-chain Clock; warp is impossible. It is covered
by the unit invariant `approved_after_majority_and_timelock`
(in `state/governance.rs`), which checks `executable(now)` at the boundaries
`approved_at + TIMELOCK_DELAY`.

## Roadmap

1. **MVP** (this ADR): authority + members, a 7-day timelock, governance_mint.
2. **Multisig + timelock**: authority → multisig, a configurable timelock.
3. **Full Policy Engine (ADR-0003) / DAO**: role mapping, per-type quorums
   for decisions, treasury redistribution.

## Tightening (v7.0 §22 conformance)

- **SRC emission paths (fixed):** only `mint_energy` (Proof-of-Production,
  PoP mining via the mint-authority PDA) and `governance_mint` (ADR-0009). No other
  mint path exists — a "non-governor mint" is impossible: the founder premine is
  a one-time exception (`founder_minted`), `set_vault_authority` does not change
  the mint-authority (the PDA `[b"mint-authority"]` is unchanged).
- **Governable params:** the economics parameters (`k`,
  15% commission, tier limits, `PROPOSAL_AMOUNT_MAX_ATOMIC`, fund treasuries) are still
  **code constants**, not votable. Plan: add a
  parameter registry to `GovernanceState` (a layout migration on upgrade) and
  vote on their changes via a separate proposal type — in the full DAO scope.
- **Full DAO path:** delegation, weight-based voting, execution of
  arbitrary instructions — beyond the MVP (see STATE.md, section 7).

