# ENRG — Pilot / Live-Activity Refresh Runbook

> **Status:** Active (2026-09-18)
> **Why this exists:** before a Colosseum/judge review the public metrics showed
> a **13-day-old** last proof (2026-09-05) and a `deferred` tail. This runbook
> reproduces fresh, explorer-verifiable on-chain activity in a couple of minutes.

---

## 1. What "fresh" means

| Signal | Where | Baseline before refresh (2026-09-18) |
|---|---|---|
| Public metrics | `GET https://enrg-oracle.onrender.com/api/v1/stats` | `last_proof_ts = 1788612834` (2026-09-05), `deferred_proofs = 6` |
| On-chain | a device minted through the quorum gate | last mint 19.3 days earlier (per commit `69f541f`) |

## 2. Refresh on-chain activity (reproducible, devnet)

```bash
cd /home/enrg/Axis-workspace/ENRG          # or any checkout
SKIP_BOOTSTRAP=1 \
ORACLE_KEY_PATH="$KEY_DIR/oracle-keypair.json" \
ORACLE_TX_KEY_PATH="$KEY_DIR/oracle-tx-keypair.json" \
RPC_ENDPOINT=https://api.devnet.solana.com \
npx ts-node scripts/devnet_e2e_lifecycle.ts
```

Observed run — **2026-09-18**, devnet:

- device `Dk1mzRhfzgSmrRRWaNJ8ZuCu8z6Bvk94JCtkS1iFmvZx`
  (`register → claim → provision → activate`)
- votes: oracle-1 `HC8WasTjgWYtdqmo9CFMo4EFbxibxSXjXHsRyse2FX77`,
  oracle-2 `Hm7Ym7EFhJXcYnsGimHRHrmbJyHzY2sZVgA7CHrrEs4C`
- `mint_energy` tx `2ANc1Lf3az4utCDRw9A7Lfp7z2e7oY2kseJoW6k6U9gcq9uCbTMR1gLRY4M8Ctb7hJfQMm3iuHYHacPQRQiXGKT6`
- `solana confirm -v` → **Commitment: confirmed · Status: Ok · slot 500485022**
  (enrg-profile CPI + SPL token mints)

### Known blocker and its fix

Without `SKIP_BOOTSTRAP=1` the run dies at `add_oracle`:

```text
AnchorError caused by account: registry. Error Code: Unauthorized (6000)
Program log: Instruction: AddOracle
```

The operator wallet is **not** the current `oracle-registry.oracle_admin` — the
roles were rotated on 2026-09-16 (`docs/AUTHORITY-ROTATION-2026-09-16.md`).
Either skip the bootstrap (as above) or sign that step with the key that holds
`oracle_admin` today.

## 3. Refresh the *public* metrics (`/api/v1/stats`)

The stats endpoint moves only when a device **registered on-chain** submits a
proof — the oracle reads the on-chain Registry, not its local DB
(`server.js`, P0-2). Requirements:

- an active `EnergyProducer` PDA for the device (register → claim → activate);
- the device's Ed25519 key — the signed message is
  `device_id ‖ nonce(8 LE) ‖ timestamp(8 LE) ‖ energy_wh(8 LE)` (binary mode);
- a strictly increasing `nonce` and a fresh timestamp (freshness window and
  per-device interval are enforced by the Policy Engine).

**Caveat:** `scripts/devnet_e2e_lifecycle.ts` generates the device keypair in
memory and never persists it, so the proof it mints cannot be replayed against
the oracle API. To keep the public metrics continuously fresh, run a persistent
device — the ESP32 pilot (`firmware/esp32_proof_sender`) or a key-persisting
simulator that saves its keypair outside the repository.

## 4. Health checks (read-only)

```bash
curl -s https://enrg-oracle.onrender.com/health                 # {"status":"ok"}
curl -s https://enrg-oracle.onrender.com/api/v1/stats
curl -s 'https://enrg-oracle.onrender.com/api/v1/proofs?limit=5'  # mint_status per proof
```

`mint_status: deferred` means the queue could not mint (policy, RPC or quorum);
the reason is persisted on the proof row (`mint_error`) — see commit `69f541f`.

## 5. Pre-review checklist

- [ ] on-chain mint from **today** (explorer link ready)
- [ ] `last_proof_ts` from today, or a fresh device on the way
- [ ] no long `deferred` tail (6 outstanding as of 2026-09-18)
- [ ] the day's numbers pasted into the public update (see
      `docs/COLOSSEUM-SUBMISSION.md` §4)

---

*Related: `docs/COLOSSEUM-SUBMISSION.md`, `docs/MULTI-ORACLE-ROLLOUT.md`,
`docs/STATE.md`, `docs/AUTHORITY-ROTATION-2026-09-16.md`.*
