# ENRG Manifest Registry — Reference server

Quick start (development / testing)
1. cd oracle/registry
2. npm install
3. export REGISTRY_ADMIN_KEY="secure-key"
4. node server.js

Testing with publisher:
1. cd oracle/registry/tools
2. npm install tweetnacl tweetnacl-util uuid node-fetch
3. node publisher.js http://localhost:4000

Create snapshot:
curl -X POST http://localhost:4000/api/v1/merkle/snapshot -H "x-api-key: secure-key"

Get current root:
curl http://localhost:4000/api/v1/merkle/current
