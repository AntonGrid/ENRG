# ENRG Protocol Master Technical Specification v7.0

Comprehensive description of the founder's vision, technical architecture, tokenomics, security model, and roadmap.

Based on the current ENRG implementation and planned architecture.

May 2026

---

### 1. Executive Summary

ENRG Protocol is designed as a decentralized verification and settlement protocol for energy. This document describes the architecture, operational logic, security mechanisms, mathematical emission model, and development roadmap.

The protocol is built on the concept of Proof-of-Production — a cryptographic proof of energy generation obtained from IoT devices. The key innovation is the asymptotic emission model, where the difficulty of mining tokens grows exponentially, ensuring permanent scarcity. The protocol is structured on four layers: physical (IoT), network (oracles and pools), protocol (Solana smart contracts), and market (P2P trading and certificates). The current implementation includes a working smart contract, a tested IoT device, and a fully described token economy.

---

### 2. Mission and Vision

The mission of ENRG is to create an open, programmable, and decentralized energy market accessible to any producer regardless of scale. The protocol should become the standard for energy tokenization, similar to how Bitcoin became the standard for decentralized money. The vision is a world where any solar panel, wind turbine, or micro-hydro plant can monetize its energy without intermediaries.

---

### 3. Energy Market Problem

The current energy market ($8 trillion) is controlled by a limited number of centralized companies. Small producers have no direct market access and are forced to sell energy at unfavorable prices. Green subsidies end up with intermediaries rather than real generators.

---

### 4. Protocol Overview

ENRG is a DePIN protocol deployed on Solana. It connects a physical device (IoT meter) with an on-chain token through a cryptographic pipeline. The protocol records the fact of generation, verifies it, and issues tokens, distributing them according to a defined economic model. ENRG is not loyalty points — it is a real asset backed by mathematically provable energy.

---

### 5. Four Layer Architecture

The ENRG architecture consists of four layers:

1. **Physical Layer (Device Layer):** IoT devices (ESP32 + PZEM-004T, and in the future Siemens/ABB) measuring energy and signing data with Ed25519.

2. **Network Layer (Oracle Layer):** Oracle servers verifying signatures, aggregating data, and managing producer pools.

3. **Protocol Layer (ENRG Core):** Smart contracts on Solana responsible for minting, staking, vesting, and fee distribution.

4. **Market Layer (ENRG Market):** A decentralized P2P marketplace for trading energy, carbon credits, and derivatives.

---

### 6. Device Layer

Physical devices serve as the source of verifiable data. Various accuracy classes are supported: from hobbyist (ESP32 + PZEM) to industrial (Siemens SENTRON). Each device receives a unique Ed25519 key pair, with the private key stored in a Secure Element (ATECC608). Data is signed on the device and sent to the oracle.

---

### 7. Oracle Layer

Oracles act as a bridge between the physical and digital worlds. They receive signed data packets, verify Ed25519 signatures, validate timestamps and nonces, and aggregate readings into pools. When a pool accumulates a threshold value (e.g., 1 MWh), the oracle sends a transaction to the smart contract. In the MVP, the oracle is a Node.js server; in the future, it will be a decentralized Switchboard network.

---

### 8. ENRG Core Architecture

The core of the system is a set of Solana programs written in Rust using Anchor. Programs are divided by function: `registry` (device registration), `mint_energy` (minting), `vault` (revenue management), `buyback_burn`, `staking`, `founder_vesting`. Interaction between programs occurs via CPI (Cross-Program Invocation).

---

### 9. Current Smart Contract Components

The repository implements the following instructions:

- `initialize_vault` — creates the protocol vault.
- `initialize_funds` — initializes funds (buyback, staking, DAO, emergency).
- `create_producer` — registers an energy producer.
- `mint_energy` — mints tokens with 85% distribution to the user and 15% commission.
- `buyback_and_burn` — burns tokens from the buyback fund.
- `stake` / `unstake` — staking and withdrawal of staked tokens.
- `claim_rewards` — receives staking rewards.
- `initialize_founder_vesting` / `claim_vested` — founder token vesting.

All arithmetic operations use `checked_add`, `checked_mul`, etc. Critical checks include `mint_authority` validation, PDA compliance, replay attack protection via nonce, and power limits.

---

### 10. Producer Account Model

The `EnergyProducer` account stores:

- `authority` — device owner.
- `device_id` — unique identifier.
- `nonce` — counter to prevent replay attacks.
- `energy_wh` — total accumulated energy.
- `timestamp` — last confirmation time.
- `max_power_w` — nameplate power of the device.
- `signature` — last signature.
- `is_initialized` — initialization flag.

The account is created once and updated with each successful mint.

---

### 11. Vault Architecture

The Vault PDA is the central management account of the protocol. It stores a reference to the mint and authority (deployer). The Vault is the mint authority for the ENRG token, ensuring that tokens are only issued through the protocol. The deployer is fixed during the first `initialize_vault` call.

---

### 12. Mint Energy Flow

1. The oracle calls `mint_energy`, passing a `Proof`.
2. The contract verifies `authority`, `nonce`, timestamp (not older than 15 minutes), and `mint_authority`.
3. `max_energy_wh` is calculated using the formula `max_power_w * 10 / 60`.
4. `total_mint = energy_wh * ENRG_BASIS` (conversion to base units).
5. Commission shares are calculated: 20% buyback, 40% staking, 30% DAO, 10% emergency.
6. Through CPI `mint_to`, tokens are distributed to the corresponding accounts.

---

### 13. Proof of Production

PoP is a cryptographic pipeline:

1. The device measures energy every 10 minutes.
2. It forms a packet `{device_id, timestamp, energy_wh, nonce}`.
3. Signs it with the Ed25519 private key.
4. Sends it to the oracle.
5. The oracle verifies the signature, aggregates data into a pool, and calls `mint_energy`.

---

### 14. Pool Architecture

A pool model is provided for small producers. The oracle aggregates data from multiple devices, and when the total pool energy reaches 1 MWh, it initiates minting. Tokens are distributed proportionally to each participant's contribution. This lowers the entry barrier and ensures regular payouts.

---

### 15. Device Trust Levels

| Level | Equipment | Mining Limit |
|-------|-----------|--------------|
| Basic | ESP32 + PZEM | up to 100 kWh/month |
| Verified | Certified household meter | up to 10 MWh/month |
| Industrial | Siemens, ABB | unlimited |
| Institutional | Energy company with audit | unlimited |

The level affects limits, verification requirements, and reputation weight.

---

### 16. Energy Reputation Score (ERS)

Each producer accumulates a reputation score based on:
- duration of flawless operation;
- volume of verified energy;
- absence of anomalies in the generation profile.

A high ERS provides advantages in pool reward distribution and access to premium ENRG Market features.

---

### 17. Token Design

The ENRG token is an SPL token on Solana with 9 decimal places. Maximum supply: 1,000,000,000 ENRG. The token has built-in utility: staking (share of fees), access to energy data, DAO voting, settlements in ENRG Market.

---

### 18. Tokenomics

The protocol fee of 15% is distributed as follows:

- 20% → Buyback & Burn
- 40% → Staking Pool
- 30% → DAO Treasury
- 10% → Emergency Fund

85% of the reward goes to the energy producer.

---

### 19. Protocol Treasury

The protocol treasury consists of four PDA accounts: buyback, staking, dao, emergency. Each fund is replenished with every mint. Fund management is carried out through DAO voting.

---

### 20. Buyback and Burn

20% of the fee from each mint is automatically burned. This creates constant deflationary pressure. The mechanism is implemented through the `buyback_and_burn` instruction, which executes a `burn` CPI to the SPL Token Program.

---

### 21. Staking Design

Users can stake ENRG and receive a share of protocol fees. Rewards are distributed proportionally to the share in the staking pool. The current implementation uses a simple mechanism; future plans include `acc_reward_per_share`.

---

### 22. DAO Governance

Protocol governance will be transferred to token holders through a DAO. Parameters subject to voting: exponential halving coefficient (k), fee size, device limits, treasury distribution.

---

### 23. Emission Mathematics

Base formula: *E(S) = 1 MWh × k^S*, where S is the fraction of already mined tokens, and k is the difficulty coefficient. For k=10:

| Fraction (S) | MWh per 1 ENRG |
|--------------|----------------|
| 0%           | 1              |
| 25%          | 1.78           |
| 50%          | 10             |
| 75%          | 178            |
| 90%          | 1,000          |
| 99%          | 10,000         |

The model is asymptotic: the last token is practically unattainable.

---

### 24. Economic Scenarios (k=3/5/10)

At k=3, emission is smoother; at k=10, it accelerates sharply toward the end. The parameter k will be selected based on simulation and approved through the DAO.

---

### 25. Threat Model (STRIDE)

The STRIDE model is applied:

- **Spoofing:** protection via Ed25519 signatures, ATECC608.
- **Tampering:** integrity control through packet signing.
- **Repudiation:** nonce and timestamp ensure non-repudiation.
- **Information Disclosure:** minimization of on-chain data.
- **Denial of Service:** gas limits, limit checks.
- **Elevation of Privilege:** PDA architecture, deployer fixation.

---

### 26. Security Architecture

Multi-layer protection:

- Device level: Secure Element, signed OTA updates.
- Network level: TLS, decentralized oracles.
- Contract level: checked arithmetic, PDA, authority checks.
- Reputation level: ERS reduces the weight of anomalous accounts.

---

### 27. Anti-Fraud Framework

A combination of hardware (ATECC608), network (generation profiles), and reputation (ERS) methods. Anomalies in the profile (e.g., constant power at night) lead to a rating decrease and additional checks.

---

### 28. Industrial Integration

A special adapter will be developed for integration with industrial meters (Siemens, ABB) to convert Modbus/Profibus protocols into the ENRG format. Industrial devices will receive the "Industrial" status without limits.

---

### 29. Energy Data Economy

Verified energy production data becomes a commodity. ENRG Market provides paid access to aggregated anonymized data for analysts, traders, and researchers.

---

### 30. ENRG Market

A decentralized P2P marketplace for trading energy, carbon credits, and derivatives. Marketplace smart contracts ensure automatic order matching and settlements in ENRG.

---

### 31. Carbon Credits Vision

Each verified ENRG obtained from green energy can be converted into a tokenized carbon credit. This creates an additional market and stimulates green generation.

---

### 32. API Specification

Oracle REST API:

- `POST /api/v1/proof/submit` — receive a signed packet.
- `GET /api/v1/device/{id}/status` — device status.
- `GET /api/v1/pool/{id}/stats` — pool statistics.

---

### 33. OpenAPI Draft

An `openapi.yaml` file describing all endpoints is placed in the repository.

---

### 34. Sequence Diagram Narrative

1. IoT device → signature → oracle.
2. Oracle → validation → aggregation into pool.
3. Threshold reached → call `mint_energy`.
4. Solana → verification → mint → event.

---

### 35. PDA Architecture Concept

All key accounts are PDAs with predefined seeds:

- `vault`: `["vault"]`
- `buyback`: `["buyback", mint]`
- `staking`: `["staking", mint]`
- `dao`: `["dao", mint]`
- `emergency`: `["emergency", mint]`
- `producer`: `["producer", authority]`

---

### 36. Scaling Strategy

Horizontal scaling through multiple oracles and pool sharding. Transition to Switchboard for decentralized verification. Contract optimization to reduce compute units.

---

### 37. KPI Framework

- Number of registered devices.
- Total verified energy (MWh).
- Volume of burned tokens (ENRG).
- TVL in staking.
- Number of active pools.
- Average ERS of the network.

---

### 38. Grant Strategy

Target grants: Solana Foundation, Superteam Earn, Gitcoin Grants. Directions: oracle development, Ed25519 integration, contract audit, functionality expansion.

---

### 39. Roadmap 2026-2030

- **Q2-Q3 2026:** Testnet, IoT prototype, first mint on devnet.
- **Q4 2026 – Q1 2027:** Mainnet, first devices, DEX listing.
- **Q2-Q3 2027:** Vault activation, Buyback & Burn, industrial producers.
- **2028:** ENRG Market, P2P trading.
- **2029:** Cross-chain integration, carbon credits.
- **2030:** Full DAO, institutional level.

---

### 40. Long-Term Vision

ENRG becomes a global settlement layer for the energy market, ensuring transparency, scarcity, and fair compensation for every energy producer. A protocol that cannot be stopped and requires no trust in central authorities.
