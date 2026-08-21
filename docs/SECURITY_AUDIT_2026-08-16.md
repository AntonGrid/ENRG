# 🔐 ENRG Protocol security and architecture audit

**Date:** 2026-08-16
**Scope:** `/home/enrg/Axis-workspace/ENRG` (the `enrg-landing` folder was not reviewed on request)
**Mode:** read-only/analysis

---

## 1. Executive Summary

The project consists of **two loosely coupled worlds**: (a) the on-chain Anchor program `enrg-mvp`/`enrg-profile` with a solid trust model (dual Ed25519 signatures, OracleRegistry, strict nonces, device lifecycle), and (b) the off-chain Node.js oracle `server.js`, which **runs its own, far more weakly protected device and energy database and is not connected to the on-chain mint** (the transaction format does not match the borsh `OracleReport`, the oracle signatures are zero — the mint physically cannot pass). The critical problems are concentrated in the off-chain layer: **unauthenticated device registration with the ability to overwrite someone else's key**, **no validation of `energyWh`/`timestamp` at all**, and a **founder-key leak to stdout** via `run-oracle.sh`. On-chain has medium risks: front-running role capture at initialization (no deployer pinning) and a practically uncontrolled `rated_power` (up to 100 GW) in `enrg-profile`. `npm audit` shows 17 vulnerabilities (7 high). **Overall risk level: HIGH** — the critical holes are closed by 3–5 actions, but as-is the off-chain oracle must not be published outside an isolated network.

---

## 2. Prioritized vulnerabilities

### 🔴 CRITICAL

---

#### CR-1. Unauthenticated device registration and public-key replacement
- **File/line:** `server.js:229–257` (the `POST /api/v1/device/register` endpoint), used in proof verification at lines `323–338`.
- **Description:** the endpoint requires neither authentication nor proof of key possession. Worse: if the `device_id` already exists, **the public key is simply overwritten** (lines 239–244). The `/api/v1/proof/submit` endpoint verifies the signature against `devices[device_id]` — so after the key overwrite an attacker can fully impersonate any device.
- **How to reproduce:**
  1. `POST /api/v1/device/register {"device_id":"dev_real","public_key":"<base64 32 bytes of the attacker key>"}` — the victim's key is overwritten.
  2. `POST /api/v1/proof/submit {"device_id":"dev_real","timestamp":...,"energyWh":1000000,"nonce":1,"signature":"<signed with the attacker key>"}` — energy accumulates under the victim's name; at the 1 MWh threshold a mint is triggered.
- **Fix:**
  - Registration only with a signed challenge (proof-of-possession), as in the on-chain `register_device` (`device_lifecycle.rs:54–77`).
  - Disallow overwriting an existing key without a signature from the old key; add an admin endpoint for key replacement.
  - Validate the `device_id` format (base58/hex, no special characters — see M-5).

---

#### CR-2. No validation of `energyWh` and `timestamp` in `/api/v1/proof/submit`
- **File/line:** `server.js:316–381`. Only field presence (319) and nonce monotonicity (327) are checked. `express-validator` is **not used** here (unlike `/register`).
- **Description:** `energyWh` is unbounded: no `> 0` check, no finiteness check (`Number("NaN")/Number("-500")` pass), no upper limit and no cross-check against the device power. `timestamp` is not checked for freshness at all (no `verify_timestamp` equivalent). Consequences: (a) a device can "mine" an arbitrary amount of energy with one signed proof; (b) a negative value shrinks the accumulator/pools and breaks statistics; (c) `NaN` reaching `saveEnergy` corrupts the SQLite row (the DB already has junk records — see M-5). If CR-3 is fixed, this hole becomes direct token inflation.
- **How to reproduce:** any device with a registered key signs `device|ts|1000000000000|nonce` → the accumulator instantly exceeds the threshold.
- **Fix:** validate `energyWh` (integer, `1 ≤ energyWh ≤ max` based on the power profile), `timestamp` within ±5 minutes of server time, strictly increasing nonce; add rate-limiting and double-submission protection.

---

#### CR-3. The oracle mint path is incompatible with the on-chain program (dead/broken code)
- **File/line:** `server.js:188–227` (`mintEnergy`), `server.js:158–186` (`createProducerIfNeeded`); the same errors in `scripts/first-mint.js:84`, `scripts/test-deploy.js:125`, `scripts/fix_mint_authority_and_mint_energy.js:41–84`.
- **Description:** `mint_energy` (Anchor) receives **not a borsh `OracleReport`** (needs 8 bytes of discriminator + 224 bytes: `oracle(32)+device_id(32)+nonce(8)+device_timestamp(8)+verified_at(8)+energy_wh(8)+device_signature(64)+oracle_signature(64)`), but a hand-made 88-byte buffer; the `Buffer.alloc(64)` signatures are zero; there are no ed25519 precompile instructions in the transaction; the producer PDA is derived with the seed `[b"producer", founderKeypair]` instead of `[b"producer", device_id]` (cf. `device_lifecycle.rs:28–35`); the on-chain `authority` must be the producer owner, not the founder. Result: the transaction always fails at deserialization/signature verification. Real tokens are **never minted** via this path, and even after "fixing" the deserialization the program would still reject the zero signatures. The correct on-chain flow exists only in `scripts/devnet_e2e_lifecycle.ts:755–859` (v0+LUT, two ed25519 precompilations).
- **How to reproduce:** run the oracle, accumulate ≥ 1 MWh, observe `mint_failed`/`instruction error`.
- **Fix:** rewrite `mintEnergy` as an Anchor client (`program.methods.mintEnergy(report)`), generate `oracle_signature` via `oracle_message_to_sign()` (`state/oracle.rs:55–65`), include ed25519 instructions before the program call, use the correct PDAs. Or remove the mint from `server.js` entirely, keeping it as a "verifier + accumulator" for the Policy Engine (ADR-0003 conformance).

---

### 🟠 HIGH

---

#### H-1. Founder-key leak to stdout and env
- **File/line:** `run-oracle.sh:17` — `echo "🚀 Oracle on devnet (founder: $(jq -r '' <<< "$FOUNDER_KEY" ...))"`. An empty `jq -r ''` filter prints the **entire key JSON** (on this machine `jq` is not installed, so only the pubkey is visible in `oracle-boot.log` — but with jq present the key is printed in full to stdout/log). Additionally, the key is passed via the `FOUNDER_KEY` env var (`run-oracle.sh:12`, `docker-compose.yml:17`), making it visible in `/proc/<pid>/environ` and to child processes.
- **File/line (git check):** the key is NOT found in git history (`git log --all -S`, `.env`, keypair files were checked). `~/.config/solana/founder-wallet.json` exists on disk (outside the repo) — that is fine, but there is no permission/rotation control.
- **How to reproduce:** install `jq`, run `./run-oracle.sh` — the secret key appears in the terminal.
- **Fix:** print only the pubkey (`solana-keygen pubkey "$FW"` or `node -e`); never write `FOUNDER_KEY` to stdout/logs; replace env with a `0600` file or a secrets manager; `set -u` + a file-permission check.

---

#### H-2. Front-running protocol role capture (init without deployer pinning)
- **File/line:** `oracle_registry.rs:7–21` (`initialize_oracle_registry` — authority/oracle_admin = the first signer), `init_config.rs:11–27` (no guard at all), `governance.rs:11–25`, `initialize_token.rs:24–42`. Contrast: `manifest_registry.rs:53–78` already has a correct guard (`if registry.authority == default`).
- **Description:** on a "fresh" cluster anyone watching the mempool can beat the legitimate deployer, initialize the `oracle-registry`/`config`/`governance`/`token-mint` PDA first and become `oracle_admin` → add **their own** key to the trusted-oracle list → mint arbitrary amounts (C-0 `mint.rs:44–47` would pass). This is a classic first-mover capture.
- **How to reproduce:** on an empty devnet, be the first to send `initialize_oracle_registry` with your wallet, then `add_oracle` for your key.
- **Fix:** pin the deployer address (`constraint = authority.key() == EXPECTED_DEPLOYER`) or introduce two-step initialization (create → claim by a known address); apply the `manifest_registry.rs` guard pattern to all `init` instructions.

---

#### H-3. Hardcoded device private key in firmware
- **File/line:** `firmware/esp32_proof_sender/esp32_proof_sender.ino:22–27` — a static `private_key[32] = {0x01,0x02,...}`; the DB-registered `dev_e2e_001` matches it. Also `:11` — `http://YOUR_ORACLE_IP:3000` (plaintext HTTP → MITM), `:106` — `timestamp = millis()/1000` (uptime, not wall-clock).
- **Description:** the key is stored in plaintext in the repository; anyone can sign proofs on behalf of `dev_e2e_001`. The plaintext channel allows request interception/replacement. "Since boot" time does not pass the on-chain freshness check and is meaningless off-chain.
- **How to reproduce:** extract the key from the `.ino`, sign a proof for `dev_e2e_001`.
- **Fix:** generate the key at first boot (the `identity.cpp` pattern), remove keys from the repository, move the exchange to HTTPS/mTLS, use NTP/RTC.
- **Resolution (2026-08-17):** ✅ the legacy v1 was removed from git (D-1); v1/v2 moved to `firmware/legacy/` (folder in `.gitignore`, outside the delivery). The private key was redacted in the archived copy.

---

#### H-4. Device keys in NVS without a Secure Element — ADR-0001 violation
- **File/line:** `identity.cpp:19–23, 88–96` — the private key is written to NVS (flash) in plaintext; `identity.cpp:114–120` — it is loaded into RAM for signing. ATECC608 (or equivalent) is **not used** (a search of the codebase and docs found nothing).
- **Description:** ADR-0001 ("the key never leaves the device", `docs/architecture/adr/ADR-0001...`) requires a Secure Element or equivalent. NVS can be read with physical access to the device (JTAG, flash dump) → identity compromise.
- **Fix:** integrate ATECC608A (key in a protected slot, signing inside the chip), enable flash encryption (eFuse), disable JTAG.

---

#### H-5. Manifest Registry with a default admin key
- **File/line:** `oracle/registry/app.js:14` — `const ADMIN_KEY = process.env.REGISTRY_ADMIN_KEY || 'secure-key';` and `:115–123` (the snapshot endpoint checks `x-api-key`). The key is static, known from the code, compared by value.
- **Description:** when deployed without env configuration, anyone knows the `secure-key` admin key and can issue "official" Merkle snapshots. Additionally, the JS registry never anchors roots on-chain via `update_merkle_root` — the snapshots exist only off-chain.
- **How to reproduce:** `curl -H 'x-api-key: secure-key' -X POST http://host:4000/api/v1/merkle/snapshot`.
- **Fix:** fail hard at startup without `REGISTRY_ADMIN_KEY`; authorize via a signed request (Ed25519) or rotating HMAC; implement a real on-chain root anchor.

---

### 🟡 MEDIUM

---

#### M-1. Outdated vulnerable dependencies (npm audit: 17 vulnerabilities, 7 high)
- **Packages (all from the root `package.json`/tree):** `bigint-buffer` (high, buffer overflow, GHSA-3gc7-fjrx-p6mg), `ws` (high, memory-exhaustion DoS, GHSA-96hv-2xvq-fx4p), `brace-expansion` (high, DoS, GHSA-mh99-v99m-4gvg / GHSA-rgw5-rvv9-x895), `js-yaml` (high, quadratic CPU, GHSA-5p4m-2wfm-xmqj), `serialize-javascript` (high, RCE/DoS, GHSA-5c6j-r48x-rmvq), `@solana/web3.js` (moderate, via `jayson`), `uuid` (moderate, via jayson), `mocha` (moderate), `body-parser` (low). Direct dependencies: `@solana/web3.js@1.98.4`, `@solana/spl-token@0.4.15`, `@coral-xyz/anchor@0.32.1`, `mocha@11.7.6`.
- **Fix:** `@solana/web3.js` → `^2.x` (or ≥1.99) + a compatible `@solana/spl-token`; `ws` → `≥8.20.2` (or `7.5.11`); `mocha` → `^11.3.0` (dev); `js-yaml`/`serialize-javascript`/`brace-expansion` — only the dev/test tree, they do not reach the `server.js` prod runtime (check package-lock); `body-parser` comes with express 4.x — update to `≥1.20.6`.

#### M-2. SQLite without replication; state in memory
- **File/line:** `server.js:29` (`new Database('./enrg.db')`), `server.js:90–92` (in-memory `devices/energyStore/pools`). There is no Postgres replication (SQLite is used). `enrg.db` sits in the repo root (in .gitignore), without WAL and backups.
- **Fix:** move to Postgres with replication (or at least WAL + hourly backups + moving the DB out of the app directory); accumulator recovery — the source of truth must be on-chain, not local SQLite.

---

#### M-3. Weak replay protection: `MAX_PROOF_AGE = 1 year`
- **File/line:** `security/validation.rs:8` (`MAX_PROOF_AGE = 31_536_000`), `verify_timestamp` lines 19–26. The spec (`Axis-workspace-ENRG-DOCS.txt` §12) requires "no older than 15 minutes". The off-chain `server.js` does not check freshness at all.
- **Fix:** `MAX_PROOF_AGE = 900`; off-chain add a `|now - timestamp| ≤ 300` check.

#### M-4. `rated_power` under the device owner's control (up to 100 GW)
- **File/line:** `enrg-profile/src/lib.rs:18` (`MAX_RATED_POWER = 100_000_000_000`), `lib.rs:93–108` (`update_metadata` — owner-only, no verification), `mint.rs:96–97` (`report.energy_wh <= profile.rated_power`). The Industrial/Institutional tier has no monthly limit (`producer.rs:66–72`), the tier is assigned by the protocol admin (`tier.rs`).
- **Description:** the owner sets their own "ceiling" up to 100 GWh per report. For tiers without a limit, the only real constraint is oracle honesty. Plus a functional gap: `init_energy_profile` creates a profile with `rated_power=0` (`device_lifecycle.rs:269`); without a manual `update_metadata` the mint is impossible at all.
- **Fix:** set `rated_power` at provisioning from a certified manifest (ADR-0004), per-report limit = `rated_power × report_window`, tier assignment only via governance/multisig.

#### M-5. Junk/XSS `device_id` in the DB and their reflection in responses
- **File/line:** `server.js:231` (validation is only `isString/notEmpty`), `server.js:266–272` (the status endpoint returns `device_id`). `enrg.db` already contains a `<img src=x onerror=alert(1)>` record and a device with a zero key (`AAAAAAAA...A==`).
- **Fix:** restrict the `device_id` charset (base58/hex), escape/encode values in JSON responses, reject zero keys.

#### M-6. CORS `null` + bind `0.0.0.0` without TLS/rate-limit
- **File/line:** `server.js:116–128` (origin `'null'`), `server.js:403` (`app.listen(PORT, '0.0.0.0')`). Endpoints with no authentication and no rate limiting.
- **Fix:** remove `'null'`, reverse proxy with TLS, rate limiting (e.g. `express-rate-limit`), authorize admin endpoints.

---

### 🟢 LOW

#### L-1. No `/health` on the main oracle
- `server.js` has no `/health` (only `/api/v1/stats`). `/health` exists in FastAPI (`app/main.py:11`) and in the registry (`oracle/registry/app.js:91`). Add it.

#### L-2. Test-ledger keypair in git history
- Commit history contains `test-ledger/validator-keypair.json`, `stake-account-keypair.json`, `vote-account-keypair.json`, `faucet-keypair.json` (standard localnet keys, absent from the current tree). It is advisable to clean the history (`git filter-repo`).

#### L-3. 500 responses to broken signatures; log with full paths
- `server.js:336–338` — `Buffer.from(signature,'base64')` without a length check → `nacl` throws "bad signature size" → 500 instead of 400 (visible in `error.log`). Return 400 and do not log full stacktraces with host paths.

---

## 3. Mandatory checklist answers

| Question | Answer |
|---|---|
| Who can call `mint_energy`? | On-chain — **anyone** who assembles a valid `OracleReport`: a device signature + the signature of a **trusted oracle** from the OracleRegistry (C-0), `device_id` matches the producer (C-1), signer = the producer owner (C-2). Off-chain `server.js` — calls the mint itself on ≥1 MWh accumulation, but without a valid oracle signature (CR-3). |
| "Trusted oracle" check? | Yes, on-chain: `oracle_registry.contains(&report.oracle)` (`mint.rs:44–47`). But the oracle list can be captured via front-running (H-2). |
| Who registers devices? | On-chain: anyone (the operator pays rent), but a device signature (proof-of-possession) is mandatory. Off-chain `server.js`: **anyone, without any checks** (CR-1). |
| Does the owner sign the transaction? | On-chain: yes, `authority: Signer` + `producer.authority == authority.key()`. Off-chain: no owner concept (CR-1/CR-2). |
| `energy_wh`/`timestamp` checks in `mint_energy`? | On-chain: yes (`energy_wh ≤ rated_power`, freshness ≤ 1 year, strictly increasing nonce). Off-chain: **no** (CR-2). |
| Replay protection? | On-chain: `verify_nonce` (`validation.rs:11–14`) + `MAX_PROOF_AGE`. Off-chain: only a monotonic nonce; bypassed via key overwrite (CR-1). |
| Energy limits per call? | On-chain: `rated_power` (the owner controls up to 100 GW, M-4) + the tier monthly limit. Off-chain: no limits (CR-2). |
| Where is `FOUNDER_KEY` stored? | In the `FOUNDER_KEY` env or `~/.config/solana/founder-wallet.json` (outside the repo, perms `0600`). It **never entered git** (history checked). Risks: stdout via `jq` (H-1), `/proc/PID/environ`, docker env. |
| Risk of entering git history? | No current leaks. The history still contains the test-ledger keypair (L-2) — not the founder key. |
| Secure Element (ATECC608)? | **No.** Keys in NVS in plaintext (`identity.cpp`), H-4. |
| Oracle down — recovery? | `run-oracle.sh` has an infinite restart loop, but there is no systemd/journal, no queue of unsent proofs, and the mint is impossible without the oracle (the oracle is the only signer). |
| Database? | SQLite (`better-sqlite3`), without replication and backups (M-2). Postgres is not used. |
| `/health`? | Present in FastAPI and the registry; **absent** in the main oracle (L-1). |
| npm audit | 17 vulnerabilities: 7 high / 8 moderate / 2 low (M-1). |

---

## 4. AXIS architectural conformance (ADR-0001 / 0003 / 0005)

- **ADR-0001 "The key never leaves the device"** — the on-chain model conforms (the device signs register/claim/proof, the server only verifies). But the execution is broken: a hardcoded key in the `.ino` (H-3), keys in NVS without a Secure Element (H-4), the off-chain server stores `public_key` in its own DB (fine), but allowed an overwrite without proof-of-possession.
- **ADR-0003 "The oracle does not make policy decisions — Policy Engine"** — **deliberately deferred** (documented: `docs/STATE.md:24`, `docs/adr/adr-0009-governance.md:14`). In practice the Policy Engine is co-located in `mint_energy` (comment in `mint.rs:18–27`) and in `server.js` (accumulation, thresholds, pools). This is a documented MVP simplification, but it means: the off-chain oracle is currently the sole judge of "how much energy was real".
- **ADR-0005 "Device states"** — fully implemented on-chain (8 states, `state/producer.rs:15–37`, `device_lifecycle.rs`). **Divergence:** the off-chain `server.js` does not know about on-chain states and keeps its own registry (`devices`/`energyStore`), i.e. ADR-0002 (registry = single source of truth) is violated off-chain — two independent sources of truth, and the off-chain version is safely weaker.
- Additional "specification ↔ code" divergences: the spec requires 15-minute proof freshness (M-3); the firmware signs a **string** `device|ts|energy|nonce`, on-chain requires **binary** `device_id‖nonce‖ts‖energy` — incompatible formats (CR-3); `max_energy_wh = max_power_w * 10 / 60` from the docs does not match the `energy_wh <= rated_power` check in the code; openapi describes `/provisioning/register` with proof-of-possession, the implementation has none.

---

## 5. Minimal fix plan (5 actions)

1. **Close CR-1/CR-2 (off-chain):** registration via a signed challenge + no key overwrite without a signature from the old key; strict `energyWh`/`timestamp` validation in `/proof/submit`; rate limiting. This closes unauthorized device access and data forgery in the off-chain loop.
2. **Fix CR-3 (the mint path):** rewrite `mintEnergy` as an Anchor client with a correct `OracleReport`, a real oracle signature and ed25519-precompile instructions (following `devnet_e2e_lifecycle.ts:755–859`); remove the dead scripts `first-mint.js`/`test-deploy.js`/`fix_mint_authority...js`.
3. **Eliminate the key leak (H-1):** `run-oracle.sh` — print only the pubkey; file `0600`; do not pass the key via env when possible.
4. **Close front-running (H-2):** pin the expected deployer in all `init` instructions (or a guard like in `manifest_registry.rs`); for the already-deployed devnet — check the current `oracle_admin` and change it via `set_oracle_admin` if needed.
5. **Update dependencies (M-1) and add `/health` + a TLS reverse proxy (L-1, M-6):** `@solana/web3.js`, `ws`, `mocha`; deploy the oracle only behind TLS with restricted CORS origins.

---

*Report prepared from the read-only audit of 2026-08-16. All files and lines are relative to the `~/Axis-workspace/ENRG` root.*
