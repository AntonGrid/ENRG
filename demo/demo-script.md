# Demo narration (what to say, in English)

> Pair with `demo-recording.sh`. Total ~2 min. Record in English (grants are
> international); subtitles optional.

## Intro (10 s)
> "This is ENRG — open verification infrastructure that makes physical-world
> data cryptographically provable. Not a token project: we sell trust."

## Step 1 — Config (30 s)
> "Here's the on-chain config: minting is gated — `required: true`. A proof
> can only be minted after TWO staked oracle instances confirm it. Also
> note the reward per vote — oracles are economically aligned."

## Step 2 — Oracle #1 votes (30 s)
> "This is a real device proof. Oracle #1 signs the canonical SHA-256 hash of
> the report and votes on-chain. Votes: 1, not yet finalized."

## Step 3 — Oracle #2 votes (30 s)
> "Oracle #2 — a separate instance with its own key and RPC provider — votes the
> SAME hash. Now the attestation is FINALIZED: votes 2, conflict false.
> Any contradictory vote would be a conflict and trigger slashing."

## Step 4 — Rewards (20 s)
> "Oracles earn rewards from the staking fund for finalized attestations —
> claimed here, and it's idempotent: the second run claims nothing."

## Outro (10 s)
> "The full loop is proven on devnet: device register → claim → activate →
> mint through the quorum gate → reward. Repos are public; everything is
> inspectable on-chain. Thank you."

---

## Recording options (no editing needed)
1. **GNOME screen recorder**: press Ctrl+Shift+Alt+R to start/stop — saves a
   webm in ~/Videos;
2. **OBS**: simple window capture, click record;
3. **Phone**: point at the screen, keep it stable;
4. **Text-only backup** (no video):
   `script -c 'bash demo/demo-recording.sh' /tmp/enrg-demo.typescript`
   → this text log is also useful as an artifact in applications.
