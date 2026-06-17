# ENRG Protocol — Decentralized Energy Tokenization on Solana

ENRG Protocol tokenizes real-world energy production. Each verified 1 MWh = 1 SRC token. IoT devices (ESP32 + PZEM-004T) sign data with Ed25519 and send to an oracle, which accumulates energy and automatically mints SRC tokens on Solana.

## Repository Structure
- `/oracle` — Node.js oracle server
- `/firmware/esp32_proof_sender` — ESP32 sketch for energy reading and signing

## Live Demo
- First automatic mint transaction (devnet):  
  https://solana.fm/tx/3GsWfQvFhvAHBRHy5QV76gNov3knSsndKYrGg2CbUnppgbJW8ipFcvpeaxhM7NKQRZW3tHyFR5TyvN2c4t7yZ2V9?cluster=devnet-solana

## Getting Started
See READMEs inside each subfolder.

## Configuration
- Oracle threshold is set to 1,000,000 Wh = 1 MWh
- Founder keypair must be placed at `~/founder-keypair.json`
- Device public keys registered in `oracle/devices.json`

## License
MIT
 
