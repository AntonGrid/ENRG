#!/usr/bin/env bash
curl -X POST https://registry.enrg.local/manifests \
  -H "Content-Type: application/json" \
  -d @device-manifest-example.json
