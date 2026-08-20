# ENRG — Energy Tokenization on Solana

ENRG is the **first application** built on the [Axis Protocol](https://github.com/AntonGrid/Axis-protocol) — an open standard for cryptographically verifiable trust between physical devices and digital systems.

ENRG focuses on the **energy domain**: it tokenizes real electricity production using cryptographic proofs from IoT devices, verifies them through oracles, and mints SRC tokens on Solana.

---

## What ENRG Does

ENRG connects physical energy producers (solar panels, wind turbines, meters) to the Solana blockchain.

- **Device** — measures energy, signs data with Ed25519, sends Proof to Oracle.
- **Oracle** — verifies signatures, accumulates data, calls smart contract.
- **Smart Contract** — mints SRC tokens based on verified energy production.
- **Owner** — receives tokens proportional to produced energy.

---

## Repository Structure

- `programs/` — Solana smart contracts (Anchor).
- `onchain/` — Foundry contracts (Ethereum-compatible).
- `contracts/` — Solidity contracts.
- `oracle/` — Oracle service (verification, aggregation, minting).
- `firmware/` — ESP32 firmware for energy measurement and signing.
- `app/` — Backend services (FastAPI).
- `src/` — Application-specific code.
- `tests/` — Integration and unit tests.
- `scripts/` — Helper scripts.
- `schemas/` — JSON Schemas for core artifacts.
- `sdk/` — Client SDK (if applicable).
- `api/` — API definitions.
- `examples/` — Example payloads and flows.
- `docs/` — Implementation-specific documentation.

---

## Quick Start

### Prerequisites

- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor](https://www.anchor-lang.com/docs/installation)
- [Node.js](https://nodejs.org/) (v18+)
- [Python 3.10+](https://www.python.org/)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for on-chain tests)

### Clone and Install

```bash
git clone https://github.com/AntonGrid/ENRG.git
cd ENRG

# Install Node.js dependencies
npm install

# Install Python dependencies
pip install -r requirements.txt

# Install Anchor dependencies
cd programs && anchor build && cd ..
```

### Run Oracle

```bash
node server.js
```

### Run Tests

```bash
# Python tests
pytest

# Anchor tests
anchor test

# Foundry tests
cd onchain && forge test
```

## Architecture

ENRG follows the Axis Protocol trust pipeline:

```text
Device → Proof → Oracle → Attestation → Smart Contract → SRC Token
```

## Components

| Component | Responsibility |
| :--- | :--- |
| Device | Measures energy, signs Proof with Ed25519. |
| Oracle | Verifies signatures, accumulates data, calls mint. |
| Smart Contract | Mints SRC tokens based on verified Proofs. |
| Owner | Receives tokens proportional to energy produced. |

## Relationship with Axis Repositories

- **Axis-protocol** — the normative specification of the trust standard.
- **Axis-core** — the universal reference implementation of the protocol.
- **ENRG** (this repository) — the first application on Axis, focused on energy tokenization on Solana.

## Contributing

Contributions are welcome! Please read:

- [CONTRIBUTING.md](./CONTRIBUTING.md) — guidelines for PRs and coding standards.
- [SECURITY.md](./SECURITY.md) — for reporting security issues.
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — community standards.

## License

Apache 2.0 © 2026 Anton Gulda
