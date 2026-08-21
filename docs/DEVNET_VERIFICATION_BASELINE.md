# Devnet Verification — Baseline (constants and PDAs)

> Working document for the verify-only check of the governance/vesting/premine chain
> on Devnet (`scripts/devnet_verify_governance.ts`).
>
> Values are verified against `programs/enrg-mvp/src/` and `docs/STATE.md`
> at the v7.1 deploy (new program id `HkuC3…`, block 8+). The code is the source of truth.
>
> **The old program id `9rVoqWPSRQpMN8qbqD9DfMTUcs1qXDELZPF1eVGowsXF` is archived**
> as a legacy devnet experiment (old revision: `vault.max_supply=1e9`, no
> governance/vesting). There are no canonical links to it.

## Addresses

| Role | Address | Comment |
|---|---|---|
| Program ID (enrg_mvp) | `HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb` | `declare_id!` in `lib.rs` |
| ProgramData | `ARg2GmnWHMPXaMwv5RYNVhTw4F2NZSoEFUkyT1pBLX8M` | = `findProgramAddress([program_id], BPFLoaderUpgradeable)`; slot `483455693` |
| Authority (devnet) | `GkdhQQgUBi2Q422nTBP27LADkejijRwJEAnfhPYsUJSV` | `~/.config/solana/id.json` (local) |
| Founder wallet | `6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8` | `~/.config/solana/founder-wallet.json` (local) |
| Governance member | `6YW9kjHu8B79F1utcK6N4Bi1wBaTsTvBei49znDQjKH2` | `~/.config/solana/governance-member.json` (local) |

## Constants (verified against `constants.rs`)

| Constant | Value |
|---|---|
| `MAX_SUPPLY_ATOMIC` | `1_000_000_000_000_000_000` (1e18) |
| `SRC_DECIMALS` | `9` |
| `FOUNDER_ALLOCATION_ATOMIC` | `200_000_000_000_000_000` (2e17) |
| `FOUNDER_VESTING_CLIFF` | `365*24*60*60` = 1 year |
| `FOUNDER_VESTING_RELEASE` | `3*365*24*60*60` = 3 years |
| `FOUNDER_VESTING_DURATION` | CLIFF + RELEASE = 4 years |
| `TIMELOCK_DELAY` | `604_800` (7 days) |
| `GOVERNANCE_MEMBER_MAX` / `MIN_MEMBERS` | `5` / `3` |
| `PROPOSAL_AMOUNT_MAX_ATOMIC` | `1e15` |

## PDAs to check (derived via `findProgramAddress`, not hardcoded)

| Account | Seed | Expected owner | Check |
|---|---|---|---|
| `Vault` | `[b"vault"]` | enrg_mvp | exists; authority == `GkdhQQ…`; `max_supply == 1e18`; `total_supply ≤ max_supply` |
| `TokenMint` | `[b"token-mint"]` | enrg_mvp | exists; decodes with the current IDL; `mint == src-mint`; `mint_authority == [b"mint-authority"]`; `decimals == 9` |
| SRC Mint | `[b"src-mint"]` | SPL Token | `decimals == 9`; mint-authority == PDA `[b"mint-authority"]`; supply == `vault.total_supply` |
| Mint Authority | `[b"mint-authority"]` | — (PDA signer) | the address is deterministic; used as the mint-authority |
| Fund: buyback/staking/dao/emergency | `[b"fund-*"]` | — | addresses are deterministic (optional) |
| `GovernanceState` | `[b"governance"]` | enrg_mvp | exists; `authority == GkdhQQ…`; members 3..=5 |
| `Proposal` | `[b"proposal", id.to_le_bytes()]` | enrg_mvp | for id 1..proposal_count: status/amount ≤ 1e15/destination; timelock fields |
| `FounderVesting` | genesis account `B5uSLeaX2keRGbkxZA1Tyb7dFwNpY7DUbVu8TgvdiMAh` (= `findProgramAddress([b"founder-vesting"])`) | enrg_mvp | exists; `founder == FOUNDER_WALLET`; `total_amount == 2e17`; `cliff == 1y`; `release == 3y`. On Devnet it is created by the bootstrap instruction `initialize_founder_vesting` (init_if_needed), not by genesis injection |
| Founder ATA | `getAssociatedTokenAddress(src-mint, FOUNDER_WALLET)` | SPL Token | balance == 2e17 (after the premine) |

## Invariants (final)

- `vault.total_supply ≤ MAX_SUPPLY_ATOMIC` (1e18).
- The founder premine is accounted in `vault.total_supply` and in the founder ATA balance.
- The vesting account is consistent (founder, amounts, cliff/release).
- Governance is valid: the authority matches, members in the 3..=5 bounds, proposals within the cap and timelock.

## Meta-rule

The script is **verify-only**: read-only (`getAccountInfo`/deserialize), without
`sendTransaction`. Any actual deviation from the baseline is recorded in
the report (`docs/DEVNET_VERIFICATION.md`) and in `docs/STATE.md` — without "fixing"
via mutating transactions.

