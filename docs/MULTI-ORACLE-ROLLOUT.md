# Multi-Oracle Rollout (P3-5, audit 2026-08-30)

How to run an **independent oracle instance** in the ENRG network. The
architecture supports 2+ operators against a single on-chain OracleRegistry;
each instance reports its identity via `GET /api/v1/oracles` (verified live:
two instances with keys `HC8Was…` and `Hm7Ym7…` served the same 12-oracle
registry).

## Requirements for an operator

- A **registered oracle key**: the pubkey must be in the on-chain
  OracleRegistry (`add_oracle`, authority = oracle_admin). Request onboarding
  from the protocol admin, or run it yourself if you hold the admin key.
- A host (bare metal / VM / container) with Node 20+, outbound access to the
  Solana RPC and a managed Postgres (or SQLite for a low-volume pilot).
- The **firmware-signing key** only if you publish OTA images (optional for a
  mint-only oracle).

## Run an instance

```bash
git clone https://github.com/AntonGrid/ENRG.git
cd ENRG
npm ci

# Key files (0600, never commit):
export ORACLE_KEY_PATH=/secure/oracle-keypair.json        # your registered key
export FOUNDER_KEY_PATH=/secure/founder-wallet.json       # signer for mint txs
# RPC failover list (different provider than other operators!):
export RPC_ENDPOINTS="https://mainnet.helius-rpc.com,https://api.mainnet-beta.solana.com"
export DATABASE_URL=postgres://user:pass@host:5432/enrg   # your own DB
export MINT_QUEUE_MAX=10000 MINT_MAX_ATTEMPTS=8

node server.js
```

## Verify your instance

```bash
curl -s http://YOUR_HOST/api/v1/oracles
# → { "this_instance": "<your oracle id>", "registry_pda": "...",
#     "count": 12, "oracles": [ ... ] }
```

- `this_instance` must be **your** key.
- The same `registry_pda` and oracle set must appear on every other instance
  (that is the shared on-chain source of truth).
- `GET /api/v1/proofs` now attributes each proof to the accepting oracle
  (`oracle_id`), so anyone can see which operator handled what.

## Network hygiene

- Use a **different RPC provider and jurisdiction** than other operators
  (resilience against a single RPC/cloud outage).
- Keep your key files 0600; never put them in env dumps, logs or CI.
- Run `pio` firmware with your build only if you are the device manufacturer
  or have the firmware cold key.

## Economics (next phase)

Deposits + slashing for contradictory reports and reward distribution from
the staking fund will make honest operation economically rational. The
k-of-n on-chain quorum (per the EVM attestation pattern) is the planned
follow-up (P3-6).

## Related

- `docs/MAINNET-RUNBOOK.md` — full mainnet deployment.
- `docs/MAINNET-GOVERNANCE.md` — Squads multisig for registry/governance.
- `docs/KEY-ROTATION-2026-08-30.md` — current keys and operators.
