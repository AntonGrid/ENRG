#!/usr/bin/env bash
# Reliable ENRG oracle launch on devnet with the founder key and auto-restart.
# H-1: the secret key is NEVER printed to stdout/logs and never enters
# child process environments — only the KEY FILE PATH is passed.
set -u
cd "$(dirname "$0")"

# Look for the founder wallet
FW="${FOUNDER_WALLET_PATH:-$HOME/.config/solana/founder-wallet.json}"
if [ ! -f "$FW" ]; then
  echo "❌ Founder wallet not found: $FW. Pass FOUNDER_WALLET_PATH." >&2
  exit 1
fi

# H-1: key file permissions — owner only (0600).
PERMS="$(stat -c '%a' "$FW" 2>/dev/null || stat -f '%Lp' "$FW" 2>/dev/null || echo '?')"
if [ "$PERMS" != "600" ]; then
  chmod 600 "$FW" 2>/dev/null || { echo "❌ Failed to set 0600 permissions on $FW" >&2; exit 1; }
  echo "ℹ️ Set 0600 permissions on $FW (was $PERMS)."
fi

export NODE_ENV="${NODE_ENV:-development}"
# H-1: pass ONLY the path in the env, not the key itself (server.js reads the file).
export FOUNDER_KEY_PATH="$FW"

# Print only the public address (no secret key).
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

# Auto-restart loop on crash
while true; do
  echo "[$(date +%T)] starting node server.js (port 3000) ..."
  node server.js >> "$LOG" 2>&1
  code=$?
  echo "[$(date +%T)] oracle exited with code $code; restarting in 2s..."
  sleep 2
done

