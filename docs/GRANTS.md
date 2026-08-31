# ENRG — Grants & Funding Plan

> **Status:** Active (2026-08-31). Use `docs/POSITIONING.md` as the source of
> truth for any pitch. All applications should reference the live devnet demo
> (two-oracle quorum, finalized attestation, gated mint).

---

## 1. Why grants are the right first money

- Grants are **non-dilutive** — we keep 100% of the project;
- They are the **first external validation** — the reference that multiplies
  the price of every later round / sale;
- DePIN/verification infrastructure is a **priority thesis** for the funds below.

## 2. Target funds (shortlist)

| # | Fund / program | What they fund | Typical size | Notes / links |
|---|---|---|---|---|
| 1 | **Solana Foundation Grants** | DePIN, on-chain infra, tools | $5k–$100k | We are Solana-native (55 instructions). `solana.org/grants` / `grants@solana.foundation` |
| 2 | **peaq DePIN Grants** | DePIN projects building on peaq | $25k–$100k+ | Re-usable module story (oracle/attestation) fits. `peaq.network/grants` |
| 3 | **Filecoin / Protocol Labs** | DePIN, verifiable storage/data | $5k–$20k | Angle: provable physical data + verifiable audit trail. `grants.filecoin.io` |
| 4 | **Gitcoin Grants (public goods)** | Open-source infra | $1k–$50k/round | Great for the open protocol/spec part. `gitcoin.co` |
| 5 | **IoTeX Ecosystem** | DePIN machine verifiability | $10k–$100k | Alignment with "machine identity + attestation". `iotex.io/ecosystem` |
| 6 | **Superteam Solana Earn** | Bounties / micro-grants | $500–$5k | Fast cash on existing skills. `earn.superteam.fun` |
| 7 | **Colosseum / Solana hackathons** | Prize pools | up to $1M pool | Demo the live quorum as a hackathon entry. `colosseum.org` |

**Strategy:** apply to #1 and #2 first (best fit), run #6 in parallel for
near-term income, and use the first grant as a reference for #3–#5.

## 3. Application template (copy-paste, fill the brackets)

> **Project:** ENRG — Cryptographic Trust Between the Physical and Digital Worlds
>
> **One-liner:** Verification infrastructure that makes physical-world data
> (energy production, device telemetry) cryptographically provable via
> hardware-rooted signing (NXP SE050) and a staked multi-oracle quorum with
> on-chain attestation — for audit, certificates (REC/GO/carbon) and DePIN trust.
>
> **Problem:** physical data is unprovable → greenwashing, audit disputes,
> single-oracle arbitrariness in DePINs.
>
> **Solution (3 anchors):**
> 1. Hardware root of trust — non-extractable Ed25519 keys, device identity = signing key;
> 2. Oracle quorum + economics — ≥2 staked oracles, canonical SHA-256 vote,
>    slashing on contradiction, mint gated by finalized attestation;
> 3. On-chain audit trail — every proof/attestation/policy is an inspectable
>    Solana account.
>
> **Proof points (live):**
> - Full stack: ESP32+SE050 firmware → oracles → Solana contract (55 instructions) → AI layer;
> - Devnet live: 2 oracles staked & voted, attestation finalized, gated mint
>   executed, rewards claimed idempotently;
> - Quality: 66 anchor e2e + 92 mocha + 23 cargo, 300+ commits, 10 ADRs,
>   protocol spec v1.0, documented security audits, multisig governance.
>
> **Milestones (proposed):**
> - M1 (month 1): mainnet deployment + public explorer/dashboard;
> - M2 (month 2–3): pilot with a distributed-energy or ESG partner;
> - M3 (month 3–6): certificate/audit product with hardware-proven data.
>
> **Budget ask:** [$X] — breakdown: [infrastructure / hardware samples /
> dev time / pilot incentives]. All funds are engineering + deployment, no marketing padding.
>
> **Team:** founder/solo engineer (full-stack: Solana/Anchor/Rust, IoT
> firmware + SE050, oracles, Python AI/FL). [Add links: GitHub, demo video,
> devnet addresses.]

## 4. One-page handout (for humans)

Short version of `docs/POSITIONING.md` to paste into messages/emails:

> **ENRG — provable physical data.** We build the missing trust layer between
> the physical and digital worlds: devices sign their readings with hardware
> keys (NXP SE050), ≥2 staked oracles attest them on-chain, and slashing +
> a finalized-quorum mint gate make fraud economically irrational. Use cases:
> audit, REC/GO and carbon-credit verification, ESG assurance, DePIN trust.
> Live demo on devnet (2-oracle quorum + gated mint executed); Solana-native
> (55 instructions); 66 e2e + 92 mocha + 23 cargo tests green. More:
> [repo links].

## 5. Action items (this week)

- [ ] Create `docs/ONEPAGER.md` (short PDF-ready version) — next;
- [ ] Record a **2-minute demo video** (devnet quorum live) — the strongest
      proof point for any application;
- [ ] Publish the repo / make it public (or provide a private-link summary);
- [ ] Submit to **Solana Foundation Grants** and **peaq DePIN Grants**;
- [ ] Set up **Superteam Earn** profile and pick 1–2 bounties for income.

---

*Related: `docs/POSITIONING.md`, `docs/MULTI-ORACLE-ROLLOUT.md`,
`docs/MAINNET-RUNBOOK.md`, `MAINNET-AUDIT-2026-08-30.md`.*
