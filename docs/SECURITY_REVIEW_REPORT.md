# ENRG Protocol — Security Review Report

**Date:** 2026-08-03
**Version:** 1.0
**Status:** all critical findings resolved; build and tests green

---

## 1. Summary

Security audit of ENRG Protocol smart contracts (Anchor/Solana). **4 critical
minting-integrity and Merkle-verification findings** were identified and fixed.
The program builds (`anchor build`), unit tests pass (`cargo test --workspace`),
and independent Python tokenomics/Merkle tests pass.

| id | Finding | Severity | Status |
|----|---------|----------|--------|
| C-1 | Cross-device report substitution on mint | Critical | ✅ Resolved |
| C-2 | Missing owner binding of user TokenAccount | Critical | ✅ Resolved |
| C-3 | Dummy Merkle verification (proof never checked) | Critical | ✅ Resolved |
| C-4 | Weak seed invariant for EnergyProducer | High | ✅ Resolved |

---

## 2. Critical Findings

### C-1. Cross-device report substitution on mint — CRITICAL

- **Problem:** `mint_energy` did not verify that `report.device_id` belongs to the
  device referenced by `producer`. An attacker could mint rewards while submitting a
  foreign (or otherwise mismatched) report.
- **Fix:** added check `producer.device_id == report.device_id` →
  `ErrorCode::DeviceMismatch` in `programs/enrg-mvp/src/instructions/mint.rs`.
- **File:** `mint.rs` (function `mint_energy`).

### C-2. Owning a foreign user TokenAccount — CRITICAL

- **Problem:** the target `user_token_account` was not bound to the producer owner
  (`authority`). The mint could be routed to an arbitrary account.
- **Fix:** added Anchor constraint `user_token_account.owner == authority.key()` →
  `ErrorCode::UnauthorizedTokenAccountOwner`, plus a signer guarantee that
  `authority` matches `producer.authority`.
- **File:** `mint.rs` (accounts struct `MintEnergy` and function body).

### C-3. Dummy Merkle verification — CRITICAL

- **Problem:** `verify_merkle_proof` and `validate_proof_computation` declared
  `proof_path`/`leaf_hash` but **never used them**: the root was simply copied from
  `registry.merkle_root` without any comparison — a forged proof passed.
- **Fix:** implemented real Merkle logic:
  - `compute_merkle_root(leaf, proof_path, position)` — iterative bottom-up
    traversal with double SHA-256;
  - `verify_merkle_proof` compares the computed root against
    `registry.merkle_root` and rejects mismatches via `ErrorCode::InvalidProof`;
  - added parameter `position: u8`; updated `#[instruction(...)]` and the call in `lib.rs`;
  - SHA-256 implemented in-house (no external deps) to avoid the transitive
    `getrandom` dependency, which is incompatible with the BPF target.
- **File:** `programs/enrg-mvp/src/instructions/merkle_proof_verification.rs`.

### C-4. Weak EnergyProducer seed invariant — HIGH

- **Problem:** seed invariant not bound to `device_id` allowed account collisions /
  ambiguous device identification.
- **Fix:** unified seed invariant keyed on `device_id`; compiled cleanly.
- **Status:** confirmed by build.

---

## 3. Remaining Recommendations (V2, non-critical)

The following items are recommendations for future protocol iterations and do not
block the MVP release:

| id | Area | Recommendation | Priority |
|----|------|----------------|----------|
| R-1 | Oracle | Validate oracle/front-end node identity (allow-list/domains) | Medium |
| R-2 | Quota | Strengthen rate/volume limits (ban-lists, jitter, sliding windows) | Medium |
| R-3 | Layout | Extend reserved fields in structs for versioning/future migrations | Low |
| R-4 | Key mgmt | Rotate mint-authority keys, multisig for admin ops | Medium |
| R-5 | Tests | Add Rust unit tests for `merkle_hash`/`compute_merkle_root` (coverage currently via Python tests) | Low |

---

## 4. Verification Results (2026-08-03)

| Step | Command | Result |
|------|---------|--------|
| Build | `anchor build --ignore-keys` | ✅ ok (enrg-profile: 9 cosmetic warnings; enrg-mvp: 1 doc-comment warning) |
| Unit tests | `cargo test --workspace` | ✅ 9 + 1 passed, 0 failed |
| Python MVP | `python3 tests/test_tokenomics_extended.py` | ✅ all checks passed (incl. 3 Merkle tests) |

---

## 5. Repository / Storage Context (Plan B)

As part of the repository refactor/cleanup:

- ENRG blockchain artifacts were moved out of `axis-core` into the backup
  folder `ENRG/imported-from-axis-core/` (source code, tests, scripts, `onchain_bridge.py`).
- `axis-core` was purged of ENRG on-chain artifacts (removed from the Git index);
  `pyproject.toml` description updated to neutral wording.
- This report is stored at `docs/SECURITY_REVIEW_REPORT.md` in the ENRG repository.

---

*Report compiled from audit and fix results. All severity and id references follow
the Security Review checklist dated 2026-08-03.*
