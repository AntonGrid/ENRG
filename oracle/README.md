# ENRG Protocol — Oracle Server

This server receives signed energy proofs from IoT devices, verifies Ed25519 signatures, accumulates energy, and automatically calls `mint_energy` on the deployed Solana program when the threshold is reached.

## Quick Start
1. Install dependencies: `npm install`
2. Place your founder keypair at `~/founder-keypair.json` (64-byte array) or set `FOUNDER_KEY_PATH`
3. Register device public keys via `POST /api/v1/device/register` (base64-encoded Ed25519 public key + proof-of-possession signature)
4. Start the server: `node server.js`

## API
- `POST /api/v1/device/register` — register a device (proof-of-possession: Ed25519 signature over `device_id|public_key`)
  - **P0-2 (ADR-0002):** the oracle's local registry is NOT the source of truth —
    to accept proofs the device must be registered on-chain
    (`EnergyProducer` PDA, `register_device`).
- `POST /api/v1/proof/submit` — submit a signed energy proof
  - Body: `{ device_id, timestamp, energyWh, nonce, signature }`
  - `device_id` — the base58 Ed25519 public key (32 bytes)
  - The public key and nonce are taken from the **on-chain Device Registry**
    (EnergyProducer PDA). A device without on-chain registration is rejected
    (`404 device_not_registered_on_chain`).
  - `signature` — a base64 Ed25519 signature in the **binary** (on-chain) or **legacy** (string) format
- `GET /api/v1/manifest/:device_id` — a signed **Device Manifest** (ADR-0004)
  - Response: `{ device_id, rated_power, oracle_url, public_key, timestamp,
    trust_level, heartbeat_interval, proof_threshold, policy_version,
    verifier_endpoint, signature }`
  - Signature: Ed25519 with the founder key (`FOUNDER_KEY`) over the canonical string
    `device_id|rated_power|oracle_url|public_key|timestamp|trust_level|heartbeat_interval|proof_threshold|policy_version|verifier_endpoint`
    (see `policy.buildManifestMessage` / `verifyManifest`)
  - The device verifies the signature with the embedded founder public key BEFORE
    using the manifest; with an invalid manifest no proofs are sent
  - The optional query parameter `?rated_power=<W>` — override the power
- `POST /api/v1/firmware/update?version=1.2.0[&model=ENRG-ESP32-v1]` — publish an OTA image (ADR-0008)
  - Body: the raw binary firmware image; header `x-api-key: <FIRMWARE_ADMIN_KEY>`
  - Saves the image into `firmware/updates/` (or `FIRMWARE_UPDATES_DIR`),
    signs the metadata with the founder key (`version|image_hash|image_size`),
    returns `{ ok, version, image_size, image_hash, signature }`
- `GET /api/v1/firmware/latest` — the current firmware metadata
  (`{ version, image_hash, image_size, model, image_url, signature, signed_by, issued_at }`)
- `GET /api/v1/firmware/latest/image` — the binary image (headers `X-Firmware-Version`, `X-Firmware-Hash`)
- `POST /api/v1/device/revoke/:device_id` — **device revocation** (ADR-0007)
  - Founder only (the transaction is signed with `FOUNDER_KEY` = vault.authority)
  - Calls the on-chain `revoke_device` → `revoked=true`, state `Revoked` (terminal)
  - A revoked device can neither mint nor change state
- `POST /api/v1/device/rotate/:device_id` — **key rotation** (ADR-0007)
  - Body: `{ new_device_id, owner_signature, new_device_signature }`
  - `owner_signature` — the Ed25519 signature of the owner (the producer authority) over
    `` `${device_id}|${new_device_id}` `` — the owner intent confirmation
  - `new_device_signature` — the Ed25519 signature of the NEW key over
    `b"enrg:device:rotate" || new(32) || owner(32) || nonce(8) || ts(8)`
    (proof-of-possession of the new key)
  - Calls the on-chain `rotate_device_key`: the old record → `revoked` + `rotated_to`,
    the new record inherits the state (owner, nonce, energy, tier)
- `GET /api/v1/device/:id/status` | `GET /api/v1/device/:id/balance` | `GET /api/v1/device/:id/history`
- `POST /api/v1/pool/create`, `GET /api/v1/stats`
  - ⚠️ **Pool (audit 2026-08-18, P1):** the off-chain pool accumulates energy,
    but does NOT distribute tokens. The real distribution happens on-chain
    (`instructions/pool.rs::distribute_pool`); the oracle passes `pool=null` to
    `mint_energy`. When the threshold is reached an honest response is returned:
    `pool_threshold_reached_offchain_distribution_not_implemented`.

## Policy Engine (ADR-0003)

All inbound-data validation is extracted from `server.js` into a separate module
**`policy.js`** — this matches the Axis ADR-0003 requirement (Verifier ≠ Policy
Engine). `server.js` (the Verifier) only receives data and executes decisions,
`policy.js` (the Policy Engine) decides proof admissibility.

### Validation functions (each — a separate check)

| Function | What it checks | Errors (HTTP / error) |
|---|---|---|
| `validateDeviceId(id)` | base58 or `0x`-hex (≤128 chars, no special chars/XSS) | `400 invalid device_id format (base58 or hex only)` |
| `validateEnergyWh(v)` | number/string, finite, `> 0`, `≤ maxEnergyPerReportWh` | `400 invalid energyWh …` / `400 energyWh exceeds maximum…` |
| `validateTimestamp(ts, nowSec?)` | number/string, finite, freshness (5-min skew, age ≤ 15 min) | `400 FutureTimestamp` / `400 StaleProof` |
| `validateNonce(n, lastNonce)` | a positive integer, strictly greater than `lastNonce` | `400 invalid nonce …` / `400 InvalidNonce` |
| `validateSignature(params)` | 64/32-byte length, Ed25519 binary or legacy format | `400 invalid signature format` / `401 invalid signature` |
| `validateRegister(device_id, public_key, signature)` | format + proof-of-possession | `400 …` / `403 invalid signature: proof of device key ownership required` |
| `validateProof(proof, ctx)` | all the checks above in one call | the first error code |

Example call from server.js:

```js
const v = policy.validateProof(req.body, {
    getPublicKey: (id) => devices[id] || null,      // the device registry
    getLastNonce: (id) => (energyStore[id] || { nonce: 0 }).nonce,
});
if (!v.ok) return res.status(v.status).json({ error: v.error });
```

### Policy configuration

The limits are defined in **`policy-config.json`** in the repo root (or via environment
variables — env has priority over the file, the file over the defaults).

| policy-config.json key | Env var | Default | Meaning |
|---|---|---|---|
| `maxEnergyPerReportWh` | `MAX_ENERGY_PER_REPORT_WH` | `1000000000` | max energy in one report (Wh) |
| `maxTimestampSkewSec` | `MAX_TIMESTAMP_SKEW_SEC` | `300` | the stamp is not more than N sec in the future (5 min) |
| `maxProofAgeSec` | `MAX_PROOF_AGE_SEC` | `900` | a report no older than N sec (15 min) |
| `rateLimitPerMinute` | `RATE_LIMIT_PER_MINUTE` | `100` | the global rate limit (req/min per IP) |
| `oracleUrl` | `ORACLE_URL` | `http://localhost:3000` | the public oracle URL for the Device Manifest (ADR-0004) |
| `defaultRatedPowerW` | `DEFAULT_RATED_POWER_W` | `10000` | the default rated_power (W) in the Device Manifest |
| `maxFirmwareSizeBytes` | `MAX_FIRMWARE_SIZE_BYTES` | `2000000` | the max OTA image size (bytes) |

Example `policy-config.json`:

```json
{
  "maxEnergyPerReportWh": 1000000000,
  "maxTimestampSkewSec": 300,
  "maxProofAgeSec": 900,
  "rateLimitPerMinute": 100,
  "oracleUrl": "https://oracle.enrg.network",
  "defaultRatedPowerW": 10000,
  "maxFirmwareSizeBytes": 2000000
}
```

The file path can be overridden via `POLICY_CONFIG_PATH`.
The configuration is loaded at oracle startup; at runtime it is available as
`policy.config` (for tests — `policy.setConfig()`, `policy.reloadConfig()`).

### Multi-owner mint (ADR-0003)

The mint is executed by **any trusted oracle from the OracleRegistry**, not the founder:

1. **The oracle key** is set separately from the founder:
   - `ORACLE_KEY` (env, a 64-byte JSON array) or `ORACLE_KEY_PATH` (file) —
     loaded via `policy.getOracleKeypair()`.
   - The oracle public key must be **in the on-chain OracleRegistry**
     (`addOracle`), otherwise `mint_energy` returns `UntrustedOracle`.
2. **On-chain** (`mint_energy`):
   - C-0: `report.oracle ∈ OracleRegistry`;
   - C-2: the transaction signer = the device owner **OR** `report.oracle`
     (a multi-owner mint);
   - the reward goes to the device **owner** (`producer.authority`), not the oracle;
   - the report is signed with the oracle key (not the founder).
3. **The oracle signs** the OracleReport with its key and sends the transaction
   `mint_energy` (authority = the oracle key); the owner ATA is created
   automatically (`getOrCreateAssociatedTokenAccount`).

Adding an oracle to the OracleRegistry (on-chain):

```bash
# generate the oracle key and store it in a secure place
solana-keygen new -o oracle-keypair.json
# add to the registry (authority = oracle_admin, default vault.authority)
# via the Anchor client: program.methods.addOracle(oraclePubkey)...
#  .accounts({ registry: oracleRegistryPda, authority: oracleAdmin })
```

If `ORACLE_KEY_PATH`/`ORACLE_KEY` is unset, the mint is unavailable
(`oracle_key_missing`); the oracle keeps working (proof intake, manifests, OTA).

### Tests

```bash
npm run test:policy        # mocha tests/policy.test.js (Policy Engine unit tests)
npm run test:manifest      # tests/manifest.test.js
npm run test:firmware      # tests/firmware.test.js
npm run test:keyrotation   # tests/keyrotation-api.test.js
npm run test:mint          # tests/mint-oracle.test.js (multi-oracle mint)
npm run test:anchor        # anchor test --skip-build (on-chain, solana-test-validator)
```

## Configuration
- `ENERGY_THRESHOLD` — Wh to accumulate before minting (default: 1,000,000 Wh = 1 MWh)
- `PROGRAM_ID` — deployed Solana program address
- `MINT_ADDRESS` — SRC token mint
- `FOUNDER_KEY` / `FOUNDER_KEY_PATH` — the founder key (oracle), signs the OracleReport
- `RPC_ENDPOINT` — the Solana RPC (default devnet)
- `ENRG_SQLITE_PATH` / `DATABASE_URL` — the storage (SQLite / PostgreSQL)

