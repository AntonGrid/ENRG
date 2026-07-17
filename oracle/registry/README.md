# ENRG Manifest Registry

This service publishes signed manifests and produces Merkle snapshots for downstream oracles and on-chain verifiers.

## Features
- Publish signed manifests via POST /api/v1/manifests
- Retrieve a manifest by id via GET /api/v1/manifests/:id
- Create a Merkle snapshot via POST /api/v1/merkle/snapshot
- Read the latest Merkle root via GET /api/v1/merkle/current
- Health check at GET /health

## Local run

### With Node.js
```bash
cd oracle/registry
npm install
REGISTRY_ADMIN_KEY=secure-key node server.js
```

### With Docker Compose
```bash
docker compose up --build
```

The registry will be available at http://localhost:4000 and the oracle at http://localhost:3000.

## Example requests

Publish a manifest:
```bash
curl -X POST http://localhost:4000/api/v1/manifests \
  -H 'Content-Type: application/json' \
  -d '{"manifest_id":"demo-1","payload":{"manifest_version":"1.0","device_type":"sensor"},"signature":"dGVzdC1zaWduYXR1cmU=","public_key":"dGVzdC1wdWJsaWMta2V5"}'
```

Create a Merkle snapshot:
```bash
curl -X POST http://localhost:4000/api/v1/merkle/snapshot \
  -H 'x-api-key: secure-key'
```
