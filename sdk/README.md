# ENRG SDK — reference clients

Two clients for the live oracle API (`server.js`), plus the one thing every
integrator gets wrong first: **the wire format**.

| | JavaScript | Python |
|---|---|---|
| file | `sdk/js/enrg-client.js` | `sdk/python/enrg_client.py` |
| needs | Node 18+ (global `fetch`), `tweetnacl` (already a repo dependency) | Python 3.9+, PyNaCl (already in `requirements.txt`) |
| install | copy the file, or `require('./sdk/js/enrg-client.js')` | copy the file, or `pip install pynacl` + import |
| tests | `tests/sdk.test.js` (10) | `tests/test_sdk_python.py` (9) |

Both files are standalone on purpose: an integrator can drop one file into their
codebase. They are also **not allowed to drift** — see the next section.

## The wire format (get this exact, or nothing verifies)

All integers are **unsigned 64-bit little-endian**. `‖` is concatenation.

| message | bytes | who signs it |
|---|---|---|
| `device_message_to_sign` | `device_id(32) ‖ nonce(8) ‖ device_timestamp(8) ‖ energy_wh(8)` | the **device** (Ed25519, inside the SE050 at the conforming tier) |
| `oracle_message_to_sign` | `device_id(32) ‖ nonce(8) ‖ device_timestamp(8) ‖ verified_at(8) ‖ energy_wh(8)` | the **oracle** |
| `proof_hash` | `SHA-256(oracle_message_to_sign)` | — (this is what oracles vote on) |
| `oracle_attest_message` | `b"enrg:oracle:attest" ‖ device_id(32) ‖ nonce(8) ‖ proof_hash(32)` | the oracle, for the on-chain quorum vote |

Normative source: `programs/enrg-mvp/src/state/oracle.rs`
(`OracleReport::device_message_to_sign` / `oracle_message_to_sign`) and
`state/oracle_attestation.rs` (`oracle_attest_message`).

**How the copy is kept honest:** `sdk/vectors/wire_format.json` is generated from
`policy.js` by `npm run wire:vectors` (`scripts/generate-wire-vectors.js`).
`policy.js` is the mirror that `tests/policy-conformance.test.js` pins against the
Rust engine, and **both** language suites assert the same fixture file byte for
byte:

```bash
npm run wire:vectors:check   # fixtures still match policy.js
npm test                     # JS SDK: fixtures + parity with policy.js + HTTP client
pytest -q -p no:anchorpy     # Python SDK: the same fixtures, in another language
```

### Known limitation

`policy.js` builds the u64 fields from JS numbers. Above `Number.MAX_SAFE_INTEGER`
(2⁵³−1) that is silently lossy — the byte layout is fine, the *value* is not. The
JavaScript SDK therefore **throws** instead of truncating; pass a `BigInt` if you
really need such a value. Python has no such trap (arbitrary precision), which is
why the vector `largest-safely-representable-energy` sits exactly at 2⁵³−1.

## Quickstart — read the public data

```js
const { EnrgClient } = require('./sdk/js/enrg-client.js');
const client = new EnrgClient();                     // devnet deployment

const stats = await client.stats();                  // proofs, minted, energy
const net   = await client.oracles();                // registered / with_proofs / idle
const bal   = await client.deviceBalance('EAv5ND…Fm2');
```

```python
from sdk.python.enrg_client import EnrgClient

client = EnrgClient()          # free instance: the client retries a 503 while it wakes
stats = client.stats()
balance = client.device_balance("EAv5NDihqp2JyH4JpZqg9QkMpqxDFBskWdt56YDRmFm2")
```

## Quickstart — act as a device

```js
const { buildDeviceProof, verifyDeviceProof } = require('./sdk/js/enrg-client.js');
const proof = buildDeviceProof({ secretKey: seed32, nonce: 42, deviceTimestamp: now, energyWh: 1000 });
// proof = { device_id, nonce, device_timestamp, energy_wh, device_signature }
await client.submitProof(proof);     // → { ok, mint: 'queued' | 'deferred' | ... }
```

`build_device_proof` / `buildDeviceProof` produce exactly the payload
`POST /api/v1/proof/submit` expects, and `verify_device_proof` /
`verifyDeviceProof` check a signature the way the oracle and the chain do.

> ⚠️ **This SDK signs in software.** That is the `basic` tier (ADR-0007), it is
> fine for development and partner integrations, and it is **not** the
> production path: production devices sign inside the NXP SE050
> (`firmware/esp32_proof_sender`, tier `conforming`).

## Endpoint coverage

`health` · `stats` · `oracles` · `proofs(device, limit)` · `deviceStatus` ·
`deviceBalance` · `deviceHistory` · `submitProof` · `registerDevice` ·
`manifest` · `firmwareLatest`

The full spec is `docs/openapi.json` (generated from `server.js`, checked in CI
by `npm run openapi:check`).
