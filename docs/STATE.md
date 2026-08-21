# ENRG — Current State (STATE)

> **Single source of truth** about the current state of the ENRG protocol
> implementation (Anchor 0.32, Solana) before Devnet/mainnet.
>
> All numeric values below are **verified against the source code**
> (`programs/enrg-mvp/src`) at the moment of writing. If this document and the
> code ever disagree — the code is the source of truth and this document must
> be updated.
>
> Cross-references: `docs/ENRG_Technical_Specification_v8.0.md`,
> `docs/protocol/blockchain/protocol-economics.md`, and this file.

## 1. Overview

**Implemented (in `programs/enrg-mvp`):**

| Module | Status | Basis |
|---|---|---|
| SRC tokenomics (mint, supply limits, atomic units) | ✅ Implemented | `constants.rs`, `state/token_mint.rs`, `state/vault.rs` |
| Founder premine + vesting (cliff 1y / release 3y) | ✅ Implemented | `instructions/init_founder.rs`, `instructions/vesting.rs`, `state/vesting.rs` |
| Governance MVP (ADR-0009) | ✅ Implemented | `instructions/governance.rs`, `state/governance.rs` |
| Device registry / device lifecycle (ADR-0002/0005) | ✅ Implemented | `instructions/device_lifecycle.rs`, `state/owner_devices.rs` |
| Manifest registry / merkle verification | ✅ Implemented | `instructions/manifest_registry.rs`, `manifest_verification.rs`, `merkle_proof_verification.rs` |
| Policy Engine (ADR-0003) | ✅ **Implemented** | `instructions/policy_engine.rs`, `state/policy.rs` (PolicyRegistry, PDA `[b"policy-registry"]`); `mint_energy` — the Verifier, executes policies |
| OTA + secure updates (ADR-0008) | ✅ Implemented | Firmware v3: image signing with a **separate cold firmware key** (`ENRG_FIRMWARE_PUBKEY_HEX`), SHA-256, anti-rollback (NVS + optional eFuse); dual-bank A/B (`partitions_ota.csv`) + monotonic eFuse (`esp32dev-ota`); server: `FIRMWARE_SIGNING_KEY_PATH` |
| Hardware device signing (ADR-0001/0007) | ⚠️ Partial | SE050 path (hardware Ed25519, `esp32dev-se050`) + a documented compromise (ATECC608A seed-vault, CPU signing) — `SE050-HARDWARE-SIGNING.md` |
| Multisig for `set_vault_authority` / timelock changes | ⏸️ Deferred (TODO(audit)) | `instructions/initialize.rs` |

Emission principle: post-premine emission **only** through governance;
`mint-authority` = PDA `[b"mint-authority"]` and is **never changed**.

## 2. Addresses and roles

| Role | Address | Where the key lives |
|---|---|---|
| Program ID (enrg_mvp) | `HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb` | `declare_id!` in `lib.rs`; `Anchor.toml [programs.*]` |
| **Authority (Devnet/mainnet, operator)** | `GkdhQQgUBi2Q422nTBP27LADkejijRwJEAnfhPYsUJSV` | **Locally**: `~/.config/solana/id.json` — NOT in the repository |
| **Founder wallet** (premine, vesting) | `6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8` | **Locally**: `~/.config/solana/founder-wallet.json` — NOT in the repository |
| **Governance member (genesis)** | `6YW9kjHu8B79F1utcK6N4Bi1wBaTsTvBei49znDQjKH2` | **Locally**: `~/.config/solana/governance-member.json` — NOT in the repository |
| enrg-profile (CPI target) | `78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt` | `constants.rs::ENRG_PROFILE_PROGRAM_ID` |

PDA addresses are deterministic (section 4) and are derived in tests/scripts via
`PublicKey.findProgramAddressSync`, never hardcoded.

> **Secrets.** The authority and founder private keys are NOT in the repository
> (`git ls-files` contains no keypair; `deploy/`, `*.key` — in `.gitignore`).
> Program deploy keys (`deploy/keys/*.json`) are local and untracked.


## 3. Constants (verified against `constants.rs`)

All amounts are in **atomic units** (1 SRC = `10^9` atomic = `SRC_DECIMALS=9`).

| Constant | Value | Comment |
|---|---|---|
| `MAX_SUPPLY_ATOMIC` | `1_000_000_000_000_000_000` (1e18) | = 1 billion SRC. `MAX_SUPPLY` — deprecated alias |
| `SRC_DECIMALS` | `9` | |
| `FOUNDER_ALLOCATION_ATOMIC` | `200_000_000_000_000_000` (2e17) | = 20% of MAX = 200M SRC |
| `FOUNDER_VESTING_CLIFF` | `365*24*60*60` = 1 year | Fully locked |
| `FOUNDER_VESTING_RELEASE` | `3*365*24*60*60` = 3 years | Linear release (≈1/36 per month) |
| `FOUNDER_VESTING_DURATION` | CLIFF + RELEASE = **4 years** | Backward-compatible total |
| `TIMELOCK_DELAY` | `604_800` (7 days) | Between `approved_at` and execution |
| `GOVERNANCE_MEMBER_MAX` | `5` | |
| `GOVERNANCE_MIN_MEMBERS` | `3` | |
| `PROPOSAL_AMOUNT_MAX_ATOMIC` | `1_000_000_000_000_000` (1e15) | = 1M SRC = 0.1% of MAX |
| `PROPOSAL_TITLE_MAX_LEN` | `64` | bytes |
| `MAX_DEVICES_PER_OWNER` | `100` | audit BLOCK 4 |
| `EMISSION_DIFFICULTY_K` | `10` | asymptotic difficulty |

Supply guarantees: `vault.max_supply = MAX_SUPPLY_ATOMIC` (`initialize_vault`);
every emission (`allocate_founder`, `governance_mint`, `mint_energy`) checks
`total_supply + amount <= max_supply` (`SupplyLimitExceeded`).

## 4. PDA structure

All PDAs are owned by **enrg_mvp** (`HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb`)
unless noted otherwise.

| Account | Seed | Initialization | Where in code |
|---|---|---|---|
| `Vault` | `[b"vault"]` | `init_if_needed` / `initialize_vault` | `state/vault.rs` |
| `TokenMint` | `[b"token-mint"]` | `init` / `initialize_token` | `state/token_mint.rs` |
| SRC Mint (SPL) | `[b"src-mint"]` | `init` / `initialize_token` | `instructions/initialize_token.rs` |
| Mint Authority (signer mint_to) | `[b"mint-authority"]` | `init` / `initialize_token` | same |
| Fund Authority: buyback | `[b"fund-buyback"]` | `init` / `initialize_token` | same |
| Fund Authority: staking | `[b"fund-staking"]` | fund ATAs are bound in `initialize_funds` | `instructions/initialize.rs` |
| Fund Authority: dao | `[b"fund-dao"]` | same | |
| Fund Authority: emergency | `[b"fund-emergency"]` | same | |
| `GovernanceState` | `[b"governance"]` | `init` / `initialize_governance` | `instructions/governance.rs` |
| `Proposal` | `[b"proposal", id.to_le_bytes()]` | `init` / `create_proposal` | same |
| `OracleRegistry` | `[b"oracle-registry"]` | `initialize_oracle_registry` | `state/registry/oracle.rs` |
| `Config` | `[b"config"]` | `init_config` | `state/config.rs` |
| `ManifestRegistry` | `[b"manifest-registry"]` | `initialize_manifest_registry` | |
| `ManifestVerification` | `[b"manifest-verification", manifest_id]` | `register_manifest_verification` | |
| `Producer` (device) | `[b"producer", device_id]` | `register_device` | `state/producer.rs` |
| `OwnerDevices` | `[b"owner-devices", owner]` | claim/register | `state/owner_devices.rs` |
| `EnergyProfile` | `[b"profile", authority]` — **owned by enrg-profile** | CPI `init_energy_profile` | `ENRG_PROFILE_PROGRAM_ID` |

**Special case — `FounderVesting`** (`state/vesting.rs`): since `e455cb7` the
account is created by the **bootstrap instruction** `initialize_founder_vesting`
(`init_if_needed` + seed `[b"founder-vesting"]`, payer = founder) — this is the
only path on Devnet/mainnet (genesis injection exists only in
`solana-test-validator`). For localnet the old path is kept: the account is
injected into the validator via `Anchor.toml [test.validator] account`
(`tests/genesis/founder-vesting.json`, address
`B5uSLeaX2keRGbkxZA1Tyb7dFwNpY7DUbVu8TgvdiMAh` =
`findProgramAddress([b"founder-vesting"])` of the program). `init_if_needed`
skips initialization of an existing account — both paths are backward
compatible.



## 5. Lifecycle

Release sequence (the same on localnet/Devnet; smoke coverage —
`tests/zz-e2e-smoke.ts`):

```
initialize_token            → SRC mint (PDA [b"src-mint"]), mint-authority = PDA [b"mint-authority"]
initialize_vault            → Vault (PDA [b"vault"]), max_supply = 1e18
allocate_founder            → premine 2e17 to the founder ATA (one-time), total_supply = 2e17
initialize_founder_vesting  → FounderVesting (bootstrap/init_if_needed; cliff 1y / release 3y)
initialize_governance       → GovernanceState (PDA [b"governance"]; authority + 3..=5 members)
create_proposal             → Proposal (PDA [b"proposal", id]); one active, amount ≤ 1e15
vote                        → quorum: yes > no AND yes+no > members/2 → Approved (+approved_at)
governance_mint             → after TIMELOCK_DELAY (7 days): mint_to via the mint-authority PDA
```

`governance_mint` can only be executed after `Approved` + the expired timelock
(otherwise `TimelockNotElapsed`); `vault.total_supply` grows,
`Proposal.status → Executed`.

## 6. Test status

- **Anchor TS (localnet):** `anchor test --skip-build` — green run
  (incl. `tests/zz-e2e-smoke.ts`, `tests/trust-ers-pool.ts` — Trust
  Levels/ERS/Pool, `tests/founder-vesting.ts` — now with the runtime test of
  `initialize_founder_vesting`).
- **Rust unit:** `cargo test --manifest-path programs/enrg-mvp/Cargo.toml --lib`
  — green (61; incl. vesting/governance unit invariants, tier
  limits/`allows_increment`, ERS math, pool shares, the emission formula
  `E(S)=1 MWh×10^S`, decimals/15% commission).
- **Documented skips:**
  - `it.skip` in `tests/governance.ts` — a full `governance_mint` pass after
    7 days (Clock-warp impossible; covered by the unit invariant
    `approved_after_majority_and_timelock`).
  - `describe.skip` in `tests/devnet-merkle-proof-verification.test.ts`
    (devnet-dependent).
- **Mint integration (tier limit in mint_energy, ERS update, pool deposit):**
  a runtime mint needs 2× Ed25519 + a v0/LUT transaction, which is unstable on
  localnet `anchor test` (web3.js 1.98 + solana 3.1.8, a false
  "invalid index"); the mint logic is covered by pure-function Rust unit tests
  (`can_mint`, `allows_increment`, `compute_ers_score`, `pool_share_fp`,
  `ers_pool_bonus_fp`), and the full on-chain mint — by
  `scripts/devnet_e2e_lifecycle.ts`.
- **Known technical debt (does NOT block the release):**
  - `8 × TS2339` in `tests/device-lifecycle.ts` (the `energyProducer` account
    namespace is not typed in the IDL).
  - Extra pre-existing TS errors: `tests/merkle-proof-verification.test.ts` (4),
    `tests/devnet-merkle-proof-verification.test.ts` (3),
    `tests/helpers/program.ts` (2), `tests/helpers/debug-program.ts` (2),
    `tests/probe10.test.ts` (1). The final `npx tsc --noEmit` base = **20 errors**;
    new tests add none.
  - `set_vault_authority` — a single-step change (TODO(audit): two-step +
    timelock/multisig).
- **Devnet — actual state (verify-only run, `scripts/devnet_verify_governance.ts`):**
  Checked on 2026-08-13 (after the strategy-A deploy): **Devnet fully matches
  the current code**, verify → **exit 0, all invariants ✔**:
  - New program id `HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb`, ProgramData
    `ARg2GmnWHMPXaMwv5RYNVhTw4F2NZSoEFUkyT1pBLX8M`, slot `483455693`, authority `GkdhQQ…`;
  - `deployed binary == local build` (SHA-256 `6db33ae…`);
  - `vault.max_supply == MAX_SUPPLY_ATOMIC (1e18)`, `vault.total_supply = 2e17`;
  - `token-mint` decodes with the current IDL (238 bytes), `decimals == 9`;
  - `src-mint.supply == vault.total_supply == 2e17`;
  - founder premine/ATA in place (balance 2e17), the vesting account was
    created by the bootstrap instruction `initialize_founder_vesting`
    (init_if_needed), the governance PDA is initialized (authority `GkdhQQ…`,
    members=3).
  **History:** the old program id `9rVoqWPSRQpMN8qbqD9DfMTUcs1qXDELZPF1eVGowsXF`
  (old revision: `vault.max_supply=1e9`, `token-mint` 205 bytes, no
  governance/vesting) is archived as legacy and unused. The id change reason:
  old PDA accounts (deterministic) cannot be reinitialized under the same id
  (no close/migrate), and vesting genesis cannot be created on devnet
  (solution — the code fix `e455cb7`).

## 7. Roadmap (added by upgrades, does not block the release)

- ~~**Policy Engine (ADR-0003)**~~ → **✅ Done (2026-08-17):** a separate
  on-chain `PolicyRegistry` (`state/policy.rs`) + `PolicyEngine`
  (`instructions/policy_engine.rs`); `mint_energy` — the Verifier executes
  Policy Engine decisions. The `policy_registry` account is optional in
  `MintEnergy` (backward compatibility: defaults = previous behavior).
- **Multisig + two-step authority change** for `set_vault_authority`
  (changing the Vault layout requires migrating the deployed account).
- **DAO** — extending governance MVP: delegation, weight-based voting, arbitrary
  instruction execution (currently only `governance_mint`).



