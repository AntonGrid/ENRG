# ENRG Mainnet Checklist

**Owner:** protocol core team · **Status:** work in progress (audit 2026-08-30)

Every item is a hard requirement for the mainnet launch. Checkboxes are
updated as the fixes land. The canonical audit report is
`Axis-workspace/MAINNET-AUDIT-2026-08-30.md`.

---

## 🔴 Critical

- [x] **P0-1 Key leak (d3664c1)** — `founder-wallet.json` removed from index,
      added to `.gitignore`, gitleaks CI added. _History still contains the key:
      `git filter-repo` is a separate, owner-approved operation._
- [ ] **P0-1a Rotate all protocol keys** — founder/deployer/oracle/firmware
      keys must be freshly generated. Program constants
      (`FOUNDER_WALLET`, `EXPECTED_DEPLOYER` — `programs/enrg-mvp/src/constants.rs`)
      and firmware `ENRG_FOUNDER_PUBKEY_HEX` / `ENRG_FIRMWARE_PUBKEY_HEX`
      (`esp32_proof_sender_v3.ino`) must be updated; program redeployed at a
      NEW program id with a fresh mint.
- [x] **P0-2 Sequential mint** — mint queue implemented in `server.js`
      (`MINT_QUEUE_MAX` / `MINT_MAX_ATTEMPTS` / `MINT_RETRY_BASE_MS`), proofs
      persist with `proof_json` + `mint_status='accepted'`, queue drains after
      restart, per-device interval gate (`DEVICE_MIN_INTERVAL_MS`). Tests:
      `tests/storage-queue.test.js`. _Batch via Merkle still on the roadmap._
- [x] **P0-3 Single oracle / single RPC** — RPC failover list (`RPC_ENDPOINTS`)
      with automatic rotation on RPC errors (503 instead of fake 404). _≥2
      independent oracle instances and key separation are ops decisions —
      documented, need deployment._
- [ ] **P0-4 Single-key governance** — vault/policy/oracle-registry/upgrade
      authorities behind a multisig (Squads), timelock on member updates.
- [ ] **P0-5 Independent security audit** — external review (Zellic/OtterSec/
      Halborn) of the final binaries before deployment.

## 🟠 High

- [x] **P1-1 Firmware mainnet build** — `[env:esp32dev-mainnet]` in
      `firmware/esp32_proof_sender/platformio.ini`: SE050-only (`conforming`),
      `ENRG_MANIFEST_REQUIRED=1`, A/B + eFuse anti-rollback, fail-closed at
      runtime (no NVS/ATECC fallback on mainnet) and `#error` at compile time
      when SE050 is missing. Secure boot v2 + flash encryption remain
      manufacturing steps (documented in `SE050-HARDWARE-SIGNING.md`).
- [x] **P1-2 OTA signing** — founder-key fallback removed from `server.js`
      (`/api/v1/firmware/update` returns 503 without the cold
      `FIRMWARE_SIGNING_KEY_PATH`).
- [x] **P1-3 AI attestation verification** — the landing now verifies the
      Ed25519 signature via WebCrypto before labeling an attestation "verified"
      (`enrg-landing/src/lib/aiOracle.ts`); cross-platform canonical bytes
      proven against ENRG-AI `canonical_json_bytes`.
- [x] **P1-4 PoI/ERS loop (collector)** — `scripts/ai_ers_collector.ts`:
      signed AI bundle → Ed25519 verify → severity (mirrors `ers_loop.py`) →
      rate-limited on-chain `report_anomaly` (oracle key). _Remaining for full
      production: per-device `device_id` in ENRG-AI anomaly signals + cron
      deployment + on-chain commitment PDA for contribution digests._
- [x] **P1-5 Mock tests vs real peg** — `tests/test_mainnet_critical.py` now
      mirrors `math.rs` (`energy_wh * SRC_BASIS / energy_per_src`) + peg tests
      `test_peg_one_mwh_equals_one_src` / `test_peg_fractional_mwh`.
- [x] **P1-6 EVM bridge hardening** — `onchain/src/EnrgOracleAttestation.sol`
      rewritten: k-of-n multi-oracle quorum, timelocked oracle/threshold
      changes, 2-step ownership transfer. 12 Foundry tests cover it.

## 🟡 Nice-to-have

- [ ] **P2-1 Load tests** — oracle benchmark (proofs/s, mint queue depth).
- [ ] **P2-2 CI for Axis-connect & ENRG-AI** — test workflows are missing.
- [ ] **P2-3 Browser wallet** — replace localStorage keypair with a
      browser-wallet extension adapter in Axis-connect.
- [ ] **P2-4 Mainnet runbook** — deploy steps (keys, anchor, IDL, oracle env,
      firmware, monitoring) + 30-minute local quickstart.

---
*Updated: 2026-08-30 (audit day 1).*
