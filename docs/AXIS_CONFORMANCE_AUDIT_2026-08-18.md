# Independent unofficial ENRG conformance audit against AXIS Protocol / AXIS Core

**Date:** 2026-08-18
**Mode:** read-only/analysis (no code changes)
**Scope:** `~/Axis-workspace/ENRG` (all 455 git-tracked files)
**Reference standards:** `~/Axis-workspace/Axis-protocol` (spec/protocol/*, adr/ADR-0001…0009, docs/*) and `~/Axis-workspace/Axis-core` (axis_core/*, oracle/*, schemas/*, docs/merkle-proof-verification.md)
**Methods:** line-by-line review, `diff` against the reference, `git ls-files` (secret scan), `npx tsc --noEmit`, `npm audit`, test-logic tracing.

---

## 1. Overall conformance level

| Component | Level | Score |
|---|---|---|
| Core Protocol (on-chain `enrg-mvp`) | Partial | ≈ 65 % |
| Domain Profile (`enrg-profile`) | Partial | ≈ 50 % |
| Oracle (`server.js`, `policy.js`, `storage.js`, `oracle/registry`) | Partial | ≈ 50 % |
| Firmware ESP32 v3 | Partial | ≈ 55 % |
| Schemas (`schemas/`) | Full | ≈ 95 % (byte-identical to Axis-core) |
| Documentation and ADRs | Partial | ≈ 60 % |
| **Total** | **Partial conformance** | **≈ 55 %** |


---

## 2. Strengths (done right)

1. **ADR-0005 — device lifecycle.** The 8 states and the transition matrix exactly match the reference (`programs/enrg-mvp/src/state/producer.rs:3-37`); Revoked is terminal, outward transitions are forbidden.
2. **ADR-0001 — the key never leaves the device.** Registration, claim and rotation require an Ed25519 device signature via the Solana precompile with domain-separated canonical messages (`device_lifecycle.rs:56-78`, `security/lifecycle.rs:14-85`, `security/mod.rs:34-76`). The precompile parser is strict (self-index only, a single signature).
3. **ADR-0002 — the on-chain registry as the source of truth.** The PDA `[b"producer", device_id]` stores state/owner/nonce/tier; changes only via registry instructions.
4. **The model.md trust pipeline.** An `OracleReport` with **two** signatures (device + oracle) (`state/oracle.rs:8-65`), the C-1 device_id binding, the C-0 oracle whitelist, anti-replay nonce, 15-minute freshness / 5-minute skew (`security/validation.rs:9-38`, `constants.rs:19-20`) — implemented exactly and consistent on-chain/off-chain.
5. **ADR-0007 — revocation and rotation.** `revoke_device` hard-blocks the mint (`mint.rs:45`, `producer.rs:258-266`); `rotate_device_key` with proof-of-possession of the new key and the `rotated_to` audit trail (`device_lifecycle.rs:640-683`).
6. **ADR-0003 — the on-chain Policy Engine.** A `PolicyRegistry` PDA + `PolicyEngine` (`policy_engine.rs`, `state/policy.rs`) with defaults identical to the protocol behavior; `mint_energy` positioned as the executor.
7. **Front-running protection (H-2).** An `EXPECTED_DEPLOYER` guard in all init instructions (`initialize.rs:101-106`, `oracle_registry.rs:71-77`, `manifest_registry.rs:61-67`, `governance.rs:31-36`, `init_config.rs`).
8. **Schemas.** All 5 `schemas/*.json` are byte-identical to Axis-core (verified with `diff`).
9. **Honest engineering documentation.** `docs/STATE.md` — the single source of truth with a "code first" note and a listed known tech debt; `docs/SECURITY_AUDIT_2026-08-16.md` and `docs/AXIS_CONFORMANCE_AUDIT_2026-08-16.md` — honest self-audits (52 %), most of the P0s found there are closed.
10. **Rust unit tests (61)** with invariants (vesting, governance, tier, ERS, emission) and a **verify-only devnet verification** of the deploy with binary SHA-256 (`docs/DEVNET_VERIFICATION.md`).
11. **Firmware SE050/OTA paths:** hardware Ed25519 (SE050), dual-bank A/B + eFuse `secure_version` + rollback (`esp32_proof_sender_v3.ino:936-978`), a separate cold firmware key, PoP registration and a key-overwrite ban in the oracle (`server.js:565-600`, `policy.js:654-689`).
12. **Git secret hygiene:** the legacy firmware, keypairs, `deploy/`, `*.log`, `*.db` are in `.gitignore`; `git ls-files` found no keypair/secret.

---

## 3. Critical issues (P0 — mainnet blockers)

**P0-1. The on-chain "manifest verification" verifies nothing.**
`register_manifest_verification` (`instructions/manifest_verification.rs:22-50`) just stores `publisher_key`, `content_hash`, `signature` and sets `verified = false` — the publisher signature is **never verified**. Anyone can register an arbitrary manifest. Plus `verify_merkle_proof` (`instructions/merkle_proof_verification.rs:143-182`) takes `leaf_hash` from the caller and **does not bind** it to the registered manifest `content_hash`: it proves membership in the tree of *some* leaf, not the statement "manifest X is approved". This is a direct breach of the trust-pipeline core (ADR-0004/0007: the "Manifest Registry" as the source of approved manifests).

**P0-2. The oracle keeps its own device registry as the signature-verification source of truth.**
`/api/v1/proof/submit` (`server.js:975-1043`) verifies the signature via `policy.validateProof` with `getPublicKey: (id) => devices[id]` — the oracle's local DB (SQLite/Postgres, `storage.js`), **not the on-chain Registry**. The on-chain link is checked only later, in `mintEnergy`, and only via `device_id`→`authority`. After an on-chain key rotation/revocation the off-chain registry drifts: a proof can be accepted by the oracle (energy accumulated) but rejected on-chain, or vice versa. This is a direct ADR-0002 violation ("the Registry is the only source of truth") in the active trust path.

---

## 4. Divergences from ADR-0001…0009

### ADR-0001 "The key never leaves the device" — **conformant (with caveats)**
- ✅ register/claim/rotate signing only on the device; the server never sees the private key.
- ⚠️ Fallback seed storage in NVS without flash encryption by default; CPU signing without an SE050 — a documented compromise (`SE050-HARDWARE-SIGNING.md`).
- ⚠️ `firmware/firmware-signing-keypair.json` sits on the work disk (not git-tracked) — not a cold store.

### ADR-0002 "Device Registry — the only source of truth" — **violated off-chain**
- ✅ On-chain: the `EnergyProducer` PDA is the state source.
- ❌ Off-chain: an own `devices`/`energyStore` registry in the oracle DB is used for verification (`server.js:58-60, 975-1043`) — **two sources of truth**.
- ⚠️ The identifier: in AXIS `device_id` is a deterministic base58 identifier derived from the key; in ENRG `device_id` = the Ed25519 pubkey itself (32 bytes). Formally compatible (base58, 32–64), but the **JSON schema `device_record.schema.json` requires `^dev_[0-9a-f]{16}$`, which the actual ENRG device_ids do not satisfy** — the schema is detached from reality.

### ADR-0003 "The oracle does not make decisions — Policy Engine" — **partially**
- ✅ The on-chain `PolicyRegistry`/`PolicyEngine`; `policy.js` off-chain; `mint_energy` — the executor.
- ❌ **Two independent Policy Engines** with different parameters: off-chain `policy.js` (`maxEnergyPerReportWh=1e9`, `maxProofAgeSec=900`) and on-chain `PolicyRegistry` (`max_energy_bps=10_000` of rated_power, `max_clock_skew_sec=300`). There is no sync mechanism: a proof can pass off-chain (energy accumulated) but be rejected on-chain → a "mint deferred" state accumulates without reconciliation.
- ❌ `PolicyRegistry` is **optional** in `MintEnergy` (`mint.rs:507-515`): without the PDA the "defaults" apply — i.e. the Policy Engine can be silently disabled without blocking the mint.
- ⚠️ The ENRG ADR-0003 translation declares "the oracle does not store device state" — in fact it does (see P0-2).

### ADR-0004 "Device Manifest" — **partially**
- ✅ The manifest is signed by the oracle, the device verifies the signature with an embedded pubkey, the manifest `oracle_url` is used (`esp32_proof_sender_v3.ino:46-50`, `policy.js:buildManifestMessage/signManifest/verifyManifest`).
- ❌ **The field set does not match AXIS**: ADR-0004 requires `trust_level`, `capabilities`, `heartbeat_interval`, `proof_threshold`, `policy_version`, `verifier_endpoint`; ENRG has `device_id, rated_power, oracle_url, public_key, timestamp, signature`. trust_level/policy_version/verifier_endpoint are missing (a domain substitution).
- ❌ The on-chain "Manifest Registry" does not verify manifest signatures (see P0-1) — the on-chain ADR-0004 loop does not actually work.

### ADR-0006 "Core vs Domain Profile" — **violated in the separation part**
- ✅ Two programs exist (`enrg-mvp` + `enrg-profile`) and the CPI `record_production`.
- ❌ **The economics stayed in the "core"**: SRC mint, 15 % / 20/40/30/10 commissions, buyback, vesting, vault — all in `enrg-mvp` (`constants.rs:30-41`, `instructions/mint.rs`, `buyback.rs`, `vesting.rs`). AXIS ADR-0006: "Core Protocol knows nothing about tokens, emissions, or fees". `enrg-profile` is a thin metadata layer (rated_power, a 30-day window), not a tokenizing Domain Profile.
- ⚠️ The own ENRG ADR-0006 records the deviation "Option B: logical separation inside one contract" — a direct divergence from the AXIS decision (explicit code separation).
- ⚠️ The ADR-0006 translation **swaps ADR numbers**: "Policy Engine (ADR-0004)" (should be ADR-0003), "ADR-0001: Emission model" (ADR-0001 = keys), "ADR-0004: Policy Engine" (ADR-0004 = manifest).

### ADR-0007 "Security & Key Management" — **partially**
- ✅ Key rotation/revocation with PoP, the `revoked` flag, the SE050 path, a separate firmware key, eFuse anti-rollback.
- ❌ **No Root Key Registry / manufacturer chain-of-trust** (p.3): the root of trust is a single embedded founder pubkey; no Merkle-root anchoring schedule (p.7: daily anchoring not implemented, the root is updated manually via `update_merkle_root`).
- ❌ **Attestation is not in COSE/CBOR** (p.5): ENRG uses raw Ed25519 signatures over binary messages; the required attestation fields (firmware_manifest_hash, nonce, timestamp) are not shaped as an attestation document.
- ⚠️ Infra-key changes (`set_vault_authority`, `set_oracle_admin`, `update_members`) are single-step, without multisig/timelock (`initialize.rs:160-210`, `oracle_registry.rs:89-110`, `governance.rs:64-75`) — recognized as TODO(audit).

### ADR-0008 "OTA" — **partially**
- ✅ A cold firmware key, SHA-256 image_hash, dual-bank A/B, a monotonic eFuse `secure_version`, rollback + smoke confirmation (`esp32_proof_sender_v3.ino:936-978`), a publish endpoint with `FIRMWARE_ADMIN_KEY`.
- ❌ The default transport is HTTP, not TLS 1.3 (see P0-3).
- ❌ The required Firmware Manifest format is missing `compatible_models` (only the `?model=` query is checked), `min_attestation_policy`, `rollout_policy`, the `emergency` flag, and manifest publication to the on-chain Registry with anchoring.
- ⚠️ No automatic OTA binding to the Manifest Registry/immutable log (ADR-0007 p.7).

### ADR-0009 "Governance" — **partially (MVP)**
- ✅ Members 3–5, voting, quorum (`yes > no && yes+no > snapshot/2`), a 7-day timelock, a 1e15 atomic proposal cap, emission only via `governance_mint` + the PDA `[b"mint-authority"]` (`governance.rs`, `state/governance.rs`).
- ❌ No token-holder voting, delegation, or voting power (the quorum is vote arithmetic, not a % of voting power) — ADR-0009 p.1.
- ❌ No Guardians multisig, no emergency flow with a short timelock and post-mortem — p.2/p.6.
- ❌ `authority` (a single address) both creates proposals and changes the member list itself; only `governance_mint` is executed — no arbitrary instructions/parameters, no RFC/ADR→testnet-rehearsal process.
## 5. Divergences from the AXIS model (Core vs Profile, trust pipeline, registration)

1. **Trust pipeline (model.md):** `Device → Event → Proof → Attestation → Verification → Trust`. In the ENRG production loop **the attestation as a verifiable artifact is absent**: the oracle calls `mint_energy` directly (Digital Claim), issuing and storing no Attestation document (`server.js:502-530`). The `attestation.schema.json` format is implemented only in the FastAPI mock (`app/api/oracle.py:50-116`) — two different worlds (mock and production), and production bypasses the attestation layer.
2. **Wire-format (spec/protocol/wire-format.md):** the Trust Envelope (`envelope_version/transport_id/correlation_id/message_header/domain/entity_type/entity_id/issuer_id`) is **not implemented** in ENRG. Messages are flat JSON (`{device_id, timestamp, energyWh, nonce, signature}`) and binary borsh structures. Messages are not self-describing (no message_type/message_version), and the "signature covers entire envelope" requirement degenerates into a payload signature.
3. **Validation (spec/protocol/validation.md):** the structural (borsh), cryptographic (Ed25519-precompile + nonce + freshness), semantic (tier/energy caps/supply) and state-dependent (Active/revoked) layers **are implemented** — a strength; but "envelope integrity" is absent (no envelope), and "issuer_id known and active" is checked for the oracle via the whitelist (C-0).
4. **Lifecycle (spec/protocol/lifecycle.md):** a Proof does not go through a "Stored" stage as a standalone entity — only the last nonce/energy in `EnergyProducer` and the off-chain accumulators are stored; there is no attestation history. Ordering/idempotence: the nonce is strictly monotonic — replay protection is correct.
5. **Registration (ADR-0002/Provisioning):** AXIS — Provisioning Service → Registry, `device_id` = deterministic base58; ENRG — an on-chain `register_device` with PoP (stronger). But the off-chain registration (`/api/v1/device/register`) uses a **different** PoP format (`device_id|public_key` string, `policy.js:679`) and a **different** registry than on-chain (`b"enrg:device:register"||device_id||ts`, `security/lifecycle.rs:27-33`) — two incompatible registration loops that do not auto-sync.
6. **Core vs Profile:** see ADR-0006 — the economics in the core; the profile is metadata. The AXIS separation criterion ("trust → Core, tokens → Profile") is violated.
## 6. Issues in the oracle, firmware, scripts, documentation

### Oracle
- **P0-2** — an own device registry as the source of truth (see §3).
- **P1** — the off-chain pools "distribute tokens" without a single token movement: `server.js:1008-1013` resets the counter and answers `'Pool threshold reached, tokens distributed'`. The on-chain pool exists, but `mintEnergy` passes `pool: null` (`server.js:516-517`). A product feature fakes the work.
- **P1** — `oracle/registry/routes/manifestRoutes.js` — a dead duplicate with the **insecure default `ADMIN_KEY='secure-key'`** (line 8) and a **keccak256 tree**, incompatible with the on-chain SHA-256 (`merkle_proof_verification.rs`) and with the working `oracle/registry/app.js` (SHA-256 and a mandatory ≥32-char key there, `app.js:16-19`).
- **P1** — canonicalization for signatures and leaf hashes via `JSON.stringify` (`oracle/registry/app.js:36-38,76-81`) is **non-canonical** (key order) and violates the determinism requirement in `docs/merkle-proof-verification.md`.
- **P1** — the oracle Docker deploy is broken: `docker-compose.yml` builds the image from `./oracle`, but `server.js` sits in the repo root → `CMD ["node","server.js"]` (`oracle/Dockerfile`) fails; `package.json "start": "node oracle/server.js"` also points to a nonexistent file.
- **P1** — `tests/test_mainnet_critical.py::test_deploy_simulation` **fails in CI**: without `target/idl/enrg_mvp.json` (and the CI `pytest -q` runs without `anchor build`) a camelCase fallback name list is used, while `required` is snake_case → `missing` is non-empty → assertion fail (verified by tracing: the CI branch is `missing=['buyback_and_burn','claim_rewards','init_config','initialize_token','mint_energy']`).
- **P1** — `npx tsc --noEmit` = **20 errors** (confirmed by running): `tests/device-lifecycle.ts`, `key-rotation.ts` (TS2339), `merkle-proof-verification.test.ts` (TS2353), `devnet-merkle-proof-verification.test.ts` (TS2552/TS2613), etc. The TS tests do not compile.
- **P2** — `app/` is an outdated axis_core fork: `app/api/oracle.py` — an old version (the `_looks_like_attestation` heuristic, no mode-2/`_REQUESTS` like in fresh Axis-core); `app/oracle/router.py` is not wired into `app/main.py`; `main.py` imports the **installed `axis_core` package**, not the local `app/` copy → local `app/` edits do not affect the runtime. `requirements.txt` (anchorpy/solders/pynacl) does not contain axis_core.
- **P2** — `npm audit --omit=dev`: **10 vulnerabilities (3 high, 7 moderate)** via `@solana/web3.js`/borsh.
- **P2** — CORS is open (`app.use(cors())`), listen `0.0.0.0`; `docker-compose.yml` passes `FOUNDER_KEY` via env (against its own H-1 "path only" recommendation).
- **P2** — storage: SQLite by default without replication/backups; Postgres is an option.

### Firmware
- **P0-3** — HTTP by default for proof/manifest/OTA (see §3).
- **P1** — **WiFi credentials are hardcoded in a tracked source file**: `WIFI_SSID "MTSRouter_004386"`, `WIFI_PASSWORD "23988521"` (`esp32_proof_sender_v3.ino:37-41`). Real-network credentials in a git file.
- **P1** — the device key defaults to NVS without flash encryption/secure boot (`SE050-HARDWARE-SIGNING.md` — a documented compromise; production requires eFuse measures).
- **P2** — a hardcoded home IP `192.168.1.123` in URL defaults (the firmware and `scripts/register-device.js`).
- **P2** — the serial command `SIGN <hex>` signs an **arbitrary** message with the device key without domain restrictions (`esp32_proof_sender_v3.ino:1046-1075`) — convenient for onboarding, but with physical access it widens the signing surface.
### Scripts and artifacts
- **P2** — dead/legacy: `first-mint.js`, `fix_mint_authority_and_mint_energy.js`, `test-deploy.js`, `*.disabled` tests, the EVM bridge (`contracts/EnrgOracleAttestation.sol` and `onchain/src/EnrgOracleAttestation.sol` — **two inconsistent copies**, `onchain/src/Counter.sol` — a Foundry scaffold). A dual version of the attestation contract (`int96 maxPowerKw` vs `uint64 maxPowerW` + storage).
- **P2** — `create_contract_v2.py` writes to `Path.home()/"ENRG/..."` — outside the current repo; `Anchor.toml` and `Cargo.toml` point to different workspaces (`enrg-profile` is excluded from the workspace — `anchor test` does not build it).
- **P2** — git tracks 101 `.anchor/program-logs/` files (logs) — junk in the history.

### Documentation
- **P1** — positioning: `README.md:3` says "first application built on Axis Protocol", but `docs/protocol/ENRG_Protocol_Specification.md:23-33` says "open, implementation-independent standard… The protocol is not owned" — ENRG presents itself as a **standalone normative protocol** duplicating the Axis-spec structure. Double normativity (what is the source of truth — AXIS or ENRG?).
- **P2** — `ENRG_Protocol_Specification.md:17` says "License: MIT", while `LICENSE` and the README say Apache 2.0.
- **P2** — `adr/ADR-00X-enrg-core-vs-energy-profile.md:259-275` is outdated: it claims "Verifier and Policy Engine are merged on-chain" as the current state — the separation is already done (2026-08-17).
- **P2** — specification duplication: v7.0/v8.0 in the root and in `docs/`, `docs/architecture.md` and `docs/architecture/ARCHITECTURE.md`; `books/` — copies of the Axis philosophy without naming the original source.
## 7. Fix recommendations (P0/P1/P2)

### P0 — before mainnet (mandatory)
1. **Close P0-1:** either implement the on-chain Ed25519 publisher-signature check in `register_manifest_verification` (the publisher pubkey from a whitelist/root-key registry), or exclude this account from the trust path; **mandatorily** bind `leaf_hash` to `content_hash`/`manifest_id` in `verify_merkle_proof` (verify that leaf = hash(manifest_id ‖ content)) — otherwise the Merkle statement is not a statement about the manifest.
2. **Close P0-2:** the oracle must take `device_id`/pubkey/state **only** from the on-chain `EnergyProducer` (fetch on every proof or a local read-through cache with invalidation); the own device registry — either remove it or reduce it to a cache with forced reconciliation. Remove the two registration loops (a single PoP format and a single registry).
3. **Close P0-3:** firmware defaults — HTTPS only with an embedded root certificate; forbid `http://` for OTA/manifest (or an explicit dev-only flag); add `compatible_models`/`min_attestation_policy` to the firmware manifest and verify them on the device.
4. **Secrets:** remove the WiFi credentials from the tracked `.ino` (empty defaults + compile-time `-D`); move `firmware-signing-keypair.json` into a real cold store.

### P1 — before mainnet (important)
5. Sync the on-chain and off-chain Policy Engines (a single parameter source; the oracle must not "accept" a proof that on-chain is guaranteed to reject; drop the silent `policy_registry = None` defaults on mainnet).
6. Implement an honest pool: either on-chain distribution (wire `pool`/`pool_share` into `mintEnergy`), or remove the fake "tokens distributed" from the off-chain response.
7. `set_vault_authority`/`set_oracle_admin`/`update_members` — two-step changes + multisig/timelock (a recognized TODO(audit)).
8. Move the economics (mint, commissions, buyback, vesting) from `enrg-mvp` into `enrg-profile` (full CPI) — close ADR-0006; fix the ADR numbers in the translated ADR-0006.
9. Fix the oracle Docker deploy (a build context with `server.js` or a move into `oracle/`), `npm start`, remove `manifestRoutes.js` (or align it with SHA-256 and a mandatory key), switch to canonical serialization (RFC 8785 / a deterministic key order).
10. Fix the tests: `test_deploy_simulation` (single snake_case), the TS errors (20), include `anchor build` in CI or move out the IDL-dependent checks.
11. Ensure Manifest Registry persistence, a daily Merkle-root anchoring schedule (ADR-0007 p.7) and firmware-manifest publication into it (ADR-0008).
12. Introduce an on-device manifest-freshness check: cross-check `policy_version`/`heartbeat_interval` (ADR-0004 fields) — currently absent.

### P2 — post-mainnet / roadmap
13. COSE/CBOR attestation and a Root Key Registry/chain-of-trust (ADR-0007); negative Merkle proofs; batch verification.
14. Full governance ADR-0009: token-holder voting, delegation, a Guardians multisig, an emergency flow, execution of arbitrary instructions.
15. Repo cleanup: dead scripts, EVM duplicates (`EnrgOracleAttestation.sol` ×2), `create_contract_v2.py`, `.anchor/program-logs` from git; merge the v7/v8 specs; a single "ENRG — a Domain Profile on AXIS" position; resolve the MIT/Apache-2.0 conflict.
16. `npm audit` — update `@solana/web3.js`; TLS termination at the reverse proxy, close CORS.

---

## 8. Conclusion: is ENRG mainnet-ready

**No, ENRG is not mainnet-ready from an AXIS-conformance standpoint** (an objective score of ≈ 55 %).

- **What is actually ready:** the on-chain trust core (ADR-0001/0002/0005, dual Ed25519 signatures, nonce/freshness, OracleRegistry, key revocation/rotation, PolicyRegistry, a supply cap with an immutable mint-authority PDA) — closed-testnet level; the devnet deploy is verified and matches the local build by SHA-256; the schemas are identical to the reference.
- **What blocks:** P0-1 (the Manifest Registry without signature verification + the Merkle-leaf not bound to the manifest), P0-2 (an ADR-0002 violation in the active oracle loop), P0-3 (HTTP transport by default in the firmware). Plus the systemic ADR-0006 (economics in the core), ADR-0007 (no root-of-trust registry/COSE), ADR-0008 (an incomplete firmware manifest/TLS), ADR-0009 (governance — a narrow MVP) divergences, and the non-working (yet claimed) off-chain pool.
- **A status contradiction:** commit `61e6faa` claims "100% mainnet readiness", `docs/STATE.md` says "P0 closed", but the own `docs/protocol/deployment/mvp-release-readiness.md` and `docs/AXIS_CONFORMANCE_AUDIT_2026-08-16.md` (52 %) record "mainnet deferred", and the P0s above remain in the code.
- **The minimal path:** close 3 P0s + ~8 P1s (§7), then an independent re-audit against the ADR-0001…0009 checklist and a two-sided e2e (ESP32 → Oracle → mint) with TLS and a real SE050 device.

---

## 9. Fix status (2026-08-18, code changed)

> This section was added after the fixes. All changes passed verification:
> `anchor build` OK, Rust unit tests 92/92, mocha 76/76, pytest 37/37,
> `npx tsc --noEmit` 0 errors, `node --check` OK.

### Closed (fixed in code)

| ID | Problem | What was done |
|---|---|---|
| **P0-1** | The Manifest Registry does not verify publisher signatures; the Merkle leaf is not bound to the content | `instructions/manifest_verification.rs`: Ed25519 publisher-signature verification (publisher == `registry.oracle_authority`), `verified=true`; `instructions/merkle_proof_verification.rs`: `manifest_leaf_hash = SHA-256(manifest_id‖content_hash)` + a C-4 check (`InvalidManifestLeaf`); `error.rs` — new errors; `oracle/registry/app.js`: canonicalization (RFC-8785 style), a unified leaf scheme, a 16-byte `manifest_id`; the dead `routes/manifestRoutes.js` removed (insecure key + keccak); `tools/publisher.js` updated; the merkle test rewritten for the new signatures |
| **P0-2** | The oracle keeps an own registry as the source of truth | `server.js /proof/submit`: the public key and nonce are taken **only** from the on-chain `EnergyProducer` PDA; a device without on-chain registration is rejected with `404 device_not_registered_on_chain`; `mintEnergy(proof, producerOverride)` — no double RPC |
| **P0-3** | The firmware defaults to HTTP | `esp32_proof_sender_v3.ino`: URL defaults → HTTPS, `transport_allowed()` blocks `http://` (except `ENRG_ALLOW_HTTP=1` dev) for proof/manifest/OTA; WiFi credentials removed from the source |
| **P1-6** | The off-chain pool "distributes tokens" | `server.js`: an honest `pool_threshold_reached_offchain_distribution_not_implemented` response instead of resetting the counter and the fake "tokens distributed" |
| **P1-9** | Docker/npm start broken | `oracle/Dockerfile` + `docker-compose.yml`: build context = the repo root, `server.js/policy.js/storage.js` + the IDL copied; `package.json start` → `node server.js`; a `.dockerignore` added |
| **P1-10** | Tests do not compile / fail | `tsconfig.json` (`noEmit`, `allowImportingTsExtensions`); `helpers/merkle.ts` — a unified leaf scheme; merkle/devnet-merkle/debug-program/device-lifecycle/key-rotation — typing and accounts (`accountsStrict` for PDAs); `test_mainnet_critical.py` — a snake_case fallback; `bs58` → `.default` (v6) in policy.js and tests; `tests/manifest.test.js` — ADR-0002 behavior |
| **P1-12** | The manifest lacks the ADR-0004 fields | `policy.js`/`server.js`/firmware: `trust_level`, `heartbeat_interval`, `proof_threshold`, `policy_version`, `verifier_endpoint` added; the canonical signing message extended and synced (oracle ↔ firmware) |
| **P1 (canonicalization)** | `JSON.stringify` for signatures/leaf hashes | `oracle/registry/app.js`, `tools/publisher.js`: deterministic canonicalization (key sorting, RFC-8785 style); the double leaf hashing fixed (the off-chain root now converges with on-chain) |

### Documentation (P2)

- `docs/architecture/adr/ADR-0006-*.md`: the ADR numbers fixed (Policy Engine = ADR-0003, ADR-0001 = keys, ADR-0004 = manifest).
- `adr/ADR-00X-*.md` §7.1: updated (the Policy Engine was split on 2026-08-17, the residual `policy_registry = None` risk noted).
- `docs/protocol/ENRG_Protocol_Specification.md`: License MIT → Apache 2.0.
- `oracle/README.md`: on-chain registration (P0-2), honest pools, the ADR-0004 manifest fields.

### Remaining (not fixed — requires decisions/migrations)

- **P1-5:** syncing the two Policy Engines (on-chain `PolicyRegistry` vs off-chain `policy.js`) and dropping the silent `policy_registry = None` fallback on mainnet.
- **P1-7:** multisig/timelock for `set_vault_authority`/`set_oracle_admin`/`update_members` (two-step changes; requires a `Vault` layout migration).
- **P1-8:** moving the economics (mint/commissions/buyback/vesting) from `enrg-mvp` into `enrg-profile` (ADR-0006 full separation).
- **P1-11:** Manifest Registry persistence + a daily Merkle-root anchoring schedule (ADR-0007 p.7).
- **P2:** COSE/CBOR attestation and a Root Key Registry; full governance ADR-0009 (token-holder voting, Guardians); dead-script/EVM-duplicate cleanup; `npm audit` (10 vulnerabilities, 3 high); TLS termination and CORS in production.

---

## Audit limitations

- The analysis is static (without running on-chain transactions and without building the firmware).
- The Merkle-layer runtime behavior is not confirmed (the TS tests do not compile, `describe.skip`/`it.skip` in the merkle and governance tests).
- The actual deploy values are taken from `docs/DEVNET_VERIFICATION.md` (claimed by the author; they match the local build by SHA-256 at verification time).
- The component scores are expert estimates based on the count and weight of the found divergences.
