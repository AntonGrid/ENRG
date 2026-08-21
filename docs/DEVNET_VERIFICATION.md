# Devnet Verification Report

**Document updated:** 2026-08-17 (final deploy after the audit — STEP 1)

---

## 0. FINAL DEPLOY — 2026-08-17 (final binaries after closing the P0 blockers)

**Initial state:** Devnet ran the version of commit `4dc805a`
(756,128 bytes for enrg-mvp), which did not include the final P0 fixes
(`59d43c3`, `61e6faa`: Policy Engine ADR-0003, key rotate/revoke ADR-0007,
`revoked`/`rotated_to` in EnergyProducer, etc. — +1254 lines in total).

**What was done (2026-08-17):**

1. Rebuilt the final binaries from HEAD (`61e6faa`):
   - `anchor build` → `target/deploy/enrg_mvp.so` (807,176 bytes,
     sha256 `b9c1dba556362e14d8a734bd4d14ae7e47d886cbf12edd0af78e8d24c828934e`);
   - `cargo build-sbf --manifest-path programs/enrg-profile/Cargo.toml` →
     `programs/enrg-profile/target/deploy/enrg_profile.so` (226,704 bytes,
     sha256 `991e51f1287af7e38cea68395ac2b5a575476eef976a22f72f5e433a0c58be84`).
2. Deploy (upgrade in place, authority `GkdhQQg…` — the local operator):
   - **enrg_mvp**: `solana program deploy --program-id HkuC3… target/deploy/enrg_mvp.so`
     — required growing programdata from 756,173 to 807,221 bytes;
     the programdata account was topped up to the new rent-exempt size (5.61914904 SOL).
     Deploy slot **484848801**.
   - **enrg-profile**: `solana program deploy --program-id 78FUdpHn… programs/enrg-profile/target/deploy/enrg_profile.so`
     — a 234,496-byte account (size preserved, binary written from the start;
     the first 226,704 bytes == the local .so). Deploy slot **484849385**.
3. IDL: `anchor idl upgrade --filepath target/idl/enrg_mvp.json HkuC3… --provider.cluster devnet`
   → The IDL account `BwMKxYtzQ87VDvhqyy3GCULLPeCgGAmnwd2jXLVSmuxP` (37,120 bytes) was updated
   (48 instructions, incl. `update_policy`, `rotate_device_key`, `set_device_tier`,
   `initialize_policy_registry`, etc.). The enrg-profile IDL is not stored on-chain
   (the local `idls/enrg_profile.json` is used, synced with the source).

### Verified addresses (current)

| Role | Address | State |
|---|---|---|
| Program ID (enrg_mvp) | `HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb` | ✔ executable, BPFLoaderUpgradeable |
| ProgramData (enrg_mvp) | `ARg2GmnWHMPXaMwv5RYNVhTw4F2NZSoEFUkyT1pBLX8M` | ✔ 807,176 bytes, slot 484848801 |
| Program ID (enrg-profile) | `78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt` | ✔ executable, BPFLoaderUpgradeable |
| ProgramData (enrg-profile) | `4bw9wRH6d4gDzMr6kNiNdbGyNAQ9N3pVPdL9WXs1Z79G` | ✔ 234,496 bytes, slot 484849385 |
| Upgrade authority | `GkdhQQgUBi2Q422nTBP27LADkejijRwJEAnfhPYsUJSV` | ✔ the local operator (`~/.config/solana/id.json`) |
| Deployed binary (enrg_mvp) | sha256 `b9c1dba5…` | ✔ == the local HEAD build |
| Deployed binary (enrg-profile) | sha256 `991e51f1…` (first 226,704 bytes) | ✔ == the local HEAD build |
| IDL account (enrg_mvp) | `BwMKxYtzQ87VDvhqyy3GCULLPeCgGAmnwd2jXLVSmuxP` | ✔ owner == enrg_mvp, updated |

### E2E test (2026-08-17, `scripts/devnet_e2e_lifecycle.ts`)

Run:
```
RPC_ENDPOINT=https://api.devnet.solana.com \
ENRG_PROGRAM_ID=HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb \
ENRG_PROFILE_PROGRAM_ID=78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt \
yarn ts-node scripts/devnet_e2e_lifecycle.ts
```

Result: **exit 0 — E2E PASSED ✔** (49.75s)

| Step | Result |
|---|---|
| bootstrap (token/vault/funds/oracle-registry/manifest-registry/config) | ✔ idempotent (accounts already existed) |
| add_oracle (a new Ed25519 oracle) | ✔ |
| register_device | ✔ |
| claim_device (owner = the operator) | ✔ |
| provision_device | ✔ |
| activate_device | ✔ |
| init_energy_profile | ✔ (the profile existed) |
| update_metadata (rated_power) | ⚠️ skipped — a legacy profile with rated_power=1e9 (> the 1 MW limit, immutable M-4) |
| user ATA | ✔ |
| mint_energy (v0 + Address Lookup Table, 2× Ed25519, CPI record_production) | ✔ sig=`4kkPKZFphycXzM1cKpY3FsDDvG8p2RJiGY3NuSKW15vDcqhsGCq8F7Z5821o8ZuMFiUUhkSAZ1HiawSEQUwQHVAe` |
| Check: producer state=active, nonce=1, energy_wh=90000 | ✔ |
| Check: owner reward | ✔ user ATA `HbR9V23hUPqSRGguREgei94m8r5PcafSskRk6NZ5kCwK` = 36 raw SRC units; vault.total_supply 2e17+63 → 2e17+99 |

### Fixes after the E2E (2026-08-17)

1. **OracleRegistry.oracle_admin** had been set to the founder wallet (`6gM2eE…`)
   by the old initialization; the E2E adds the oracle on behalf of the operator (`GkdhQQg…`).
   → `set_oracle_admin(GkdhQQg…)` signed by the founder (tx `2qiT4zVz…`). The role
   oracle_admin is administrative, not the oracle itself.
2. **The E2E script** (`scripts/devnet_e2e_lifecycle.ts`): the `update_metadata` step
   became idempotent with respect to the existing owner profile:
   - power 0 → sets `RATED_POWER` (1 MW);
   - power == `RATED_POWER` → an idempotent retry (type/location);
   - legacy power ≤ 1 MW → a retry with the previous power;
   - legacy power > 1 MW (invalid for the new code) → skip with a warning.
   This does not change on-chain logic — it makes the E2E suitable for repeated runs
   on live devnet with persistent PDAs.

### Oracle (2026-08-17)

- Restarted cleanly (`node server.js`, RPC devnet, the founder key via
  `FOUNDER_KEY_PATH` — no `FOUNDER_KEY` in env, audit H-1 satisfied).
- Startup log: `✅ Loaded enrg_mvp IDL`, `🚀 Oracle server listening on port 3000`.
- `/health` → `{"status":"ok"}`; `/api/v1/stats` → `{"total_energy_mwh":0.02,"active_producers":6,…}`.
- ⚠️ `ORACLE_KEY_PATH` is unset — the oracles own HTTP mint is unavailable
  (does not affect the E2E: it calls `mint_energy` directly with its generated
  oracle from the OracleRegistry).

---

## 1. Historical report (2026-08-13) — Governance & Vesting Chain (v7.1)

**Run:** `RPC_ENDPOINT=https://api.devnet.solana.com yarn ts-node scripts/devnet_verify_governance.ts`
**Mode:** verify-only (read-only, no `sendTransaction`)
**Result:** **exit 0 — ALL CHECKS PASSED ✔**

### 1.1 Verified addresses

| Role | Address | Result |
|---|---|---|
| Program ID (enrg_mvp) | `HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb` | ✔ exists, executable, owner BPFLoaderUpgradeable |
| ProgramData | `ARg2GmnWHMPXaMwv5RYNVhTw4F2NZSoEFUkyT1pBLX8M` | ✔ layout ProgramData, slot `483455693` |
| Upgrade authority | `GkdhQQgUBi2Q422nTBP27LADkejijRwJEAnfhPYsUJSV` | ✔ matches the expected one |
| Deployed binary | sha `6db33ae00784c342…` | ✔ == the local build (`target/deploy/enrg_mvp.so`) |
| Vault PDA `[b"vault"]` | `2iU7aMr7baDPo4JHjxS9nQ1UGEs4YUfUbh6JUkxyURSG` | ✔ owner == program, authority == GkdhQQ…, `max_supply = 1e18` |
| TokenMint PDA `[b"token-mint"]` | `FMM79f7gcTvzPSodQEjRTxfmpXeXB4ryPStn8xciYaFN` | ✔ owner == program, decodes with the current IDL, decimals=9 |
| SRC Mint `[b"src-mint"]` | `3PDsZUDQwgx1SV4dSTtyKDEoL9HYCdt4GN63UBYpLvwB` | ✔ SPL Token, decimals=9, mint-authority == PDA `[b"mint-authority"]` |
| Founder wallet | `6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8` | ATA `ADxgPYdZJCp2Jj9XbA32beKGwnbVMENAtxeFCfG8RECZ` ✔, balance == 2e17 |
| Vesting (bootstrap) | `B5uSLeaX2keRGbkxZA1Tyb7dFwNpY7DUbVu8TgvdiMAh` | ✔ owner == program, len=88, founder/cliff/release correct |
| Governance PDA `[b"governance"]` | `52WsktRAXpRaKAt2BCNZfXRBhp8MnU87HutXdSCsnHRn` | ✔ authority == GkdhQQ…, members=3 |

## 1.2 Confirmed invariants (✔)

- Devnet RPC is available (solana-core 4.2.0).
- The program is deployed, the loader is BPFLoaderUpgradeable, upgrade authority = `GkdhQQ…`.
- **`deployed binary == local build`** (SHA-256 `6db33ae…` matches).
- Vault: owner — the program, `authority == GkdhQQ…`, **`max_supply == MAX_SUPPLY_ATOMIC (1e18)`**, `total_supply ≤ max_supply`.
- TokenMint: owner — the program, decodes with the current IDL (238 bytes), `decimals == 9`,
  `mint == src-mint`, `mint_authority == [b"mint-authority"]`.
- SRC mint: `decimals == 9`, mint-authority == PDA, **`supply == vault.total_supply`** (both = 2e17).
- The founder ATA exists, balance == 2e17 (premine), `vault.total_supply` accounts for the premine.
- Vesting: the genesis/bootstrap account is in place, `founder == FOUNDER_WALLET`,
  `total_amount == 2e17`, `cliff == 1y`, `release == 3y`, `start_time > 0`, `withdrawn ≤ vested`.
- Governance: the PDA exists, `authority == GkdhQQ…`, `members` in the 3..=5 bounds.
- Proposal history: none (counter = 0) — allowed.
- `vault.total_supply ≤ MAX_SUPPLY_ATOMIC`, `src-mint.supply ≤ MAX_SUPPLY_ATOMIC`.

## 1.3 What was done to update Devnet (historical note)

1. **Blocker: a vesting genesis cannot be created on devnet** (genesis injection
   exists only in `solana-test-validator`; an off-chain `createAccount` to a PDA address
   is impossible, zero data → `AccountDiscriminatorMismatch 3002`).
   → Code fix `e455cb7`: `initialize_founder_vesting` got a bootstrap path
   (`init_if_needed` + seed `[b"founder-vesting"]`); the genesis path is kept.
2. **Blocker: old accounts of the old revision** (`vault.max_supply=1e9`,
   `token-mint` 205 bytes, no close/migrate) → cannot be reinitialized
   under the same program id.
   → Strategy A (approved by the author): a **new program id** `HkuC3…` with fresh PDAs.
3. Deploy: `solana program deploy` (slot `483455693`, authority `GkdhQQ…`).
4. Re-initialization: `scripts/devnet_reinit_lifecycle.ts` (token → vault →
   funds → premine → vesting → governance) — **ALL OK**.
5. Re-verify: **exit 0, all ✔** (this document).

## 1.4 Legacy

The old program id `9rVoqWPSRQpMN8qbqD9DfMTUcs1qXDELZPF1eVGowsXF` is archived
(old revision: `vault.max_supply=1e9`, `token-mint` 205 bytes, no
governance/vesting/premine). No canonical links; the chain is not deleted,
but is unused.

*Full run output is in the launch terminal (0 ✘, all ✔).*

