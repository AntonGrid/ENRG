#!/usr/bin/env bash
# ENRG — build the Colosseum pitch video (demo/pitch-video/ENRG_pitch.mp4).
#
# Everything is derived: the voice-over comes from piper, the visuals from
# ImageMagick + ffmpeg, and the timing is measured from the synthesized audio,
# so on-screen text can never drift out of sync with the narration.
#
# Requirements: ffmpeg, ImageMagick (convert), python3, curl, internet on the
# first run (piper binary + voice model). No sudo needed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ASSETS="${PITCH_ASSETS:-/tmp/assets}"
PIPER_DIR="${PITCH_PIPER_DIR:-/tmp/piper}"
WORK="${PITCH_WORK:-/tmp/pitch-work}"
VENV="${PITCH_VENV:-/tmp/venv}"

VOICE_NAME="en_US-ryan-high"                    # calm male US English
PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz"
VOICE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1" >&2; exit 1; }; }

need ffmpeg; need ffprobe; need convert; need python3; need curl
mkdir -p "$ASSETS" "$WORK/txt"

# ── 1. piper (text to speech) ────────────────────────────────────────────────
if [ ! -x "$PIPER_DIR/piper/piper" ]; then
  say "fetching piper"
  mkdir -p "$PIPER_DIR"
  curl -sSL -o "$PIPER_DIR/piper.tar.gz" "$PIPER_URL"
  tar -xzf "$PIPER_DIR/piper.tar.gz" -C "$PIPER_DIR"
fi

if [ ! -f "$ASSETS/$VOICE_NAME.onnx" ]; then
  say "fetching the voice model ($VOICE_NAME, ~120 MB)"
  curl -sSL -o "$ASSETS/$VOICE_NAME.onnx" "$VOICE_URL/$VOICE_NAME.onnx?download=true"
  curl -sSL -o "$ASSETS/$VOICE_NAME.onnx.json" "$VOICE_URL/$VOICE_NAME.onnx.json?download=true"
fi

# ── 2. fonts: brand faces from the landing submodule (woff2 -> ttf) ─────────
if [ ! -f "$ASSETS/SpaceGrotesk-700.ttf" ]; then
  say "preparing fonts"
  FS="$REPO/landing/node_modules/@fontsource"
  if [ ! -d "$FS" ]; then
    echo "landing/node_modules not found — run: git submodule update --init landing && (cd landing && npm ci)" >&2
    exit 1
  fi
  if [ ! -x "$VENV/bin/python" ]; then python3 -m venv "$VENV"; fi
  "$VENV/bin/pip" install -q fonttools brotli
  "$VENV/bin/python" - "$FS" "$ASSETS" <<'PY'
import sys
from fontTools.ttLib import woff2
fs, out = sys.argv[1], sys.argv[2]
woff2.decompress(f"{fs}/space-grotesk/files/space-grotesk-latin-500-normal.woff2", f"{out}/SpaceGrotesk-500.ttf")
woff2.decompress(f"{fs}/space-grotesk/files/space-grotesk-latin-700-normal.woff2", f"{out}/SpaceGrotesk-700.ttf")
woff2.decompress(f"{fs}/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2", f"{out}/JetBrainsMono-400.ttf")
print("fonts converted")
PY
fi

# ── 3. logo mark (flat accent version of ENRG_Logo.svg) ─────────────────────
if [ ! -f "$ASSETS/logo_enrg.png" ]; then
  say "rasterising the logo"
  cat > "$ASSETS/logo_enrg.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect x="2" y="2" width="60" height="60" rx="14" stroke="#4FC3F7" stroke-width="2.5" fill="#0B1020" fill-opacity="0.95"/>
  <path d="M34 10 18 36h12l-4 18 18-28H32l2-16z" fill="#4FC3F7"/>
</svg>
SVG
  convert -background none -density 600 "$ASSETS/logo_enrg.svg" -resize 320x320 -alpha on "$ASSETS/logo_enrg.png"
fi

# ── 4. render ───────────────────────────────────────────────────────────────
say "rendering (piper + ImageMagick + ffmpeg)"
cd "$HERE"
PIPER_BIN="$PIPER_DIR/piper/piper" \
PIPER_VOICE="$ASSETS/$VOICE_NAME.onnx" \
FONTS_DIR="$ASSETS" \
PITCH_WORK="$WORK" \
python3 render.py "$@"

say "done"
ls -la "$HERE/ENRG_pitch.mp4"
ffprobe -v error -show_entries format=duration:stream=width,height \
  -of default=noprint_wrappers=1 "$HERE/ENRG_pitch.mp4"
