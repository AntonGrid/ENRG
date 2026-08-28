# ADR-0010: ENRG-AI as the Intelligence Layer of the DePIN Pilot

**Status:** Proposed
**Date:** 2026-08-27
**Authors:** Axis Protocol Team

---

## Context

The physical DePIN pilot is live on Solana devnet: an ESP32 device
(`0xcbec5afc…`) signs Ed25519 energy proofs every ~60 s, the Render oracle
(`enrg-oracle.onrender.com`) validates them and mints SRC via `mint_energy`
(ADR-0003 Policy Engine path). The oracle already persists per-device energy
and nonce in SQLite, and on-chain state exists (producer, energy profile,
`reputation` ERS PDA, mint transactions).

Separately, ENRG-AI provides an autonomous intelligence stack:

- `agent/digital_feeds` — pluggable feeds (weather/solar irradiance,
  blockchain, finance, macro, news, science) normalized into a uniform series
  matrix (`collect` / `collect_series`);
- `agent/digital_train` — a headless self-training pipeline (feeds → matrix →
  domain-agnostic model → persisted state → optionally signed as a federated
  contribution);
- `agent/ai` — anomaly detection, forecasting, market/recSys modules;
- `agent/fed`, `agent/hfl` — federated / hierarchical federated learning;
- `agent/pilot` — a pure simulator used today.

Today ENRG-AI consumes synthetic and external data only; it has no link to the
live proof stream or to on-chain state. This ADR decides how to attach ENRG-AI
to the running pilot without weakening the protocol's trust boundaries.

## Decision

Attach ENRG-AI in **three layers**, implemented in order:

### Layer 1 — Data bridge (read-only)

1. The oracle exposes proof history as a read-only endpoint, e.g.
   `GET /api/v1/proofs?device_id=…&limit=…` returning
   `device_id, timestamp, energy_wh, nonce, mint_tx, status`.
2. ENRG-AI adds a new digital feed `enrg_pilot` (in the `digital_feeds`
   module) that pulls proof history from the oracle REST API **and** on-chain
   state (producer / energy profile / reputation PDA) via the public RPC. The
   feed emits the same `FeedResult` shape as every other feed, so
   `collect_series` and `digital_train` consume it unchanged.
3. The feed is optional: when the oracle/RPC is unreachable, the pipeline
   falls back to offline/simulated data (no hard failure).

### Layer 2 — Intelligence (off-chain only)

ENRG-AI runs on real pilot data:

- a **digital twin** of device generation (features: hour of day, solar
  irradiance `GHI`, device type, rolling window) using `digital_train`;
- an **anomaly detector** over the proof stream (inter-proof interval, energy,
  hour-of-day fit, plausibility vs. solar irradiance — a solar panel should
  not produce at night), reusing `agent/ai/anomaly`;
- a **short-horizon forecast** of generation, reusing `agent/ai/forecast`.

Results are published as **off-chain, oracle-signed attestations** via a
read-only endpoint (e.g. `GET /api/v1/ai/assessments`) for observability and
auditing. They are recommendations only.

### Layer 3 — On-chain ERS loop (trusted oracle only)

A narrow, rate-limited on-chain action closes the loop:

- periodically (e.g. once per N hours per device) the oracle aggregates the
  AI plausibility assessment over the window and, if the device is a
  registered producer, invokes the existing `reputation` update instruction
  on-chain (the PDA `reputation` already exists on devnet).
- The oracle remains the only signer with on-chain write authority; AI has no
  keys and no direct write path.

## Constraints / Trust Boundaries

- **AI does not make proof-admissibility decisions.** Admissibility stays in
  the Policy Engine (ADR-0003); AI output may only *inform* oracle policy
  parameters (e.g. ERS updates), never gate Proof acceptance directly.
- **AI has no device keys** (ADR-0007) and no oracle keys; it reads only
  public endpoints and public RPC.
- **No new privileged program** is required on devnet for Layer 3 — the
  existing `reputation` PDA and existing oracle authority are reused.
- **Anomaly flags never block proofs** (no DoS vector); they only affect
  rate-limited ERS updates.
- All feed data is normalized to the existing `FeedResult` / series-matrix
  contract so `digital_train`, `fed`, and `hfl` remain unchanged.

## Rationale

- **Separation of concerns** (extends ADR-0003): analysis (AI), execution
  (oracle), admissibility (Policy Engine) stay in distinct components.
- **Maximum reuse:** `digital_train` already implements feed collection,
  matrix building, model fitting and (optionally) federated signing; only a
  new feed + adapters are needed.
- **Live data beats simulation:** training and anomaly detection on the real
  proof stream make every ENRG-AI module (twin, forecast, anomaly, market)
  meaningful for the actual pilot.
- **Closed loop with minimal surface:** ERS is already on-chain; wiring AI
  scores into rate-limited `update_reputation` calls closes the loop without
  new contracts or key material.

## Consequences

- The oracle API grows by read-only endpoints (`/api/v1/proofs`,
  `/api/v1/ai/assessments`); SQLite history is extended with `mint_tx` and
  mint status.
- ENRG-AI gains a `pilot`/`enrg_pilot` feed module, an anomaly adapter for
  proof-shaped features, and CLI entry points (`python -m agent.digital_train…`
  and a dedicated assessment command).
- Oracle operational cost: proof history retention + periodic ERS update
  signing. ERS updates are rate-limited and validated (maximum frequency per
  device, signature checks) to prevent manipulation.
- False positives from the anomaly detector are possible; they remain
  advisory and cannot interrupt the minting pipeline.

## Alternatives Considered

- **Embed AI directly into the oracle (`server.js`)** — rejected: couples ML
  to the oracle process, enlarges the attack surface, and makes the
  intelligence layer non-modular.
- **On-chain ML (program calls an AI oracle / computes scores in the program)**
  — rejected: out of pilot scope, compute-unit limits, no stable on-chain ML
  stack.
- **AI writes on-chain directly with its own keypair** — rejected: grants a
  new privileged actor and violates ADR-0007; on-chain writes stay
  oracle-only.
- **Keep AI fully simulation-based** — rejected: the pilot produces real data
  and real value; staying synthetic forfeits validation of the AI layer.

## Related ADRs

- ADR-0002 — Device Registry as the Single Source of Truth (AI reads registry
  state through the oracle/RPC, never writes).
- ADR-0003 — Oracle Policy Engine (AI is not a policy decision-maker).
- ADR-0006 — Core Protocol vs. Energy Profile (AI operates at the profile /
  reputation level).
- ADR-0007 — Security / Key Management (AI holds no device or oracle keys).
- ADR-0009 — Governance Protocol (future ERS calibration changes go through
  governance, not directly through AI).

## Implementation Notes

**Phase 1 — Data bridge**

- `server.js`: add `GET /api/v1/proofs` (device filter, limit, pagination);
  persist `mint_tx` and mint status per proof.
- ENRG-AI: `agent/digital_feeds/pilot.py` implementing `fetch()` /
  `fetch_offline()` and registration in `registry.py`; extend
  `collect_series` coverage.
- CLI check: `python -m agent.digital_train.pipeline --once --offline --points 48`
  with `enrg_pilot` feed enabled.

**Phase 2 — Intelligence**

- `agent/ai/anomaly.py`: adapt to proof-shaped features
  (`energy_wh, interval_sec, hour_of_day, solar_ghi`).
- `agent/digital_train/data.py`: add these columns to the series matrix.
- Oracle: `GET /api/v1/ai/assessments` serving oracle-signed JSON attestations
  (off-chain observability).

**Phase 3 — On-chain ERS loop**

- Collector job on the oracle: windowed aggregation of AI plausibility scores.
- Invoke the existing `reputation` update instruction for registered
  producers, rate-limited, with the oracle keypair.
- Monitor: correlate ERS changes with reward behavior via the Policy Engine
  and the on-chain `reputation` PDA.

---

