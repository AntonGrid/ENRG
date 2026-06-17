# ENRG Protocol — Oracle Server

This server receives signed energy proofs from IoT devices, verifies Ed25519 signatures, accumulates energy, and automatically calls `mint_energy` on the deployed Solana program when the threshold is reached.

## Quick Start
1. Install dependencies: `npm install`
2. Place your founder keypair at `~/founder-keypair.json` (64-byte array)
3. Register device public keys in `devices.json` (base64-encoded Ed25519 public key)
4. Start the server: `node server.js`

## API
- `POST /api/v1/proof/submit` — submit a signed energy proof
- Body: `{ device_id, timestamp, energyWh, nonce, signature }`

## Configuration
- `ENERGY_THRESHOLD` — Wh to accumulate before minting (default: 1,000,000 Wh = 1 MWh)
- `PROGRAM_ID` — deployed Solana program address
- `MINT_ADDRESS` — SRC token mint
