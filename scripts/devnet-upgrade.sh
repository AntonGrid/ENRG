#!/usr/bin/env bash
# ENRG — devnet program upgrade (P3-6). Prepares the buffer from the
# operator key and hands the final Upgrade/IDL signature to the deployer key
# (H3tXm4Z…, the program's upgrade authority).
#
# 1) The deployer must first fund the operator (once):
#      solana -u devnet transfer <H3tXm4Z-keypair.json> GkdhQQgUBi2Q422nTBP27LADkejijRwJEAnfhPYsUJSV 6.6 \
#        --allow-unfunded-recipient
#    (or any other way to top up the operator to >= 6.6 SOL).
# 2) Run this script (uploads the buffer, sets its authority to the deployer):
#      ./scripts/devnet-upgrade.sh
# 3) The deployer signs (they hold the H3tXm4Z keypair):
#      solana program deploy --upgrade-authority <H3tXm4Z-keypair.json> \
#        -u devnet <BUFFER_FROM_STEP_2> HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb
#      ANCHOR_WALLET=<H3tXm4Z-keypair.json> anchor idl upgrade \
#        --provider.cluster devnet HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb idls/enrg_mvp.json
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER="${1:-devnet}"
DEPLOYER_PUBKEY="H3tXm4ZHzNPKotuV7QbWjvd5Bjvv2ATmkvp35z7L7ixM"
PROGRAM_ID="HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb"
SO="target/deploy/enrg_mvp.so"
BUF_JSON=/tmp/enrg-buffer.json

[ -f "$SO" ] || { echo "❌ $SO missing — run anchor build first"; exit 1; }

bal=$(solana -u "$CLUSTER" balance --output json 2>/dev/null | python3 -c "import json,sys;print(float(json.load(sys.stdin)['lamports'])/1e9)")
need=$(solana rent "$(stat -c%s "$SO")" | grep -oE '[0-9.]+ SOL' | head -1 | cut -d' ' -f1)
echo "operator balance: ${bal} SOL | buffer rent: ~${need} SOL"
if [ "$(echo "$bal < $need" | bc -l)" = "1" ]; then
  echo "❌ not enough SOL on the operator. Fund it first:"
  echo "   solana -u $CLUSTER transfer <$DEPLOYER_PUBKEY-keypair.json> \\"
  echo "     GkdhQQgUBi2Q422nTBP27LADkejijRwJEAnfhPYsUJSV 6.6 --allow-unfunded-recipient"
  exit 1
fi

echo "⏳ uploading buffer…"
solana program write-buffer -u "$CLUSTER" --output json-compact "$SO" > "$BUF_JSON"
BUFFER=$(python3 -c "import json;print(json.load(open('$BUF_JSON'))['buffer'])")
echo "✅ buffer: $BUFFER"

echo "⏳ handing buffer authority to the deployer…"
solana program set-buffer-authority -u "$CLUSTER" "$BUFFER" --new-buffer-authority "$DEPLOYER_PUBKEY" >/dev/null
echo "✅ buffer authority: $DEPLOYER_PUBKEY"

cat <<EOF

═══════════════════════════════════════════════════════════════════
The deployer (owner of $DEPLOYER_PUBKEY) must now run:

  1. Program upgrade (uses BUFFER=$BUFFER):
     solana program deploy --upgrade-authority <H3tXm4Z-keypair.json> \\
       -u $CLUSTER $BUFFER $PROGRAM_ID

  2. IDL upgrade:
     ANCHOR_WALLET=<H3tXm4Z-keypair.json> anchor idl upgrade \\
       --provider.cluster $CLUSTER $PROGRAM_ID idls/enrg_mvp.json
═══════════════════════════════════════════════════════════════════
EOF
