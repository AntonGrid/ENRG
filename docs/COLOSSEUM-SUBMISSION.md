# ENRG — Colosseum Submission Pack

> **Status:** Active (2026-09-18)
> **Purpose:** the exact text to paste into the Colosseum project card
> `colosseum.com/arena/projects/axis-protocol-cryptographic-trust-for-depin`, a
> checklist of what still blocks points, and drafts for the public updates.
> Card text MUST stay consistent with `docs/POSITIONING.md` (the source of truth
> for messaging) and may only cite numbers from `docs/STATE.md` or the live API.

---

## 1. Card audit (2026-09-18)

| Field | State found | Action |
|---|---|---|
| Name | "Axis Protocol — Cryptographic Trust for DePIN" | Keep the substance; consider leading with **ENRG** — another project on the platform is already called "Axis" (`axis-1`, a crypto index), which invites confusion |
| Tag | `DePIN` | Keep — matches where we actually compete |
| About the project | One sentence, no numbers | Replace with section 2 |
| **Project pitch** | `youtu.be/qrgdc1X9kDU` — "ENRG Protocol — Live Demo on Solana Devnet" | Pitch **rendered** 2026-09-18: `demo/pitch-video/ENRG_pitch.mp4` (2:24, 1080p). Upload it, set it here, and keep the devnet walkthrough below. See `demo/pitch-video/README.md` |
| **Technical demo** | the *same* link as the pitch | Keep this one here; never reuse one link for both fields |
| GitHub · Source code | `AntonGrid/ENRG` | ✅ fixed on 2026-09-18 |
| Website / X | `enrg.network` · `x.com/enrg_protocol` | Keep |
| Team | Anton Gulda (Founder & Protocol Architect) · Vitaly Arteev (**no role**) | Fill the role — section 3 |
| Public updates | **none** (`publicUpdates: historyUnavailable`) | Post section 4 — this is the only proof of an active project |
| Live metrics | last proof **2026-09-05** (13 days old), 0.03 MWh | Refresh before judging — section 5 |

## 2. "About the project" (paste)

**Short version (~330 chars):**

> ENRG is verification infrastructure that makes physical-world data provable on
> Solana. Devices sign readings with a non-extractable SE050 key; ≥2 staked
> oracles must confirm the same hash before anything is minted. Live on devnet:
> 58 instructions, 272 tests, an inspectable audit trail. Not another solar
> token — the trust layer energy DePINs build on.

**Long version (~800 chars):**

> ENRG is verification infrastructure that makes physical-world data
> cryptographically provable on Solana — we sell trust, not tokens.
>
> Devices sign every reading with an Ed25519 key held inside an NXP SE050 secure
> element (non-extractable), so a device cannot be cloned or faked. At least two
> independent, staked oracles vote on the canonical SHA-256 hash of each report;
> a contradictory vote is a slashing event, and minting stays blocked until the
> attestation is finalised.
>
> Live on devnet: 58 on-chain instructions, 272 tests green (125 Rust / 112 Node
> / 21 Python / 14 Foundry), a complete device lifecycle minted through the
> quorum gate, and an audit trail anyone can re-verify independently.
>
> Beyond energy, the same oracle + attestation module is reusable by any DePIN
> that needs trust between the physical and digital worlds.

## 3. Team roles (paste)

- **Anton Gulda — Founder & Protocol Architect.** Anchor/Rust contracts
  (58 instructions), multi-oracle quorum with slashing, ESP32 + SE050 firmware,
  ENRG-AI (federated learning + anomaly detection), protocol specification and
  ADRs.
- **Vitaly Arteev — ⟨role⟩.** Replace with his real contribution (e.g. product /
  frontend: Axis-connect PWA, `enrg.network`, device onboarding UX, demo
  production). A teammate with no role reads as unfilled.

## 4. Public updates (one every 3–4 days)

Each update must carry **one number and one link**. Drafts:

1. **Live state.** "Quorum gate `required=true` on devnet: ⟨N⟩ proofs, ⟨X⟩ kWh,
   ⟨M⟩ minted through a finalised attestation. Metrics:
   enrg-oracle.onrender.com/api/v1/stats · Program: HkuC3FT…"
2. **Hardware + tamper.** "Signed a real meter reading on ESP32+SE050, then
   changed one byte of the payload — the oracle rejected it and nothing was
   minted. A failed transaction, not an audit. Clip: ⟨link⟩."
3. **Pilot.** "First external site connected: ⟨device⟩ publishing ⟨X⟩ kWh/day,
   with ⟨K⟩ independent oracles attesting. Every reading is verifiable on-chain."
4. **Public good.** "Axis Protocol (L0) is an open standard — wire format,
   validation rules, lifecycles and ADRs are public, and the oracle-quorum +
   attestation module is reusable by any DePIN. Spec:
   github.com/AntonGrid/Axis-protocol."
5. **Ask.** "Looking for one pilot partner with a real energy asset and one
   independent oracle operator for the mainnet pilot. Everything is open source;
   devnet is live today."

**Filled example — the first update, ready to post (2026-09-18):**

> Quorum gate `required=true` is live on devnet and just minted again: a fresh
> device went `register → claim → provision → activate`, two independent staked
> oracles (`HC8Was…`, `Hm7Ym7…`) voted on the same canonical SHA-256 hash, the
> attestation finalised and `mint_energy` executed —
> `2ANc1Lf3az4utCDRw9A7Lfp7z2e7oY2kseJoW6k6U9gcq9uCbTMR1gLRY4M8Ctb7hJfQMm3iuHYHacPQRQiXGKT6`
> (confirmed, slot 500485022). Metrics: `enrg-oracle.onrender.com/api/v1/stats` ·
> Program: `HkuC3FT…`

**Live numbers, captured 2026-09-21 17:45 UTC** (`GET /api/v1/stats` — paste the
live ones, not these): `total_proofs 22`, `minted_proofs 15`, `deferred_proofs 7`,
`accepted_proofs 0`, `active_producers 8`, `total_energy_wh 31015`,
`total_energy_mwh 0.03`, `minted_energy_wh 15`, `attestation_rows 28`;
`last_proof_ts 1789759394` → 2026-09-18 19:23 UTC, i.e. **already 3 days old —
refresh it before judging** (`docs/PILOT-REFRESH.md`).

> The endpoint runs on a free Render instance and **sleeps**: the first request in
> a while can answer `503` and the next one a few seconds later answers `200` —
> retry before concluding the oracle is down (this bit a reviewer once).
> `deferred_proofs` grew 6 → 7 while `accepted_proofs` fell 1 → 0 since the
> 2026-09-18 note: the stale 2026-09-05 batch is still parked, which is exactly
> what the pilot refresh clears.

Also verified on 2026-09-18: a third-party
device mint (an owner who did **not** sign the mint received its SRC) —
`3VzmRDVqcNqRdNX8vAPo3wCcLwJXL6LPR1kKhkNaYrHn3KHjZSSHXgzR27BVdRAynVWaipUrjdNC4RRi4eA69ofB`.
How to reproduce: `docs/PILOT-REFRESH.md`.

## 5. Pre-submission checklist

- [ ] Fresh devnet proof **on the day of judging** (last one: 2026-09-05)
- [x] *Project pitch* rendered — `demo/pitch-video/ENRG_pitch.mp4` (2:24, 1920×1080, H.264/AAC, captions in `demo/pitch-video/ENRG_pitch.srt`); upload it and paste the link, then keep *Technical demo* = `qrgdc1X9kDU` (the two fields must not share a link)
- [ ] About replaced (section 2); team roles filled (section 3)
- [ ] GitHub link → `AntonGrid/ENRG` ✅; Axis-protocol cited in the About text as the standard
- [ ] README "Start here" block present; LICENSE consistent; submodules documented
- [ ] ≥3 public updates published during the window
- [ ] Public Goods entry prepared (section 6)
- [ ] Profile in [The Grid](https://thegrid.id) created (ecosystem discoverability)

## 6. Public Goods angle (paste, if the award is present)

> Axis Protocol is an open, implementation-independent standard (L0) with a
> reference implementation (Axis-core, L1) and a first domain profile (ENRG, L2).
> The specification, wire format, validation rules, lifecycles and ADRs are
> public, and the hardware-rooted proof format plus the staked oracle-quorum
> module are reusable by any DePIN: they replace "trust our portal" with a
> signature anybody can verify. Nothing in the trust path is proprietary.

## 7. Messaging guardrails

- Never lead with the token and never use "buyback & burn" (the GitHub *About*
  field still carries that legacy wording — update it).
- Always name three things: the **data class** (physical production data), the
  **enforcement** (stake + slash + finalised-attestation gate) and the **root of
  trust** (SE050 secure element).
- Numbers only from `docs/STATE.md` or the live API — no rounded-up marketing
  figures.

## 8. GitHub repository settings (paste)

The card is not the only first impression — the GitHub *About* box is what a
reviewer reads **before** the README, and today it sells the wrong thing:
verbatim, it says *"…turn any energy … into liquid tokens backed by real kWh.
Energy Vault provides buyback & burn."* That is the exact framing section 7
forbids.

**Description** (replace):

> Verification infrastructure that makes physical-world data provable on Solana.
> Devices sign readings with a non-extractable SE050 key; ≥2 staked oracles must
> confirm the same hash before anything is minted. Live on devnet. We sell trust,
> not tokens.

**Homepage:** `https://enrg.network` (currently empty — or the pitch video once it
is on YouTube).

**Topics:** `solana` · `depin` · `energy` · `oracle` · `attestation` ·
`hardware-security` · `se050` · `rust` · `anchor` · `open-standard` ·
`verifiable-data` · `pilot-project`

**Also done in the repository (no click needed):** `.gitattributes` now marks the
vendored paths, so the language bar reports Rust/TypeScript instead of "Solidity"
— GitHub recomputes it after the next push.

---

*Related: `demo/pitch-video/README.md` (the rendered pitch), `docs/PITCH-VIDEO-STORYBOARD.md`,
`docs/POSITIONING.md`, `docs/COMPETITORS.md`, `docs/GRANTS.md` (long-form applications).*

