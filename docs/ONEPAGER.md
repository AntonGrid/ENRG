# ENRG — One-Pager
*Cryptographic trust between the physical and digital worlds.*

---

**What we do.** ENRG is verification infrastructure that makes physical-world
data cryptographically provable — for **audit, certificates (REC/GO, carbon)
and DePIN trust**. We are not a token project: we sell *trust*.

**The problem.** Physical data is unprovable. Meter readings, ESG reports and
renewable certificates rely on portals and spreadsheets that can be edited,
spoofed or double-counted. A single compromised oracle can emit arbitrary
value in any DePIN.

**The solution — three anchors of trust:**

1. **Hardware root of trust.** Every proof is signed with Ed25519 by the device
   itself. Key storage has three tiers (ADR-0007): NVS (development), an
   ATECC608A seed vault, and **NXP SE050 with on-chip signing** — the tier the
   mainnet build refuses to compile without. Device identity *is* the signing
   key; SE050 bring-up on real silicon is the current milestone.
2. **Oracle quorum + economics.** ≥2 **staked** oracles — separate keys, separate
   instances — vote on a canonical proof hash; contradictory votes trigger
   **slashing**; minting is **gated by a finalized attestation**. One compromised
   oracle cannot mint value.
3. **On-chain audit trail.** Every proof, attestation, policy and reward is an
   inspectable Solana account — anyone can independently re-verify any claim.

**What we sell.**
- Audit & certification infrastructure (provable production data);
- Proof-of-production for distributed energy (bankable data for asset finance);
- Supply-chain / device-identity verification (signed telemetry, OTA authenticity);
- Reusable oracle/attestation module for other DePINs.

**Who pays.** Registries & certificate issuers, utilities, solar installers /
asset owners, ESG assurance firms (CSRD/CBAM/SAF), other DePIN projects.

**Proof points (live, 2026-09-21).**
- Full vertical stack: **ESP32 + SE050 firmware → oracles → Solana contract
  (58 instructions) → AI layer** (forecasting, anomaly detection, federated-round
  tooling — sibling repo ENRG-AI);
- **Devnet live:** two independent oracles staked and voted; attestation
  finalized; a full device lifecycle minted through the **required=true**
  quorum gate; rewards claimed idempotently;
- **Quality:** 276 tests green (125 Rust / 112 Node / 21 Python / 18 Foundry);
  300+ commits;
  10 ADRs; protocol spec v1.0; documented security audits; multisig governance.

**Roadmap.**
1. Mainnet deployment (Q4 2026);
2. Pilot with a real distributed-energy / ESG partner;
3. Certificate & audit products with hardware-proven data;
4. AI layer live (reputation + anomaly signals).

**Ask.** Grant/partner to fund mainnet deployment and a first pilot —
see `docs/GRANTS.md`.

---

*Contacts / links: [GitHub: AntonGrid/ENRG], [demo video — pending],
[devnet addresses — see docs/DEVNET_VERIFICATION.md].*
