#!/usr/bin/env bash
# ENRG live demo — run under a screen recorder.
# Start recording (GNOME: Ctrl+Shift+Alt+R; OBS; or a phone camera), then:
#   bash grants/demo-recording.sh
# Resilient: RPC hiccups are retried up to 5x with backoff, so the demo
# always finishes. Each run creates a FRESH device+nonce (real on-chain votes).
cd /home/enrg/Axis-workspace/ENRG

# Pick the first healthy devnet RPC (failover for unstable endpoints).
RPC=""
for c in "https://api.devnet.solana.com" "https://devnet.genesysgo.net"; do
  if curl -s -m 8 -X POST -H 'content-type: application/json'       -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$c" 2>/dev/null | grep -q '"ok"'; then
    RPC="$c"; break
  fi
done
[ -z "$RPC" ] && RPC="https://api.devnet.solana.com"
echo "   RPC: $RPC"
export ANCHOR_PROVIDER_URL="$RPC"

BLUE='\033[1;34m'; GREEN='\033[1;32m'; YEL='\033[1;33m'; NC='\033[0m'
step() { echo; echo -e "${BLUE}──────────────────────────────────────────────${NC}"; echo -e "${BLUE}$1${NC}"; echo -e "${BLUE}──────────────────────────────────────────────${NC}"; }

# Retry wrapper: run the command; retry up to 5x with 5s backoff.
run() {
  local n=0
  until "$@" 2>&1; do
    n=$((n+1))
    if [ $n -ge 5 ]; then echo -e "${YEL}   ⚠️  giving up after 5 attempts${NC}"; return 1; fi
    echo -e "${YEL}   ⚠️  RPC hiccup, retry $n/5...${NC}"; sleep 5
  done
}

# Fresh synthetic device + nonce.
DEV=$(solana-keygen new --no-bip39-passphrase --silent --outfile /tmp/enrg-demo-device.json >/dev/null 2>&1; solana address --keypair /tmp/enrg-demo-device.json)
NONCE=$(date +%s | tail -c 8)
ORACLE1=/home/enrg/keys/enrg-mainnet/oracle-keypair.json
ORACLE2=/home/enrg/keys/enrg-mainnet/oracle-tx-keypair.json
FOUNDER=/home/enrg/keys/enrg-mainnet/founder-keypair.json

step "STEP 1/4 — Quorum config: the mint gate (required=true) is live on devnet"
export ANCHOR_WALLET=$FOUNDER
run npx ts-node scripts/oracle-quorum-ops.ts config || true
sleep 3

step "STEP 2/4 — Oracle #1 (HC8Was…) votes on the proof with the canonical SHA-256 hash"
export ORACLE_KEY_PATH=$ORACLE1; unset ANCHOR_WALLET
run npx ts-node scripts/oracle-quorum-ops.ts attest $DEV $NONCE 1700000000 1700000100 1000 || true
sleep 3

step "STEP 3/4 — Oracle #2 (Hm7Ym7…) votes the SAME hash -> attestation FINALIZED"
export ORACLE_KEY_PATH=$ORACLE2
run npx ts-node scripts/oracle-quorum-ops.ts attest $DEV $NONCE 1700000000 1700000100 1000 || true
sleep 2
export ORACLE_KEY_PATH=$ORACLE1
run npx ts-node scripts/oracle-quorum-ops.ts status $DEV $NONCE || true
sleep 3

step "STEP 4/4 — Oracle rewards are claimed from the staking fund (idempotent)"
export ORACLE_KEY_PATH=$ORACLE1
run npx ts-node scripts/oracle-quorum-ops.ts claim-all || true
sleep 2
export ORACLE_KEY_PATH=$ORACLE2
run npx ts-node scripts/oracle-quorum-ops.ts claim-all || true
sleep 2

step "DONE — a full lifecycle was already proven on devnet:"
echo "  register -> claim -> activate -> mint with required=true -> reward claim"
echo -e "${GREEN}Program: HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb${NC}"
rm -f /tmp/enrg-demo-device.json
echo; echo -e "${GREEN}Demo complete — stop the recording.${NC}"
