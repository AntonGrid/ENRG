#!/usr/bin/env bash
# Надёжный запуск ENRG-оракула на devnet с founder-ключом и авто-рестартом.
# H-1: секретный ключ НИКОГДА не печатается в stdout/логи и не попадает
# в окружение дочерних процессов — передаётся только ПУТЬ к файлу ключа.
set -u
cd "$(dirname "$0")"

# Ищем founder wallet
FW="${FOUNDER_WALLET_PATH:-$HOME/.config/solana/founder-wallet.json}"
if [ ! -f "$FW" ]; then
  echo "❌ Founder wallet не найден: $FW. Передайте FOUNDER_WALLET_PATH." >&2
  exit 1
fi

# H-1: права на файл ключа — только владелец (0600).
PERMS="$(stat -c '%a' "$FW" 2>/dev/null || stat -f '%Lp' "$FW" 2>/dev/null || echo '?')"
if [ "$PERMS" != "600" ]; then
  chmod 600 "$FW" 2>/dev/null || { echo "❌ Не удалось выставить права 0600 на $FW" >&2; exit 1; }
  echo "ℹ️ Установлены права 0600 на $FW (было $PERMS)."
fi

export NODE_ENV="${NODE_ENV:-development}"
# H-1: в env передаём ТОЛЬКО путь, не сам ключ (server.js читает файл).
export FOUNDER_KEY_PATH="$FW"

# Печатаем только публичный адрес (без секретного ключа).
if command -v solana-keygen >/dev/null 2>&1; then
  PUBKEY="$(solana-keygen pubkey "$FW" 2>/dev/null)"
elif command -v node >/dev/null 2>&1; then
  PUBKEY="$(node -e 'const {Keypair}=require("@solana/web3.js");const fs=require("fs");const k=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))));console.log(k.publicKey.toBase58())' "$FW" 2>/dev/null)"
else
  PUBKEY=""
fi
[ -z "$PUBKEY" ] && PUBKEY="???"
echo "🚀 Oracle on devnet (founder: $PUBKEY)"

LOG=oracle.log

# Цикл авто-рестарта при падении
while true; do
  echo "[$(date +%T)] starting node server.js (port 3000) ..."
  node server.js >> "$LOG" 2>&1
  code=$?
  echo "[$(date +%T)] oracle exited with code $code; restarting in 2s..."
  sleep 2
done

