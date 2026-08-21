# ENRG conformance audit against AXIS Protocol and AXIS Core requirements

**Date:** 2026-08-16
**Mode:** read-only/analysis (no code changes)
**Scope:** `/home/enrg/Axis-workspace/ENRG`
- `programs/enrg-mvp/` — on-chain Core Protocol (Solana/Anchor)
- `programs/enrg-profile/` — Domain Profile (EnergyProfile)
- `server.js`, `storage.js`, `oracle/` — the oracle and manifest registry
- `firmware/esp32_proof_sender/` — the ESP32 firmware
- `app/`, `schemas/`, `docs/`, `adr/` — the FastAPI layer, schemas, documentation

**Reference standards:**
- `/home/enrg/Axis-workspace/Axis-protocol` — `spec/protocol/{model,wire-format,lifecycle,validation}.md`, `adr/ADR-0001…0009`
- `/home/enrg/Axis-workspace/Axis-core` — `axis_core/*` (FastAPI), `oracle/*` (Node.js registry), `schemas/*`, `docs/merkle-proof-verification.md`, `axis_core/onchain_bridge.py`

---
## 1. Executive Summary

### 1.1. Overall conformance level

| Component | Conformance level | Score |
|---|---|---|
| **Core Protocol** (on-chain `enrg-mvp`) | **Partial** | ≈ 60 % |
| **Domain Profile** (`enrg-profile`) | **Partial** | ≈ 55 % |
| **Oracle** (`server.js`, `storage.js`, `oracle/registry`, `app/`) | **Partial** | ≈ 55 % |
| **Firmware** (ESP32 v3, legacy v1) | **Partial / Non-conformant** | ≈ 35 % |
| **Total** | **Partial conformance** | **≈ 52 %** |

**In one sentence:** the ENRG on-chain core is the strongest part (ADR-0005 lifecycle, dual Ed25519 signatures, OracleRegistry, anti-replay nonce/freshness are implemented correctly and match ADR-0001/0002/0005), but the architectural decisions of ADR-0003 (Policy Engine), ADR-0004 (Manifest on the device), ADR-0006 (Core/Profile separation), ADR-0007 (secure key management, rotation, manifest signing), ADR-0008 (OTA) and ADR-0009 (full governance) are **not implemented or only partially implemented and deliberately deferred as "MVP deviations"** (`adr/ADR-00X-enrg-core-vs-energy-profile.md §7`). The project itself declares the status: "ready for **devnet**, mainnet deferred" (`docs/protocol/deployment/mvp-release-readiness.md:3-4`).

### 1.2. Strengths (AXIS-conformant)

1. **ADR-0005 — device lifecycle**: the 8 states and the transition matrix exactly match ADR-0005 (`programs/enrg-mvp/src/state/producer.rs:3-37`).
2. **ADR-0001 — the key never leaves the device**: registration and claim require an Ed25519 device signature via the Solana precompile (`device_lifecycle.rs:54-77`, `security/lifecycle.rs:27-62`, `security/mod.rs:34-73`); the device key is stored neither on-chain nor at the oracle.
3. **ADR-0002 — registry as the source of truth**: the `EnergyProducer` PDA `[b"producer", device_id]` stores state, owner, nonce, tier; changes only via registry instructions.
4. **The model.md trust pipeline**: Proof → Attestation (OracleReport with two signatures) → Digital Claim (mint) is reproduced exactly (`state/oracle.rs:12-65`, `mint.rs:28-90`).
5. **nonce/timestamp checks**: a strict monotonic nonce (`security/validation.rs:13-16`), 15-minute freshness and 5-minute skew are synchronized between on-chain and the oracle (`constants.rs:19-20`, `server.js:654-657`, `security/validation.rs:9-10`).
6. **JSON schemas** (`schemas/*.schema.json`) are byte-identical to the Axis-core reference (verified with `diff -q` across 5 files).
7. `app/main.py` directly reuses the Axis-core reference implementation (axis_core FastAPI).

### 1.3. Critical issues (brief)

- **P0-1.** The git repository contains the legacy firmware `esp32_proof_sender.ino` with a **hardcoded private key** and **HTTP** transport (`firmware/esp32_proof_sender/esp32_proof_sender.ino:22-35,7`) — a direct ADR-0001/ADR-0007 violation.
- **P0-2.** The on-chain `register_manifest_verification` **does not verify the Ed25519 signature** of the manifest publisher — anyone can register an arbitrary `ManifestVerification` (`instructions/manifest_verification.rs:22-50`); `verify_merkle_proof` does not bind `leaf_hash` to the manifest `content_hash` (`instructions/merkle_proof_verification.rs:143-182`).
- **P0-3.** `server.js` signs the OracleReport with the **founder key** at mint time and mints to the **founder ATA** (`server.js:35-37, 395-405, 418`), while the on-chain `mint_energy` requires `producer.authority == authority` (`mint.rs:56-59`) — the oracle physically cannot mint for devices claimed by other owners. A multi-owner mainnet is broken.
- **P0-4.** The Policy Engine (ADR-0003) is missing: decisions (quarantine/allow/mint) are made in `mint_energy` and in the oracle itself — a deliberate deviation, but a spec blocker for mainnet.
- **P0-5.** The device does not receive or verify a signed Device Manifest (ADR-0004): the configuration is hardcoded in the firmware; the manifest is not verified on the device; OTA (ADR-0008) is entirely absent.

---

## 2. Methodology and sources

The comparison was made **only against the normative AXIS documents** (not against an "ideal project"):

- `Axis-protocol/spec/protocol/model.md`, `wire-format.md`, `lifecycle.md`, `validation.md`;
- `Axis-protocol/adr/ADR-0001…0009`;
- `Axis-core/axis_core/*` (FastAPI), `Axis-core/oracle/*` (Node.js registry), `Axis-core/schemas/*`, `Axis-core/docs/merkle-proof-verification.md`, `Axis-core/axis_core/onchain_bridge.py`.

Checked: PDAs and seeds, data structures, device lifecycle, Ed25519 verifications, Merkle logic, proof/attestation format, schemas, API surface, key security, OTA, governance.

---

## 3. Requirement conformance (summary table)

| AXIS requirement | Status in ENRG | Where implemented / where violated |
|---|---|---|
| ADR-0001: the key never leaves the device | ✅ Full (on-chain), ⚠️ Partial (firmware) | `device_lifecycle.rs:54-77`; firmware v3 NVS/ATECC; **legacy v1 — violation** |
| ADR-0002: Registry — source of truth | ✅ Full (on-chain) | `state/producer.rs`, `device_lifecycle.rs` |
| ADR-0003: Policy Engine separated from the Verifier | ❌ Non-conformant (MVP deviation) | `mint.rs:18-27` (an explicit comment), `ADR-00X §7.1`; decisions in `server.js` |
| ADR-0004: signed Device Manifest on the device | ❌ Not implemented | Firmware — hardcoded configuration; the manifest is not read/verified |
| ADR-0005: states and transitions | ✅ Full | `state/producer.rs:3-37` — the matrix matches ADR-0005 |
| ADR-0006: Core vs Domain Profile | ⚠️ Partial | `enrg-profile` is extracted; the economics stayed in the core (`ADR-00X §7.2`) |
| ADR-0007: key management, rotation, attestation, firmware signing | ⚠️ Partial / ❌ | Ed25519 everywhere, but no rotation, no root-key registry, no COSE/CBOR, no firmware signing |
| ADR-0008: OTA and secure updates | ⚠️ **Partial (improved 2026-08-17)** | OTA implemented (signature+hash+anti-rollback); a cold firmware key, dual-bank A/B and a hardware monotonic eFuse added (env `esp32dev-ota`) |
| ADR-0009: governance | ⚠️ Partial (MVP) | `governance.rs` — member voting + a 7-day timelock; no token voting, Guardians, emergency flow |
| wire-format.md: deterministic format | ⚠️ Partial | The oracle — JSON; on-chain — a binary canonical OracleReport (own format, documented in ENRG ADR-001); Trust Envelope/MessageHeader not implemented |
| Manifest Merkle verification | ⚠️ Partial | On-chain SHA-256 matches the off-chain registry; but the publisher signature is not verified on-chain and the leaf is not bound to the content |

---

## 4. Divergence table

### 4.1. Core Protocol (programs/enrg-mvp)

| # | AXIS requirement | Fact in ENRG | Why non-conformant | References |
|---|---|---|---|---|
| C-1 | ADR-0003: Verifier ≠ Policy Engine | **✅ FIXED (2026-08-17):** a separate on-chain `PolicyRegistry` (PDA `[b"policy-registry"]`) + `PolicyEngine::evaluate_preamble/evaluate_reward` (`instructions/policy_engine.rs`); `mint_energy` is the Verifier and enforces policies (whitelist, state, freshness, tier, energy, pause, supply cap) | Was: verifier+policy co-located in `mint_energy` (a documented simplification). Now: `mint.rs:90-103,154-161` → `policy_engine.rs`; the account is optional (backward compatibility) | `state/policy.rs`, `instructions/policy_engine.rs`, `mint.rs` |
| C-2 | ADR-0003: quarantine/maintenance decisions are made by the Policy Engine | ⚠️ **Partial:** mint-eligibility decisions are with the Policy Engine (P0 blocker D-2 closed for the mint path). quarantine/maintenance decisions remain owner-gated (`quarantine_device`, `maintenance_device`) — a recorded deviation §7.4 | `device_lifecycle.rs:297-307`, `lib.rs:337-342` |
| C-3 | ADR-0002/0007: verification of the manifest publisher signature | `register_manifest_verification` **just stores** `publisher_key` and `signature`, the `verified=false` field, and does not verify the signature | Any account can register an arbitrary manifest; on-chain does not ensure manifest authenticity | `instructions/manifest_verification.rs:22-50`, `state/manifest_verification.rs:4-28` |
| C-4 | Merkle verification: the leaf is bound to the manifest content | `verify_merkle_proof` takes `leaf_hash` from the caller and only checks it against the root; the `content_hash` (Keccak) from `ManifestVerification` is unused | On-chain proves only "some leaf in the tree", not "leaf = the content of manifest N". The binding is off-chain only (the reference has the same limitation, but it was carried over without hardening) | `merkle_proof_verification.rs:143-182`, `state/manifest_verification.rs:11` |
| C-5 | ADR-0007: device key rotation/revocation | `device_id` = the device public key, immutable; no key rotation or revocation; `set_oracle_authority` — an instant change without a timelock | ADR-0007 §4: "Keys MUST support rotation", "Old keys MUST be revocable" | `state/producer.rs:106-107`, `lib.rs:82-87`, `manifest_registry.rs` (SetOracleAuthority) |
| C-6 | ADR-0009: governance (token voting, deposit, Guardians, emergency) | MVP: 3–5 members, one vote/member, quorum `yes>no && yes+no>members/2`, 7-day timelock, execution only via `governance_mint` | No weight-based token voting, no deposit, no Guardians role and emergency flow, no quorum/threshold as parameters, no updating of any parameters | `instructions/governance.rs:1-220`, `constants.rs:109-115` |
| C-7 | ADR-0009/0007: multisig for critical operations | `set_vault_authority` — a single-step change without a timelock/multisig | A highly critical operation without protection; marked TODO(audit) | `instructions/initialize.rs` (set_vault_authority), `docs/STATE.md:25,158-159` |
| C-8 | ADR-0007: Merkle-root anchoring (daily/scheduled) | The root is updated manually via the `update_merkle_root` instruction at the oracle discretion; no anchoring schedule | ADR-0007 §7: periodic anchoring recommended (a daily root); emergency anchoring not implemented | `instructions/manifest_registry.rs:97-120` |



### 4.2. Domain Profile (programs/enrg-profile) and layer separation

| # | AXIS requirement | Fact in ENRG | Why non-conformant | References |
|---|---|---|---|---|
| P-1 | ADR-0006: the Core does not know about tokens/emission | `enrg_mvp` contains mint, tier, ERS, pool, buyback, vesting, supply-cap | The Core is mixed with the energy-profile economics. `enrg-profile` is partially extracted (EnergyProfile, rated_power ≤ 1 MW, 30-day window) | `ADR-00X §7.2`, `lib.rs:20-393`, `programs/enrg-profile/src/lib.rs:13-80` |
| P-2 | ADR-0006: the profile does not know about trust | `enrg-profile` knows only about the owner and power — ✅, but is called from `enrg_mvp::mint_energy` via CPI | Partially conformant; full isolation is not achieved (one program owns both the core and the economics) | `mint.rs:456-489` |

### 4.3. Oracle (server.js, storage.js, oracle/registry, app/)

| # | AXIS requirement | Fact in ENRG | Why non-conformant | References |
|---|---|---|---|---|
| O-1 | ADR-0003: the oracle = Verifier (crypto only), decisions — with the Policy Engine | `server.js` makes decisions itself (per-report energy limit, accumulation threshold, mint at the threshold); `app/api/oracle.py` has its own policy rules (5 kW limit) | Verifier and Policy Engine are merged in the oracle | `server.js:649-655, 780-808`, `app/api/oracle.py:157-171` |
| O-2 | ADR-0002: a single source of truth — the Registry | The oracle keeps a **parallel** off-chain device and energy DB (`devices`, `energy_store`, `pools`) without syncing with the on-chain `EnergyProducer` | The state can drift apart; ADR-0002 requires a single source | `storage.js:32-52`, `server.js:48-50` |
| O-3 | ADR-0003/0001: the oracle is a separate trusted role | The oracle = the **founder key** (`FOUNDER_WALLET`); the on-chain OracleRegistry must contain this key; the mint goes to the founder ATA | Role concentration (founder=deployer=authority=oracle), one oracle for the whole protocol | `server.js:35-42, 395-405`, `constants.rs:101`, `state/registry/oracle.rs:19-24` |
| O-6 | Axis-core: off-chain API (registry/provisioning) | `app/main.py` imports `axis_core` directly — the FastAPI layer is effectively a copy of Axis-core | This is reference reuse, not a divergence, but it means ENRG has no own off-chain provisioning/registry implementation | `app/main.py:3-5` |
| O-7 | Axis-core: manifest registry (Node.js) | `oracle/registry/app.js` — an improved Axis-core copy: a mandatory `REGISTRY_ADMIN_KEY` ≥ 32 chars, a SHA-256 root, leaf = sha256(manifest_id ‖ payload) | Conformant and hardened vs Axis-core. **BUT** the duplicate `routes/manifestRoutes.js` is dead code with `keccak256` and the default `'secure-key'` key (not wired into `app.js`, but dangerous if wired) | `oracle/registry/app.js:14-19,40-81`, `oracle/registry/routes/manifestRoutes.js:4,8` |
| O-8 | Axis-core: persistence/recovery | `storage.js` — Postgres/SQLite (a hardening), but `oracle/registry` stores manifests in an in-memory `Map` | Data loss on registry restart; ADR-0002 requires high availability | `oracle/registry/app.js:22-23`, `storage.js:19-51` |
| O-9 | Legacy EVM artifacts | `contracts/EnrgOracleAttestation.sol`, `onchain/` (Foundry), `onchain_bridge.py`, `docs/onchain-attestation.md` describe a keccak EVM bridge | Not relevant to the current Solana stack; creates documentation drift and a risk of misunderstanding | `contracts/EnrgOracleAttestation.sol`, `docs/onchain-attestation.md` |
| O-10 | A unified device_id format | On-chain: pubkey-as-id; the off-chain `device_record.schema.json`: `^dev_[0-9a-f]{16}$`; `server.js` accepts base58/0x-hex | The formats are not aligned between the schemas and the code | `schemas/device_record.schema.json:22-27`, `server.js:501-506` |
| O-11 | States in the off-chain schema | The `lifecycle_state` enum in the schema: `provisioned/active/suspended/retired` (4 states) vs the 8 on-chain ADR-0005 states | The off-chain DeviceRecord does not reflect the on-chain state machine | `schemas/device_record.schema.json:36-44`, `state/producer.rs:3-13` |

### 4.4. Firmware (ESP32)

| # | AXIS requirement | Fact in ENRG | Why non-conformant | References |
|---|---|---|---|---|
| F-1 | ADR-0001: signing only on the device | ✅ v3: the key is generated at first boot, signing in the CPU, the binary format `device_id(32)\|\|nonce(8)\|\|ts(8)\|\|energy_wh(8)` matches `OracleReport::device_message_to_sign()` | Conformant | `firmware/esp32_proof_sender/src/esp32_proof_sender_v3.ino:250-280`, `state/oracle.rs:42-51` |
| F-2 | ADR-0001/0007: key in a Secure Element, hardware signing | ⚠️ **Partial (2026-08-17):** an **NXP SE050** path added (`ENRG_USE_SE050=1`, env `esp32dev-se050`) — hardware Ed25519 signing (key and signature inside the chip); the no-SE050 serial variant is a documented compromise: the key in NVS/ATECC608A Data-Zone, signing in the CPU | ADR-0007 §4: "Private keys MUST be stored in secure hardware module (SE/eFuse/TPM)". Without SE050, NVS is non-conformant; the SE050 path requires the chip (reference implementation, bring-up). Residual risks are documented in `SE050-HARDWARE-SIGNING.md` | `esp32_proof_sender_v3.ino` (SE050 section), `platformio.ini` (`esp32dev-se050`), `SE050-HARDWARE-SIGNING.md` |
| F-3 | ADR-0001 (violation): legacy firmware with the key in git | **✅ FIXED (2026-08-17):** `esp32_proof_sender.ino` removed from git; v1/v2 moved to `firmware/legacy/` (gitignored, outside the delivery), the key redacted in the archived copy | Was: a private key published in the repository | Was: `firmware/esp32_proof_sender/esp32_proof_sender.ino:22-35,7`; now: `firmware/legacy/` (an archive outside git) |
| F-4 | ADR-0004: the device stores a signed Manifest and checks policy_version | The configuration is hardcoded via `#define` (`ENRG_ORACLE_URL`, `ENRG_REPORT_INTERVAL_MS`, etc.); the manifest is not loaded or verified, `policy_version` is absent | ADR-0004 not implemented | `esp32_proof_sender_v3.ino:34-90` |
| F-5 | ADR-0007 §6/ADR-0008: firmware signing, pre-install verification, OTA | **✅ Implemented (2026-08-17):** OTA (a `version\|hash\|size` signature **with a separate cold firmware key** `ENRG_FIRMWARE_PUBKEY_HEX`, SHA-256, NVS anti-rollback); dual-bank A/B (`partitions_ota.csv`) and a hardware monotonic counter (eFuse secure_version, env `esp32dev-ota`) added | ADR-0008: signature+verify ✅; A/B+monotonic in env `esp32dev-ota` (bring-up) | `esp32_proof_sender_v3.ino` (OTA + `ota_mark_boot_ok`/`ota_mark_hardware_anti_rollback`), `partitions_ota.csv`, `sdkconfig.defaults.esp32dev-ota`, `server.js` (FIRMWARE_SIGNING_KEY_PATH) |
| F-6 | ADR-0007: TLS transport | ✅ v3: HTTPS with root-CA verification, mTLS optional | Conformant (v1 — violation, see F-3) | `esp32_proof_sender_v3.ino:41-66, 300-344` |
| F-7 | On-chain lifecycle: the device itself runs register/claim | The firmware only sends proofs; on-chain register/claim is done by scripts/the owner, not by the device | The full ADR-0005 pipeline (device-driven registration) is not implemented on the device | `esp32_proof_sender_v3.ino` (no register/claim), `scripts/create-producer-device.js` |

### 4.5. Documentation / conformance

| # | Problem | References |
|---|---|---|
| D-1 | `docs/specifications/ENRG_Conformance.md` references the **outdated** program id `9rVoq…XF` (archived as legacy; the current one — `HkuC3…`) | `ENRG_Conformance.md:79`, `docs/STATE.md:172-176` |
| D-2 | `docs/merkle-proof-verification.md` (an Axis-core copy) describes `keccak256` as `sha256` (an ambiguity carried over from the reference), while in fact on-chain and `oracle/registry/app.js` use SHA-256; `routes/manifestRoutes.js` — keccak256 | `docs/merkle-proof-verification.md:51-56`, `merkle_proof_verification.rs:5-99`, `oracle/registry/app.js:40-43`, `oracle/registry/routes/manifestRoutes.js:4` |
| D-3 | The oracle README describes `/api/v1/proof/submit`, but `server.js` sits in the root, not in `oracle/`; inside `oracle/registry/` there is a separate service | `oracle/README.md:1-17`, the root `server.js` |
| D-4 | `docs/SECURITY_AUDIT_2026-08-16.md` records critical vulnerabilities (CR-1..CR-3) that are **already fixed** in the current code — the document is outdated and needs a status review | `docs/SECURITY_AUDIT_2026-08-16.md`, the current `server.js:527-589, 649-815` |


| O-4 | ADR-0001/0005: devices with other owners | `mint_energy` requires `producer.authority == signer`; the oracle signs with the founder key → mint only for devices claimed by the founder | The multi-owner scenario (the heart of ADR-0005 CLAIMED/owner) does not work with the current oracle | `mint.rs:56-59`, `server.js:418, 464-471` |
| O-5 | ADR-0007: the oracle signature must be verifiable on-chain | Implemented correctly: `oracle_signature` is verified via the precompile (✅) | Conformant | `mint.rs:72-83`, `state/oracle.rs:55-65` |

## 5. Fix recommendations

### Core Protocol
1. **C-3 (manifests):** add an on-chain Ed25519 publisher-signature check in `register_manifest_verification` (reuse the existing `verify_ed25519_signature` precompile pattern), or restrict registration to `oracle_authority` (Signer) only until a full root-key registry is introduced.
2. **C-4 (Merkle):** bind `leaf_hash` to `manifest_verification.content_hash` on-chain (e.g. require `leaf_hash == sha256(manifest_id ‖ content_hash)`), so the proof attests the authenticity of the manifest content itself.
3. **C-1/C-2 (ADR-0003):** ~~introduce a separate on-chain PolicyRegistry~~ → **✅ C-1 done (2026-08-17):** an on-chain `PolicyRegistry` + `PolicyEngine`; `mint_energy` enforces the policies. **C-2 remaining:** move the quarantine/maintenance decisions to the Policy Engine (owner-gated instructions stay as the control loop; the mint admissibility itself is already with the policies).
4. **C-5 (key rotation):** add `rotate_device_key` with signatures from both the old and the new keys and a rotation history in `EnergyProducer`; allow key revocation via the owner/governance.
5. **C-6 (governance):** extend to ADR-0009: weight-based token voting, deposit, configurable quorum/threshold, timelock as a parameter, execution of arbitrary instructions, an emergency flow with a higher quorum.
6. **C-7:** make `set_vault_authority` two-step (pending + timelock), ideally under multisig/Governance.

### Oracle
7. **O-3/O-4 (mint):** split the roles: the oracle signs the OracleReport with a key from `OracleRegistry` (not the founder), and the mint is executed on behalf of the device owner (per-owner `authority`) or via a dedicated mint role; otherwise a multi-owner mainnet is impossible.
8. **O-2:** sync the off-chain DB with the on-chain `EnergyProducer` (e.g. take the device status and nonce on-chain), or reduce the off-chain state to a cache.
9. **O-7/O-8:** remove the dead `routes/manifestRoutes.js` (keccak + the default `'secure-key'`) or wire it correctly; add manifest persistence and scheduled root anchoring (ADR-0007 §7).
10. **O-9:** archive the EVM artifacts (`contracts/`, `onchain/`, `onchain_bridge.py`, `docs/onchain-attestation.md`) with a legacy label to avoid drift.

### Firmware
11. **F-2:** ~~move to hardware Ed25519 signing~~ → **⚠️ Partially done (2026-08-17):** an SE050 path added (hardware Ed25519 signing) + a documented compromise (`SE050-HARDWARE-SIGNING.md`). Remaining: bring-up on hardware, eFuse (secure boot/flash-encryption/JTAG off) in production.
12. **F-3 (critical):** ~~remove legacy v1 (`esp32_proof_sender.ino`) from git~~ → **✅ Done (2026-08-17):** v1/v2 moved to `firmware/legacy/` (gitignored) and removed from git.
13. **F-4:** implement fetching and verifying a signed Device Manifest (ADR-0004): `GET /manifests?model=…`, server ED25519-signature verification, `policy_version` cross-check, NVS storage.
14. **F-5 (ADR-0008):** ~~implement OTA~~ → **✅ Done (2026-08-17):** OTA (a cold firmware-key signature + SHA-256 + anti-rollback), dual-bank A/B + a hardware monotonic eFuse (env `esp32dev-ota`). Remaining: bring-up on hardware.
15. **F-7:** implement register/claim message signing in the firmware (`b"enrg:device:register"`, `b"enrg:device:claim"`), so the device can run the on-chain lifecycle itself.

### Documentation
16. **D-1:** update `ENRG_Conformance.md` (the current program id `HkuC3…`), sync `STATE.md`, `SECURITY_AUDIT_2026-08-16.md` (mark the fixed items), clarify the Merkle documentation (SHA-256 vs keccak).
17. **D-2/O-10/O-11:** align the `device_id` format and the states enum between on-chain, the off-chain schemas and the oracle (either the schemas or the code).


---

## 6. Priority fixes (what to do first)

### 🔴 P0 — mainnet blockers (before any production deploy)
1. ~~**Remove/isolate the legacy firmware with the hardcoded key** (`esp32_proof_sender.ino`)~~ → **✅ Closed (2026-08-17):** v1/v2 removed from git → `firmware/legacy/` (gitignored), the key redacted.
2. ~~**On-chain manifest signature verification + leaf-to-content binding** (C-3/C-4)~~ → **moved to P1 (D-7):** the on-chain manifest publisher signature is not verified (see recommendation 6).
3. ~~**Fix the mint path for multi-owner** (O-3/O-4)~~ → **✅ Closed in the previous stage:** `mint_submitter_authorized` (C-2: the owner OR a trusted oracle; the reward goes to the owner).
4. ~~**Policy Engine decision** (ADR-0003)~~ → **✅ Closed (2026-08-17):** an on-chain `PolicyRegistry` + `PolicyEngine` (`instructions/policy_engine.rs`); `mint_energy` is the Verifier and enforces the policies.
5. ~~**The device must receive and verify a Manifest** (ADR-0004) + **OTA** (ADR-0008)~~ → **✅ Closed:** the manifest (ADR-0004) — in the previous stage; OTA (ADR-0008) hardened with a cold firmware key, dual-bank A/B and a monotonic eFuse (2026-08-17).

> **Second-wave P0 blockers (2026-08-17) — all 4 closed:**
> 1. **D-1**: the legacy firmware with the key removed from git → `firmware/legacy/` (gitignored), the key redacted.
> 2. **D-2 (ADR-0003)**: on-chain `PolicyRegistry` (PDA `[b"policy-registry"]`) + `PolicyEngine`; `mint_energy` is the Verifier, policies are managed via `update_policy`.
> 3. **D-13 (ADR-0001/0007)**: an SE050 path (hardware Ed25519, env `esp32dev-se050`) + a documented compromise (`SE050-HARDWARE-SIGNING.md`); `ENRG_FOUNDER_PUBKEY_HEX` filled with the real key.
> 4. **D-4/D-5 (ADR-0008)**: a separate cold firmware key (`ENRG_FIRMWARE_PUBKEY_HEX`, `FIRMWARE_SIGNING_KEY_PATH`), dual-bank A/B (`partitions_ota.csv`) + a hardware monotonic counter (eFuse secure_version, env `esp32dev-ota`).

### 🟠 P1 — before mainnet (important)
6. Governance: multisig/timelock for admin operations (`set_vault_authority`), key rotation (C-5, C-6, C-7).
7. Secure device-key storage: SE050 bring-up on hardware + eFuse in production (F-2).
8. Manifest registry persistence + a Merkle-root anchoring schedule (O-8, C-8).
9. Remove the dead/legacy artifacts (routes/manifestRoutes.js, the EVM bridge) (O-7, O-9).
10. Sync the documentation and formats (D-1…D-4, O-10/O-11).

### 🟡 P2 — post-mainnet / roadmap
11. COSE/CBOR attestation, X.509, root-key registry, Guardians multisig, full DAO (ADR-0007/0009), negative proofs (merkle), batch verification.

---

## 7. Conclusion: is ENRG mainnet-ready

**No, ENRG is not mainnet-ready from an AXIS-conformance standpoint.**

- The overall level is **partial conformance (≈ 50–55 %)**, consistent with the project's own "ready for devnet, mainnet deferred" status (`docs/protocol/deployment/mvp-release-readiness.md:4`).
- **A strong core:** the on-chain trust model (ADR-0001/0002/0005) — states, transitions, Ed25519 verifications, nonce/freshness, OracleRegistry — is implemented correctly and at a level suitable for a closed testnet.
- **Critical mainnet gaps:** the missing Policy Engine (ADR-0003), the missing Device Manifest on the device (ADR-0004), the missing OTA and firmware signing (ADR-0008), the unimplemented key rotation/revocation and root-of-trust registry (ADR-0007), the reduced governance (ADR-0009), the broken multi-owner mint, and the legacy firmware with a hardcoded key in the repository.
- **The minimal path to mainnet:** close the P0 items (5 fixes) and the P1 items (5 fixes), then run an independent audit against the ADR-0001…0009 checklist and a repeat devnet verification with real devices (two-sided e2e: ESP32 → Oracle → mint).

---

## 8. Audit limitations

- The analysis was done **statically** (without running on-chain devnet transactions and without building the firmware).
- The tests `tests/merkle-proof-verification.test.ts` and `devnet-merkle-proof-verification.test.ts` contain TS errors/`describe.skip` (`docs/STATE.md:142-143, 153-157`) — the runtime behavior of the Merkle layer is not fully confirmed.
- The full `mint_energy` is covered only by the devnet script `scripts/devnet_e2e_lifecycle.ts`, not by automated tests (`docs/STATE.md:144-149`).
- The JSON schemas were compared byte-by-byte against the Axis-core reference (`diff -q` — all 5 files are identical).

