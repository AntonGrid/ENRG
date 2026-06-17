# ENRG Protocol — Decentralized Energy Tokenization on Solana

ENRG Protocol tokenizes real-world energy production. Each verified 1 MWh = 1 SRC token. IoT devices (ESP32 + PZEM-004T, as well as industrial meters via Modbus/RS485) sign data with Ed25519 and send to an oracle, which accumulates energy and automatically mints SRC tokens on Solana.

## Repository Structure
- `/oracle` — Node.js oracle server (supports both ESP32 and industrial Modbus gateways)
- `/firmware/esp32_proof_sender` — ESP32 sketch for energy reading and signing
- `/firmware/industrial_gateway` — Modbus/RS485 gateway firmware (planned)
- `/docs` — Whitepaper, Technical Documentation, Pitch Deck

## Live Demo (Devnet)
- First fully autonomous Proof-of-Production transaction:  
  https://solana.fm/tx/3GsWfQvFhvAHBRHy5QV76gNov3knSsndKYrGg2CbUnppgbJW8ipFcvpeaxhM7NKQRZW3tHyFR5TyvN2c4t7yZ2V9?cluster=devnet-solana

## Supported Hardware
| Type | Examples | Protocol |
|------|----------|----------|
| Consumer | ESP32 + PZEM-004T | Wi-Fi |
| Industrial | Schneider, Siemens, ABB, Меркурий, Энергомера | Modbus RTU / RS485 |
| Future | Any meter with pulse output or digital interface | Custom |

## Getting Started
See READMEs inside each subfolder.

## Configuration
- Oracle threshold is set to 1,000,000 Wh = 1 MWh
- Founder keypair must be placed at `~/founder-keypair.json`
- Device public keys registered in `oracle/devices.json`
- For industrial meters: register Modbus slave ID and register mapping

## Security & Anti-Fraud
- Ed25519 signing per measurement
- Monotonic nonce (replay protection)
- Physical power limit per device
- Secure Element (ATECC608) for key storage (production)
- Multi-oracle verification (Switchboard)
- Anomaly detection (sudden spikes, historical deviation)

## License
MIT
