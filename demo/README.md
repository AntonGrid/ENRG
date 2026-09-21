# ENRG — videos

Two films, two purposes. They must never share a link in the Colosseum card.

| File | What it is | Where it lives |
|---|---|---|
| `pitch-video/ENRG_pitch.mp4` | **Project pitch** — 2:24, English, who is behind ENRG, the problem, what runs today, the ask | **In this repository** (with captions `pitch-video/ENRG_pitch.srt`) |
| `ENRG_live_demo.mp4` | **Technical demo** — the devnet walkthrough: register → claim → provision → activate → two oracle votes → finalised attestation → mint | **Not in the repository** (heavy; `.gitignore` → `demo/*.mp4`). Published on YouTube: `https://youtu.be/qrgdc1X9kDU` |

## Recording another take of the technical demo

- `demo-script.md` — the narration, step by step, timed.
- `demo-recording.sh` — drives the sequence used in the recording.
- `process_recording.sh` — turns the raw capture into the published file.
- `subtitles.srt` — the captions of the existing take.
- `voice/` — local voice assets (not tracked).

## Rebuilding the pitch

See [`pitch-video/README.md`](./pitch-video/README.md): the whole film is
generated from `pitch-video/beats.json` by `build.sh` (piper + ImageMagick +
ffmpeg), so the on-screen text cannot drift from the narration.