#!/usr/bin/env bash
curl -X POST https://provisioning.enrg.local/devices \
  -H "Content-Type: application/json" \
  -d @device-proof-provisioning.json
