#!/usr/bin/env bash
# rotate-keys.sh — generate FRESH protocol keys for the mainnet (P0-1a).
#
# The founder key leaked at d3664c1 is considered compromised. Before the
# mainnet deploy every role MUST use a fresh key:
#   founder / deployer / oracle (report) / oracle-tx / firmware (cold)
#
# Usage:
#   ./scripts/rotate-keys.sh [output-dir]      # default ./keypairs-mainnet
#
# The script NEVER prints secret material, sets 0600 permissions and refuses
# to run inside the repository tree (so keys cannot be committed by accident).
set -euo pipefail

OUT="${1:-./keypairs-mainnet}"

# Resolve to an absolute path and reject in-repo output.
OUT_ABS="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$OUT_ABS" in
  "$REPO_ROOT"/*)
    echo "❌ Refusing to generate keys inside the repository ($OUT_ABS)." >&2
    echo "   Use an external directory (e.g. \$HOME/keys/enrg-mainnet)." >&2
    exit 1
    ;;
esac

if ! command -v solana-keygen >/dev/null 2>&1; then
  echo "❌ solana-keygen not found. Install the Solana CLI." >&2
  exit 1
fi

mkdir -p "$OUT_ABS"
chmod 700 "$OUT_ABS"

echo "🔐 Generating fresh mainnet keys into $OUT_ABS"
for role in founder deployer oracle oracle-tx firmware; do
  KP="$OUT_ABS/$role-keypair.json"
  solana-keygen new --no-bip39-passphrase --force --silent -o "$KP" >/dev/null
  chmod 600 "$KP"
  PUBKEY="$(solana-keygen pubkey "$KP")"
  echo "  $role: $PUBKEY"
done

cat <<EOF

✅ Done. Keys are in $OUT_ABS (0600).

Next steps (see docs/MAINNET-RUNBOOK.md §0):
  1. Back up the keys offline (HSM / cold storage) — they are NOT recoverable.
  2. Put the pubkeys into:
     - founder/deployer → programs/enrg-mvp/src/constants.rs
       (FOUNDER_WALLET, EXPECTED_DEPLOYER) + redeploy at a NEW program id;
     - oracle → ORACLE_KEY_PATH, register it in the OracleRegistry;
     - firmware → ENRG_FIRMWARE_PUBKEY_HEX (cold) / ENRG_FOUNDER_PUBKEY_HEX.
  3. NEVER commit $OUT_ABS and never push it to any repository.
EOF
