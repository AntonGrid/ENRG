ENRG — MVP Release Readiness Status

**Date:** 2026-08-04
**Status:** ready for localnet/devnet deployment (mainnet deferred)

---

## 1. Summary

The ENRG Protocol repo is clean and its security fixes (C-1..C-4) are resolved and
verified. Build and unit test suites are green. Remaining items are limited to
deployment planning (network targeting, program keys) and pending TS integration
tests that require a configured localnet/devnet environment.

---

## 2. Readiness Checklist

| Area | Item | Status | Notes |
|------|------|--------|-------|
| Build | `anchor build --ignore-keys` | OK | 9 cosmetic (enrg-profile) + 1 doc-comment (enrg-mvp) warnings |
| Security | C-1 Cross-device report substitution | Resolved | `producer.device_id == report.device_id` -> `DeviceMismatch` |
| Security | C-2 Foreign TokenAccount owner | Resolved | `owner == authority` -> `UnauthorizedTokenAccountOwner` |
| Security | C-3 Dummy Merkle verification | Resolved | real `compute_merkle_root` + `position: u8`, `InvalidProof`, in-house SHA-256 |
| Security | C-4 Weak seed invariant | Resolved | seed keyed on `device_id` |
| Security | Security Review Report | Done | `docs/SECURITY_REVIEW_REPORT.md` committed |
| Tests | Rust `cargo test --workspace` | 61 + 1 passed | 0 failed (incl. tiers/ERS/pool/governance/vesting/decimals invariants) |
| Tests | Python `test_tokenomics_extended.py` | All passed | incl. 3 Merkle tests |
| Tests | TypeScript integration (`tests/*.ts`) | OK | `anchor test --skip-build`: 48 passing / 4 pending (см. STATE.md, раздел 6) |
| Tests | `anchor test --skip-build` (localnet) | OK | 48 passing / 4 pending; новые: trust-ers-pool.ts, founder-vesting vesting-init |
| Spec | v7.0 §15 Trust Levels | Implemented | tier + месячные лимиты, `set_device_tier`, `allows_increment` |
| Spec | v7.0 §16/§27 ERS | Implemented | Reputation PDA, штрафы аномалий, премиум-заглушка |
| Spec | v7.0 §14 Pool distribution | Implemented | 1 МВт·ч порог, пропорциональные доли, ERS-взвешивание |
| Spec | v7.0 §22 Governance | Implemented (MVP) | пути эмиссии зафиксированы (ADR-0009 tighten) |
| Conformance | Supported Protocol Version / Spec Revision | Declared | `docs/specifications/ENRG_Conformance.md` §6 |
| Verify | Devnet verify-only (`scripts/devnet_verify_governance.ts`) | **Divergent** | задеплоена старая ревизия: `vault.max_supply=1e9`, governance/vesting/премайн отсутствуют — см. `docs/DEVNET_VERIFICATION.md` |
| Repo | Working tree clean / pushed | Clean | `HEAD` synced with `origin/main` |

---

## 3. Open Items / Risks

| # | Risk | Impact | Recommendation |
|---|------|--------|----------------|
| R-1 | Solana CLI RPC points at **mainnet-beta** while Anchor uses **localnet** | Unintended mainnet deploy / confusion | Switch CLI to localnet/devnet before any deploy |
| R-2 | Program IDs differ per cluster; `enrg_profile` keypair does not match declared localnet ID | Upgrade-authority/deploy mismatch | Use `anchor keys sync` with a canonical keypair only when preparing a real deploy |
| R-3 | Program keypairs not yet stored securely for mainnet | Cannot manage/upgrade mainnet program | Generate canonical keypairs, keep in vault/HSM, add to `.gitignore` (done) |
| R-4 | TS integration tests not run | Verify cross-stack behavior before release | Configure localnet validator, run `ts-mocha` suite |
| R-5 | Mainnet key rotation / multisig for admin ops | Centralized control | Adopt multisig for mint/admin authority (V2) |

---

## 4. Deployment Plan (next steps)

1. **Switch Solana CLI off mainnet** before any deploy:
solana config set --url https://api.devnet.solana.com # or localhost for localnet

2. Confirm/select canonical program keypairs (do **not** `keys sync` until deploy time).
3. Run the TypeScript test suite against a local validator:
yarn ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts

4. Deploy to **devnet** as final dry-run before mainnet:
solana airdrop 2 <wallet> anchor deploy --provider.cluster devnet

5. **Mainnet** (deferred): generate secure keypairs, `anchor keys sync`, update all
ID references (IDL, types, scripts), multisig for authorities.

---

*Status captured from the CI-equivalent local runs and git state on 2026-08-04.*
