#!/usr/bin/env bash
DEVICE_ID="5Jt8qLz3Nh2Dk7Wf9Rs1Cv4Bm6Xp8Za2Te5Yu7LoPqEr"
curl -X POST "https://registry.enrg.local/devices/${DEVICE_ID}/attestations" \
  -H "Content-Type: application/json" \
  -d @device-proof-attestation.json
