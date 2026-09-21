# ENRG — Positioning: Cryptographic Trust Between the Physical and Digital Worlds

> **Status:** Active (2026-09-21)
> **Purpose:** the single source of truth for how we describe ENRG to grants,
> partners, customers and investors. Read this before any pitch/deck/application.

---

## 1. Elevator pitch (one paragraph)

**ENRG is verification infrastructure that makes physical-world data
cryptographically provable.** It turns device readings (energy, metering,
production, environmental data) into signed, on-chain-auditable proofs —
anchored by hardware keys (NXP SE050 secure element) and a multi-oracle
quorum with economic penalties for contradictory reports. We are **not**
another "tokenize your solar" project: we sell **trust**, not tokens.

## 2. The problem (why this matters)

Physical-world data today is **not provable**:

- Utility/ESG reports rely on spreadsheets and "we asked the supplier";
- Renewable certificates (REC/GO) and carbon credits are issued from
  meter/portal data that can be edited, spoofed, or double-counted;
- Every DePIN network has the same weak link: a single oracle can emit
  arbitrary value if it colludes or is compromised.

The result: **greenwashing, audit disputes, and a trust tax on every
verification**. Energy Web calls this "the verification gap" — markets move
in real time, verification still runs on annual manual audits.

## 3. The solution: a trust stack with three anchors

| Layer | What we build | Why it is hard to fake |
|---|---|---|
| **Hardware root of trust** | The device signs every proof with Ed25519. Key storage has three tiers (ADR-0007): NVS (dev), ATECC608A seed vault, **NXP SE050 with on-chip signing** — required by the mainnet build, which fails to compile without it | Device identity *is* the signing key (ADR-0001). Honest status 2026-09-21: the SE050 path is implemented and still awaits bring-up on a real chip |
| **Oracle quorum + economics** | ≥2 **staked** oracles — separate keys, separate instances — vote on a canonical proof hash (`SHA-256`); contradictory votes trigger **slashing**; minting requires a **finalized attestation** (`required=true`) | A single compromised oracle cannot mint value; economic disincentive for fraud (ADR-0006, P3-6). Operator independence is the next milestone, not a claim |
| **On-chain audit trail** | Every proof, attestation, policy decision and reward is a Solana account with a public, inspectable history | Anyone can independently re-verify any claim without trusting us |

## 4. What we sell (segments / products)

1. **Audit & certification infrastructure** — cryptographically provable
   production/usage data for REC/GO issuers, carbon-credit projects and ESG
   assurance providers (instead of "trust our portal").
2. **Proof-of-production for distributed energy** — solar/wind/storage
   installations can prove actual generation to buyers, registries and banks
   (asset-finance collateral).
3. **Supply-chain / device-identity verification** — signed telemetry from
   physical assets, OTA-firmware authenticity (signed updates), key rotation.
4. **DePIN verification toolkit** — the oracle-quorum + attestation module is
   reusable by other DePINs that need "physical ↔ digital" trust.

## 5. Who pays (customers)

- **Registries & certificate issuers** (REC/GO, carbon): cheaper, real-time,
  fraud-resistant verification;
- **Utilities and energy retailers**: P2P settlement on provable generation;
- **Solar installers / EPCs / asset owners**: bankable production data;
- **ESG/assurance firms**: machine-verifiable evidence packs for CSRD/CBAM/SAF
  (same regulatory wave Energy Web addresses — but with a hardware root of trust);
- **Other DePIN projects**: oracle/attestation licensing.

## 6. Why not "just another green token"

| Differentiator | ENRG | Typical competitor |
|---|---|---|
| Root of trust | **Hardware SE050 signature** | Trust in a meter/portal/API |
| Oracle discipline | **Stake + slash + finalized-quorum gate** | Single operator or reputation-only |
| Emission | Dynamic, tied to real energy (energy-per-token, self-adjusting) | Fixed rate (e.g. 1 token/kWh) |
| Device reputation | **ERS** (tiers, limits, quarantine) on-chain | None or off-chain |
| AI layer | **Federated learning** on device data + signed AI signals | None |
| Audit surface | 58 on-chain instructions, 276 tests, public specs/ADR | Opaque off-chain logic |

## 7. Competitive landscape — vs concrete players

Full evidence, statuses and sources: `docs/COMPETITORS.md` (snapshot
2026-09-18). Do not cite a third-party status without re-checking it there.

**vs live Solana energy DePINs** — they ship devices and UX; we ship the proof:

| Player | Their wedge | Our answer |
|---|---|---|
| Sourceful Energy (`sourceful.energy`) | Home DER gateway + P1 meter, app, live today | We are the proof layer under such a device: SE050-signed readings, ≥2 staked oracles, on-chain audit trail |
| Starpower (`starpower.world`) | Consumer plugs/batteries mining `$STAR` | Token incentives vs machine-verifiable production; our emission follows provable MWh |
| DeCharge (`decharge.network`) | EV chargers as DePIN hardware | Their hardware-attestation module (`DePHY OSEM`) is discontinued; ours *is* the product |
| Power Ledger (`TraceX`, `xGrid`; own L1 retired) | REC/EAC marketplace | We verify at the meter, not from market data |

**vs oracle incumbents on Solana** — same grant budget, different data class:

| Player | What they cover | Where we differ |
|---|---|---|
| Chainlink (Data Feeds, CCIP, Functions, CRE) | Price/market data, cross-chain messaging, automation | Physical production data, device-rooted identity, mint gated by a slashing-enforced quorum |
| Pyth (Price Feeds, Lazer, Pythnet) | Low-latency market data | Not a production/device oracle; different buyer |
| Switchboard / Supra / DIA / ORAO / Hypernative | General oracles, RWA price data, VRF, security signals | Purpose-built for hardware attestation + economic penalties |
| Attest Protocol, Orb Oracles (early) | Generic attestations, multi-operator aggregation | Our anchors: secure element + stake/slash, not reputation only |

**vs off-chain and off-Solana incumbents:**

| Player | Their approach | Our answer |
|---|---|---|
| Energy Web | Registry-level fix for "the verification gap" via portals/APIs | Hardware root of trust instead of trusting a portal |
| Daylight (named in a16z, 2025) | Sell energy *and* device data back to utilities | We do not sell the energy — we make the data provable for whoever does |
| Registries & ESG/MRV firms | Annual manual audits, spreadsheets | Real-time, machine-verifiable, independently re-checkable evidence packs |

**Exposure to be honest about:** Sourceful and Starpower already run hardware
fleets (distribution beats architecture until we have a pilot), and
Chainlink/Pyth are the default "trust" answer inside ecosystem grant reviews.
The deciding factor is therefore the **first live pilot**, not the feature list.

## 8. Current proof points (2026-09-21)

- Full vertical stack: **firmware (ESP32 + SE050) → oracles → Solana contract
  (58 instructions) → AI layer (ENRG-AI: FL + reputation)**;
- **Live on devnet**: two independent oracles staked, voted and finalized a
  real attestation; a full device lifecycle (register→claim→activate→mint)
  minted with the quorum gate **required=true**; rewards claimed idempotently;
- **Testing**: 276 tests green — 125 Rust (`cargo test -p enrg-mvp`),
  112 Node (`npm test`), 21 Python (`pytest -q -p no:anchorpy`),
  18 Foundry (`cd onchain && forge test`);
- 300+ commits, 10 ADRs, protocol specification v8.0
  (`docs/ENRG_Technical_Specification_v8.0.md`, 960 lines), 2 security audits
  documented, key-rotation + multisig governance in place.

## 9. North star / roadmap

1. **Mainnet deployment** (Q4 2026) — moves from "prototype" to "live network";
2. **Pilot** with a real distributed-energy or ESG partner (the proof-of-value);
3. **Certificate/audit products** — REC-style issuance with hardware-proven data;
4. **AI layer live** — federated reputation and anomaly signals from device data.

---

*Related: `docs/COMPETITORS.md` (competitive landscape, evidence and refresh
procedure), `docs/GRANTS.md` (funding plan), `docs/MULTI-ORACLE-ROLLOUT.md`
(quorum ops), `docs/MAINNET-RUNBOOK.md` (deployment), audit report
`MAINNET-AUDIT-2026-08-30.md`.*
