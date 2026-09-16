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
- [ ] **P0-1a Rotate all protocol keys** — **DONE (2026-08-30):** fresh keys
      generated (`~/keys/enrg-mainnet`, 0600); program constants, oracle,
      firmware and local key files updated. Program still needs a mainnet
      deploy at a NEW program id (operator step).
      **Update (2026-09-16): the ON-CHAIN rotation is now complete on devnet.**
      The 2026-08-30 pass could not move three roles (no instruction existed):
      `6gM2…` still held `oracle-registry.authority`, `oracle_admin`,
      `policy-registry.authority`, `oracle-quorum-config.authority` and a
      governance seat. Fixed — see `docs/AUTHORITY-ROTATION-2026-09-16.md`.
      `scripts/verify-authorities.ts` now exits 0 (no leaked key holds a role);
      `founder-wallet.json` was retired to `~/keys/retired/` (mode 600).
      Cleanup of the leaked blob in git history (`git filter-repo`) is still
      pending and stays an owner-approved operation.
- [x] **P0-1b Unrotatable authority roles (code)** — the protocol had three roles
      with **no transfer instruction** (`OracleRegistry.authority`,
      `OracleQuorumConfig.authority`, `GovernanceState.authority`), which made any
      key ceremony — and any incident response — impossible. Added
      `set_oracle_registry_authority`, `set_quorum_authority` and
      `set_governance_authority` (gated by the CURRENT holder, event-emitting,
      layout-neutral), registered in `lib.rs` and executed on devnet
      (`docs/AUTHORITY-ROTATION-2026-09-16.md`). _Two-step (pending + accept)
      needs an account-layout migration — still open._
- [x] **P0-1c Mint ownership — the reward must reach the DEVICE OWNER** — the mint
      transaction had to be signed by `producer.authority` (`enrg-profile`
      `record_production` required the profile owner's signature), so the oracle
      could mint only for devices it owned itself and every minted SRC landed on
      the founder's ATA; a device claimed by a user wallet (Axis-connect) was
      unmintable (`NotProducerOwner`). Fixed by `record_production_authorized`
      (caller = the enrg-mvp `mint-authority` PDA), the new `producer_owner`
      account of `mint_energy`, and oracle-signed mint transactions in
      `server.js`. Proven on devnet by `scripts/devnet_mint_third_party.ts`
      (owner ≠ mint signer, SRC arrive on the owner's ATA) —
      `docs/OWNERSHIP-FIX-2026-09-16.md`. _Breaking change: clients must pass
      `producerOwner` to `mint_energy`._
- [x] **P0-1d Quorum semantics — a contradiction must not finalize** — every vote
      incremented `OracleAttestation.votes` and finalization used
      `votes >= threshold`, so with the shipped `threshold = 2` **one honest plus one
      contradicting oracle finalized the attestation**. Fixed: `votes` counts
      AGREEING votes only (pure, unit-tested `apply_vote` /
      `state/oracle_attestation.rs`), a contradicting vote is recorded
      (`conflict = true`) and emits `OracleConflictDetected {canonical_hash,
      conflicting_hash}` as on-chain-verifiable evidence for `slash_oracle`, and
      finalization is monotonic (a late conflict cannot revert it). Proven by 5 new
      unit tests (`programs/enrg-mvp/tests/oracle_quorum_tests.rs`, incl. the
      regression `conflicting_vote_never_counts_toward_the_threshold`) and on
      devnet (`scripts/devnet_quorum_conflict.ts`: `votes=1, conflict=true,
      finalized=false`), while two agreeing oracles still finalize
      (`demo/demo-recording.sh`: `votes=2, finalized=true`). _Not retroactive:
      attestations finalized before the fix keep their flag — harmless, because
      `mint_energy` additionally requires the report hash to equal the canonical
      hash._
- [x] **P0-2 Sequential mint** — mint queue implemented in `server.js`
      (`MINT_QUEUE_MAX` / `MINT_MAX_ATTEMPTS` / `MINT_RETRY_BASE_MS`), proofs
      persist with `proof_json` + `mint_status='accepted'`, queue drains after
      restart, per-device interval gate (`DEVICE_MIN_INTERVAL_MS`). Tests:
      `tests/storage-queue.test.js`. _Batch via Merkle still on the roadmap._
- [x] **P0-3 Single oracle / single RPC** — RPC failover list (`RPC_ENDPOINTS`)
      with automatic rotation on RPC errors (503 instead of fake 404). _≥2
      independent oracle instances and key separation are ops decisions —
      documented, need deployment._
- [x] **P0-4 Single-key governance (ops path)** —
      `docs/MAINNET-GOVERNANCE.md` + `scripts/transfer-authorities-to-squads.ts`
      (vault/policy/oracle-registry authorities + governance members →
      Squads multisig; compiles). _Execution requires the Squads address and
      the founder key — an operator step._
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
- [x] **P1-4 PoI/ERS loop** — `commit_contribution` on-chain: PDA
      `[b"poi-commit", round, device_id]` stores the contribution digest +
      device Ed25519 signature (message layout pinned by Rust + Python tests).
      `scripts/ai_ers_collector.ts` (signed AI bundle → severity →
      rate-limited `report_anomaly`), cron workflow `ers-loop.yml`, ENRG-AI
      anomaly signals carry `meta.device_id`, `digest.py::onchain_commit_message`
      matches the program. Anchor: 59 passing.
- [x] **P1-5 Mock tests vs real peg** — `tests/test_mainnet_critical.py` now
      mirrors `math.rs` (`energy_wh * SRC_BASIS / energy_per_src`) + peg tests
      `test_peg_one_mwh_equals_one_src` / `test_peg_fractional_mwh`.
- [x] **P1-6 EVM bridge hardening** — `onchain/src/EnrgOracleAttestation.sol`
      rewritten: k-of-n multi-oracle quorum, timelocked oracle/threshold
      changes, 2-step ownership transfer. 12 Foundry tests cover it.

## 🟡 Nice-to-have

- [x] **P2-1 Load tests** — `scripts/benchmark-oracle.js` (policy + storage
      throughput).
- [x] **P2-1a WebCrypto hot path** — `policy.validateProofAsync` uses native
      `node:crypto` Ed25519 (measured ~33× faster than tweetnacl); used by
      `/api/v1/proof/submit`. Tests: `tests/policy-webcrypto.test.js` (5).
- [x] **P2-2 CI for Axis-connect & ENRG-AI** — `.github/workflows/ci.yml`
      added to both repos (Axis-connect: vitest+build+e2e; ENRG-AI: pytest).
- [x] **P2-3 Browser wallet** — `src/lib/walletProvider.ts` (detection +
      `WalletLike` type) and full integration: `Settings` can connect
      Phantom/Solflare, `App` switches the active wallet, `enrgTx` signs via
      the extension (`signTransaction`/`signAllTransactions`) — the private key
      never touches the page. Local (localStorage) wallet remains as fallback.
      Tests: 64 vitest passing (+2 Settings injected cases).
- [x] **P2-4 Mainnet runbook** — `docs/MAINNET-RUNBOOK.md` (key ceremony,
      deploy, bootstrap, oracle, firmware, AI, go/no-go).

## P3 — Proof aggregation (roadmap)

- [x] **P3-1 Device-side aggregation** — firmware `ENRG_AGGREGATE_WINDOW_MS`:
      one signed aggregated proof per window (same canonical message, so
      `mint_energy` on-chain needs NO change). Flush guards: rated_power cap
      (avoids ExcessiveEnergy) + 1 MWh hard cap. Documented in
      `firmware/esp32_proof_sender/README.md`.
- [x] **P3-2 Oracle-side aggregation support** — oracle `MINT_MIN_ENERGY_WH`:
      proofs below the threshold are accepted/counted but not minted (one
      aggregated proof per window mints instead of N readings); aggregated
      proofs verified by policy tests.
- [ ] **P3-3 Multi-device Merkle batch** — rejected by design: the 1232-byte
      tx-size bound prevents N mint instructions or N signatures+proofs in one
      message; per-device aggregation (P3-1/P3-2) is the correct solution.
- [x] **P3-4 Real FL transport** — `ENRG-AI/agent/fed/transport.py`: HTTP
      aggregator (stdlib server, no new deps) + httpx client. Gateways submit
      Ed25519-signed contributions, the server verifies each, closes the round
      with FedAvg + MAD and serves global weights. Tests:
      `ENRG-AI/tests/test_fed_transport.py` (5).
- [x] **P3-5 Multi-oracle observability** — `oracle_id` attribution on every
      proof + public `GET /api/v1/oracles` (on-chain OracleRegistry set +
      per-oracle stats). Foundation for the 2+ oracle rollout; verified live
      against the devnet registry (new oracle `HC8Was…` shows as this_instance).

---
*Updated: 2026-08-30 (audit day 1).*
