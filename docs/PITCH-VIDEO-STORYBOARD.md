# ENRG — Pitch Video Storyboard (Colosseum submission)

> **Status:** Delivered (2026-09-21) — the pitch is rendered and committed:
> `demo/pitch-video/ENRG_pitch.mp4` (2:27, 1920×1080, English, captions in
> `ENRG_pitch.srt`). The pipeline that produces it (`build.sh`, `render.py`,
> `beats.json`) and its own README live in `demo/pitch-video/`.
> **Purpose:** this document is the *specification* of that film — what it had
> to prove, in what order, and within which limits.
>
> **What remains (account, not code):** upload the file to YouTube (unlisted is
> fine) and put that link into the Colosseum **Project pitch** field, keeping the
> existing devnet walkthrough (`qrgdc1X9kDU`) in **Technical demo** — never one
> link for both fields.

---

## 1. Target

| Parameter | Value |
|---|---|
| Length | **2:00 – 2:30** (hard limit 2:30 — judges stop watching) |
| Aspect / resolution | 16:9, 1920×1080 (same as the technical demo) |
| Language | **English** (international jury) |
| First 12 seconds | must state the problem *and* show hardware — no logos, no intro music |
| End | one concrete ask, on screen as text |
| Where it goes | Colosseum → project → **Project pitch** field (YouTube unlisted is fine) |

## 2. The one thing the video must prove

Winners in Colosseum's hardware/infrastructure categories (Grand Champions
*Unruggable* — hardware wallet; *TapeDrive* — storage network) won on
**demonstrated physical systems**, not on tokenomics. So the spine of this video
is: **a physical device signs a reading, a second party verifies it, and a
tamper attempt fails.** Everything else is supporting material.

## 3. Shot list (with narration)

| Time | Shot | On screen | Narration (English) |
|---|---|---|---|
| 0:00–0:12 | Problem: a spreadsheet with an editable "kWh" cell beside a real meter | text: "Physical data is unprovable" | "Every renewable certificate, carbon credit and ESG report starts with a number somebody can edit. That is the trust gap." |
| 0:12–0:25 | Cut to ESP32 + SE050 board in hand | text: "Hardware root of trust" | "This is ENRG. We make physical-world data cryptographically provable — the device signs what it measures with a key that cannot be extracted from the secure element." |
| 0:25–0:55 | Live: meter → ESP32 reads → serial console prints the reading + Ed25519 signature | zoom on the device, serial output visible | "This is a real reading, signed on the device. The device identity *is* the signing key — you cannot clone the signature even with physical access." |
| 0:55–1:20 | **Tamper scene**: edit one byte of the reading in the payload, re-send | red "SIGNATURE INVALID — MINT REJECTED" | "Now the attack: I change one byte of the reading. The signature no longer verifies, the oracle rejects the report, nothing is minted. Fraud becomes a failed transaction, not an investigation." |
| 1:20–1:45 | Terminal: oracle #1 votes → oracle #2 votes the same SHA-256 hash → attestation FINALIZED → mint | text: "≥2 staked oracles · contradictory vote → slashing" | "Minting is gated: two independent, staked oracles must vote on the same canonical hash. One compromised oracle cannot mint value — a contradiction triggers slashing." |
| 1:45–2:05 | `enrg.network` + Axis-connect PWA: energy produced in kWh, device list, accrual history | text: "The metric is energy, not tokens" | "The user sees energy produced — not tokens. Everything on screen is an inspectable Solana account: proof, attestation, policy, mint." |
| 2:05–2:25 | Summary card + repo URL | text: "ENRG — verification infrastructure · 58 instructions · 295 tests · live on devnet" | "We are not another solar token. We are the verification layer every energy DePIN needs — live today, and we are looking for the first real pilot site." |
| 2:25–2:30 | End card: GitHub + `enrg.network` | — | (silence) |

## 4. Recording recipe

```bash
# 0. Fresh on-chain activity first, so any judge checking the API sees "today"
cd /home/enrg/Axis-workspace/ENRG
npm run test:integration            # or the devnet e2e, whichever is configured
# 1. Record (GNOME: Ctrl+Shift+Alt+R, or OBS) at 1080p
bash demo/demo-recording.sh         # this is the TECHNICAL demo (keep as-is)
# 2. Record the pitch separately: hardware on a phone/2nd camera + screen
```

Rules that keep the recording usable:
- Freeze nothing: fresh device + nonce per take (the script already does this).
- Show the terminal font at ≥16 pt — judges watch on laptops.
- Cut dead time with jump cuts; never show a spinner longer than 2 s.
- Keep the audio from `demo/voice/*.mp3` only for the technical demo; the pitch
  must be live narration (or recorded voice-over read from section 3).

## 5. What to keep from the existing video

Keep `demo/ENRG_live_demo.mp4` (90.9 s, 1080p, with audio, uploaded as
`qrgdc1X9kDU`) **as the Technical demo** — it already proves the quorum
mechanics (votes 1 → 2 → finalized → reward claim, idempotent). Do not delete or
re-record it; the pitch is a *different* artefact with a *different* job.

## 6. Pre-upload checklist

- [ ] Pitch video ≤ 2:30 and states the problem in the first 12 s
- [ ] Hardware visible at least twice (signing + tamper)
- [ ] Tamper attempt shown failing, not merely described
- [ ] On-chain consequence visible (attestation finalized / mint) with an explorer link in the description
- [ ] No token price, no "buyback", no tokenomics language anywhere
- [ ] Description contains: repo URL, `docs/COMPETITORS.md`-backed one-liner, devnet program id
- [ ] Colosseum: *Project pitch* = new video, *Technical demo* = `qrgdc1X9kDU` (never the same link twice)

---

*Related: `docs/COLOSSEUM-SUBMISSION.md` (card text, updates, checklist),
`demo/demo-script.md` (technical demo narration), `docs/COMPETITORS.md` §8
(where we win / where we are exposed).*
