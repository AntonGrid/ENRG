#!/usr/bin/env bash
# Надёжный запуск ENRG-оракула на devnet с founder-ключом и авто-рестартом.
set -u
cd "$(dirname "$0")"

# Ищем founder wallet
FW="${FOUNDER_WALLET_PATH:-$HOME/.config/solana/founder-wallet.json}"
if [ ! -f "$FW" ]; then
  echo "❌ Founder wallet не найден: $FW. Передайте FOUNDER_WALLET_PATH." >&2
  exit 1
fi

export FOUNDER_KEY="$(cat "$FW")"
export NODE_ENV="${NODE_ENV:-development}"

echo "🚀 Oracle on devnet (founder: $(jq -r '' <<< "$FOUNDER_KEY" 2>/dev/null; solana-keygen pubkey "$FW" 2>/dev/null || echo '???'))"
LOG=oracle.log

# Цикл авто-рестарта при падении
while true; do
  echo "[$(date +%T)] starting node server.js (port 3000) ..."
  node server.js >> "$LOG" 2>&1
  code=$?
  echo "[$(date +%T)] oracle exited with code $code; restarting in 2s..."
  sleep 2
done
