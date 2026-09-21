# ADR-00X: ENRG Core Protocol vs Energy Deployment Profile

**Status:** Proposed  
**Date:** 2026-07-16  
**Authors:** ENRG Core Team  

## 1. Context

Inside the team and in external communication, two different layers are often mixed up:

1. **The ENRG protocol itself**  
   — an abstract decentralized infrastructure layer for:
   - the cryptographic identification of real devices and processes;
   - building and verifying proofs of real-world events;
   - running economic mechanisms (emission, rewards, DAO) based on these proofs.

2. **A concrete energy scenario (ENRG-Energy Profile v1)**  
   — the first instantiation of the protocol in the energy domain:
   - devices: inverters, meters, ESP32 gateways, etc.;
   - the measured quantity: Wh/kWh/MWh;
   - the event type: energy production/consumption/balancing.

Historically ENRG was often described as an "energy protocol" or "a protocol for renewable energy". This is convenient for explanations, but:

- it creates the false impression that the protocol is **hard-wired to energy**;
- it constrains thinking when designing other domains (IoT, industrial sensors, climate metrics, etc.);
- it hinders separating the **protocol core** from the concrete usage profiles.

We need to formally fix in the architecture:  
**what exactly ENRG-Core is**, what an **ENRG-Energy Profile** is, and how we talk about this in all documents.

---

## 2. Problem

Without this separation, systemic problems arise:

1. **Semantic confusion**
   - Text like "the protocol pays for energy" or "1 MWh = 1 SRC" creates the impression that:
     - token = a commodity,
     - protocol = an electricity market.
   - In reality:
     - the protocol does not "know" about energy as a commodity at all,
     - it operates with *events and proofs*.

2. **Architectural constraints**
   - Developers and partners start to believe that:
     - ENRG cannot be applied to IoT outside energy,
     - all on-chain models are forever wired to kWh/MWh.
   - This complicates scaling to other real-world domains.

3. **Regulatory and legal risks**
   - Wording about "paying for electricity" or "the MWh price":
     - can lead to SRC being treated as a direct commodity surrogate or a means of payment,
     - although in fact SRC is the **protocol native incentive token**, not a direct cash equivalent of electricity.

4. **Documentation inconsistency**
   - ENRG is described differently across documents:
     - somewhere as an energy protocol,
     - somewhere as a general "proof + reward layer".
   - New team members, auditors and partners get a contradictory picture.

An explicit and stable architectural agreement is required.

---

## 3. Decision

We separate the notions of **ENRG Core Protocol** and **ENRG Deployment Profiles**, and formalize **ENRG-Energy Profile v1** as the first deployment profile.

### 3.1. Definition: ENRG Core Protocol

> **ENRG Core is an open decentralized infrastructure protocol for the cryptographic recording and economic rewarding of trustworthy real-world events.**

ENRG-Core defines:

1. **Device/actor identity**
   - The device identity model (keys, binding to an owner/operator).
   - Device registries (on-chain / off-chain with on-chain anchors).

2. **The message and proof model**
   - The message format from devices (e.g. `{device_id, timestamp, value, nonce, signature}`).
   - Cryptographic requirements (Ed25519 or other schemes).
   - Mandatory validation fields (nonce, ranges, monotonicity, etc.).

3. **Oracle roles and interfaces**
   - As off-chain orchestrators:
     - they collect and check the raw data flow,
     - they build aggregated **Oracle Reports**,
     - sign and send them on-chain.

4. **On-chain report validation**
   - Report signature and structure checks.
   - Device identity, nonce, time, limit and policy checks.
   - Accepting or rejecting the report as a network event.

5. **Economic primitives**
   - The emission function: `reward = f(event, total_supply)`  
     (in the current implementation — an asymptotic model with increasing difficulty).
   - The native SRC token mint mechanism.
   - Reward distribution (producer vs protocol funds).
   - A base staking / treasury / DAO model.

6. **Guarantees and invariants**
   - A fixed `MAX_SUPPLY`.
   - Emission is bound only to verified events.
   - An explicit separation of:
     - the **physical domain** (what is exactly measured),
     - the **protocol domain** (which events and proofs count as valid).

Important: **in ENRG-Core there is no "energy" as an embedded entity**.  
There are only abstract:

- devices,
- measurements,
- proofs,
- events,
- economic reactions to them.

### 3.2. Definition: Deployment Profile

> **A Deployment Profile is a concrete instantiation of ENRG-Core in a given real-world domain.**

A profile defines:

- what exactly counts as an **event**,
- which **device types** and measurements are supported,
- which **additional validation rules** apply (domain business logic),
- how all this maps onto the ENRG-Core model (which proof fields, bounds, units of measurement, etc.).

Profiles can be:

- ENRG-Energy v1 (energy),
- ENRG-IoT v1 (general sensors),
- ENRG-Climate v1 (climate data), etc.

### 3.3. Definition: ENRG-Energy Profile v1

> **ENRG-Energy v1 is the first deployment profile whose event objects are energy events (production/consumption/balancing).**

In ENRG-Energy v1:

- **Event**:  
  "Device X, owned by participant Y, recorded at time T a change of the energy meter reading by ΔWh, confirmed by the device signature and verified by the oracle."
- **Devices**:  
  inverters, meters, ESP32 gateways and similar devices able to:
  - measure energy reliably,
  - sign data with their key.
- **Measured quantity**:  
  energy in Wh/kWh/MWh (the unit choice is part of the profile, not the core).
- **Profile-specific checks**:
  - reading monotonicity,
  - allowed bounds for power and cumulative generation,
  - geography/grid-parameter conformance (if required).

The key point:  
**this is just a concrete "skin" over ENRG-Core**, not a protocol entity.

### 3.4. SRC in the Core and Profiles context

> **SRC is the ENRG-Core native incentive token, issued for confirmed real-world events.**

- In ENRG-Energy v1 the event = an energy event.
- In another profile (e.g. ENRG-IoT) the event can be different (sensor traffic, industrial telemetry, etc.).
- At the Core level:
  - SRC is **not a "payment per kilowatt-hour"**,
  - SRC **does not fix an "MWh price"**,
  - SRC **is bound to validated events**, not to a commodity.

The default wording:

- "SRC is the protocol economic mechanism serving the trust layer, not the protocol goal itself".

---

## 4. Consequences

### 4.1. What changes in the documentation

1. **In all key documents** (whitepaper, README, economics ADRs, presentations):
   - we introduce an explicit separation into:
     - ENRG-Core,
     - ENRG-Energy v1 (and the following profiles).
   - Wording like:
     - "the protocol pays for electricity",
     - "1 MWh = 1 SRC"  
     is **forbidden** or marked as historical/outdated.

2. **New sections / edits**:
   - `docs/core/what-is-enrg-core.md` — the base domain-neutral description.
   - `docs/profiles/enrg-energy-v1.md` — the energy-profile specifics.
   - The economics ADRs (emission, funds, staking) describe:
     - the general model (at the Core level),
     - the concrete energy binding — only within the corresponding profile.

### 4.2. What changes in communication

- Externally:
  - "ENRG is a protocol of trust and incentives for real-world events; our first profile is energy".
- Inside the team:
  - any architectural discussion starts by clarifying:
    - are we talking about the **Core**,
    - or a concrete **Profile (Energy / IoT / …)**?

### 4.3. Pros

- A clear responsibility split:
  - the Core handles cryptography, validation and economics.
  - the Profiles handle the domain specifics.
- Easy scaling to other domains without breaking the core.
- Lower regulatory/legal risks:
  - the token is not positioned as "direct payment for energy".
- Better readability for audits:
  - an auditor sees the protocol as a general layer and energy as a concrete application.

### 4.4. Cons / risks

- It requires:
  - going through all existing documents and removing "energy-centric" language where the Core should be meant;
  - introducing term-usage discipline in communication and code.
- Transitional wording is possible:
  - for a while old materials will contradict the new structure until they are updated.

---

## 5. Alternatives Considered

1. **Leave everything as-is (ENRG = energy protocol)**  
   Rejected as:
   - limiting scalability,
   - creating extra regulatory risks,
   - hindering a clear layer separation.

2. **Split the branding (a separate name for Core, separate for Energy)**  
   Rejected for now:
   - it complicates the brand and communication,
   - Core and Energy stay in one project; the documentation separation is enough.

---

## 6. Implementation Notes

- This ADR must be:
  - added to `adr/`,
  - linked from the `README` and the architecture overview.
- The following ADRs (economics, the Proof model, the Ed25519/Oracle model):
  - must explicitly state whether they belong:
    - to ENRG-Core,
    - to a concrete deployment profile (and which one).

---

## 7. Deliberate MVP deviations from Axis Core (ADR-0002/0003/0006)

Revision status: **v7.0-compatible**. The `enrg_mvp` implementation (Solana/Anchor)
makes three deliberate trade-offs for the MVP cost and complexity. Each
trade-off is recorded with its reason and an extraction plan.

### 7.1. On-chain Verifier and Policy Engine (ADR-0003) — status: SPLIT (2026-08-17)

- **Axis Core spec (ADR-0003):** the Verifier handles only cryptography and
  data passing; the Proof admissibility decision is made by the Policy Engine —
  a separate component.
- **Status (after 2026-08-17, closing P0 blocker D-2):** the split is DONE.
  - The on-chain `PolicyRegistry` (PDA `[b"policy-registry"]`) + `PolicyEngine`
    (`instructions/policy_engine.rs`, `state/policy.rs`).
  - `mint_energy` — the Verifier: device and oracle Ed25519 signature checks
    (`security::verify_ed25519_signature`), freshness/nonce (`security::validation`),
    the device_id binding; decisions — via the PolicyEngine (oracle whitelist, ADR-0005
    state gating, tier limits, energy caps, the supply cap, a mint pause).
  - The off-chain oracle: all decisions are moved into `policy.js` (the Policy Engine).
- **Known deviation (audit 2026-08-18):** PolicyRegistry is optional in
  `MintEnergy` (without the PDA the default policies apply — backward
  compatibility). For mainnet we recommend initializing the registry and
  moving `set_policy_authority` under governance (ADR-0009).

### 7.2. Core and Domain Profile in one contract

- **Spec:** ENRG-Core (identity, proofs, economics) and the ENRG-Energy Profile
  (the domain metric Wh/kWh/MWh) — separate layers.
- **MVP:** `enrg_mvp` contains both the core and the energy-profile economics;
  `enrg-profile` (EnergyProfile PDA: rated_power, device_type, a 30-day window)
  is already extracted into a separate program with the CPI `record_production`.
- **Reason:** separating layers on Solana requires CPIs and separate deploys —
  for the MVP, core + energy economics in one program is cheaper.
- **Plan:** a full extraction of the domain logic into `enrg-profile` (and future
  IoT/other profiles) via CPI; the Core stays domain-neutral.

### 7.3. Device Registry — the source of truth (ADR-0002)

- The `EnergyProducer` PDA (`[b"producer", device_id]`) — the on-chain source of truth
  for the device state: lifecycle (ADR-0005), tier (v7.0 §15), nonce/anti-
  replay. The metadata (power, type, location) and the rolling window live in
  `enrg-profile` (EnergyProfile PDA), bound by authority. A device state change
  happens only via the registry instructions
  (`provision/activate/quarantine/revoke`), which matches ADR-0002.

### 7.4. Quarantine is decided by the Policy Engine, not the Verifier

- In the MVP the quarantine/maintenance/revoke decision is made by explicit
  owner-gated instructions (`device_lifecycle.rs`), not by the Verifier.
  Profile anomalies (v7.0 §27) are recorded by a trusted oracle
  (`report_anomaly`) and lower the ERS (v7.0 §16) — but do not move the device
  into quarantine automatically; the direct state decision stays with the Policy Engine
  (a future dedicated program, see 7.1).

### 7.5. RFC 2119 — a brief mandatory summary

- MUST: proof of device key possession at register/claim;
  an oracle Ed25519 report signature; nonce/timestamp anti-replay;
  a supply cap ≤ MAX_SUPPLY_ATOMIC; a one-time founder premine;
  emission only via mint_energy/governance_mint.
- SHOULD: ERS-weighted pool; monthly tier limits.
- MAY: ENRG Market premium access (`ers_premium_access` — an interface stub).

---

