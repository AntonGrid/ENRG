ENRG Protocol Master Technical Specification v7.0

A comprehensive description of the founder's vision, technical architecture, tokenomics, security model and roadmap.

Based on the current ENRG implementation and the planned architecture.

May 2026

---

### 1. Executive Summary

The ENRG Protocol is designed as a decentralized energy verification and settlement protocol. This document describes the architecture, operating logic, security mechanisms, the mathematical emission model and the development roadmap.

The protocol relies on the Proof-of-Production concept — a cryptographic proof of energy generation obtained from IoT devices. The key innovation is the asymptotic emission model, in which token-mining difficulty grows exponentially, guaranteeing perpetual scarcity. The protocol is built on four layers: physical (IoT), network (oracles and pools), protocol (Solana smart contracts) and market (P2P trading and certificates). The current implementation includes a working smart contract, a tested IoT device and a fully described token economy.

### 2. Mission and Vision

The ENRG mission is to create an open, programmable and decentralized energy market accessible to any producer regardless of scale. The protocol must become the standard for energy tokenization, just as Bitcoin became the standard for decentralized money. The vision is a world where any solar panel, wind turbine or micro-hydro plant can monetize its energy without intermediaries.

### 3. Energy Market Problem

The current energy market ($8 trillion) is controlled by a narrow circle of centralized companies. Small producers have no direct market access and are forced to sell energy at unfavorable prices. Green subsidies settle with intermediaries, not with the actual generators.

### 4. Protocol Overview

ENRG is a DePIN protocol deployed on Solana. It connects a physical device (an IoT meter) with an on-chain token through a cryptographic pipeline. The protocol records the generation fact, verifies it and issues tokens, distributing them according to the defined economic model. ENRG is not loyalty points but a real asset backed by mathematically provable energy.

### 5. Four Layer Architecture

The ENRG architecture consists of four layers:

1. Physical layer (Device Layer): IoT devices (ESP32+PZEM-004T, later Siemens/ABB) that measure energy and sign data with Ed25519.

2. Network layer (Oracle Layer): oracle servers that verify signatures, aggregate data and manage producer pools.

3. Protocol layer (ENRG Core): Solana smart contracts responsible for minting, staking, vesting and commission distribution.

4. Market layer (ENRG Market): a decentralized P2P market for trading energy, carbon credits and derivative instruments.

### 6. Device Layer

Physical devices are the source of trustworthy data. Various accuracy classes are supported: from hobbyist (ESP32+PZEM) to industrial (Siemens SENTRON). Each device gets a unique Ed25519 key pair; the private key lives in a Secure Element (ATECC608). Data is signed on the device and sent to the oracle.

### 7. Oracle Layer

Oracles act as the bridge between the physical and digital worlds. They receive signed data packets, verify the Ed25519 signature, validate timestamps and nonces, then aggregate readings into pools. When a pool accumulates a threshold value (e.g. 1 MWh), the oracle sends a transaction to the smart contract. In the MVP the oracle role is played by a Node.js server; later, by the decentralized Switchboard network.

### 8. ENRG Core Architecture

The system core is a set of Solana programs written in Rust with Anchor. The programs are split by function: registry (device registration), mint_energy (minting), vault (revenue management), buyback_burn, staking, founder_vesting. Programs interact via CPI (Cross-Program Invocation).

### 9. Current Smart Contract Components

The following instructions are implemented in the repository:

- initialize_vault — creates the protocol vault.

- initialize_funds — initializes the funds (buyback, staking, DAO, emergency).

- create_producer — registers an energy producer.

- mint_energy — mints tokens with an 85% user / 15% commission split.

- buyback_and_burn — burns tokens from the buyback fund.

- stake / unstake — staking and unstaking tokens.

- claim_rewards — claims staking rewards.

- initialize_founder_vesting / claim_vested — founder-token vesting.

All arithmetic uses checked_add, checked_mul, etc. Critical checks include mint_authority validation, PDA conformance, nonce-based replay protection and power limits.

### 10. Producer Account Model

The EnergyProducer account stores:

- authority — the device owner.

- device_id — the unique identifier.

- nonce — a counter for replay protection.

- energy_wh — the cumulative energy.

- timestamp — the last confirmation time.

- max_power_w — the rated device power.

- signature — the last signature.

- is_initialized — the initialization flag.

The account is created once and updated on every successful mint.

### 11. Vault Architecture

The Vault PDA is the protocol's central management account. It stores the mint reference and the authority (deployer). The Vault is the mint authority for the ENRG token, guaranteeing that tokens are issued only through the protocol. The deployer is pinned on the first initialize_vault call.

### 12. Mint Energy Flow

1. The oracle calls mint_energy, passing a Proof.

2. The contract checks authority, nonce, timestamp (no older than 15 minutes), mint_authority.

3. max_energy_wh is computed with the formula max_power_w * 10 / 60.

4. total_mint = energy_wh * ENRG_BASIS (conversion into base units).

5. The commission shares are calculated: 20% buyback, 40% staking, 30% DAO, 10% emergency.

6. Via the CPI mint_to, tokens are distributed to the corresponding accounts.

### 13. Proof of Production

PoP — the cryptographic pipeline:

1. The device measures energy every 10 minutes.

2. Builds a packet {device_id, timestamp, energy_wh, nonce}.

3. Signs it with the Ed25519 private key.

4. Sends it to the oracle.

5. The oracle verifies the signature, aggregates the data into a pool and calls mint_energy.

### 14. Pool Architecture

A pool model is provided for small producers. The oracle aggregates data from many devices and, when the total energy reaches 1 MWh, triggers a mint. Tokens are distributed proportionally to each participant's contribution. This lowers the entry threshold and ensures regular payouts.

### 15. Device Trust Levels

| Tier | Hardware | Mining limit |
|---------|--------------|----------------|
| Basic   | ESP32 + PZEM | up to 100 kWh/mo |
| Verified| Certified home meter | up to 10 MWh/mo |
| Industrial | Siemens, ABB | unlimited |
| Institutional | Audited energy company | unlimited |

The tier affects the limits, verification requirements and reputation weight.

### 16. Energy Reputation Score (ERS)

Each producer accumulates a reputation score that depends on:

- the duration of flawless operation;

- the amount of verified energy;

- the absence of anomalies in the generation profile.

A high ERS brings advantages in pool reward distribution and access to premium ENRG Market features.

### 17. Token Design

ENRG is an SPL token on Solana with 9 decimal places. Maximum supply: 1,000,000,000 ENRG. The token has built-in utility: staking (a share of commissions), access to energy data, DAO voting, and settlements in ENRG Market.

### 18. Tokenomics

The 15% protocol commission is distributed:

- 20% → Buyback & Burn

- 40% → Staking Pool

- 30% → DAO Treasury

- 10% → Emergency Fund

85% of the reward goes to the energy producer.

### 19. Protocol Treasury

The protocol treasury consists of four PDA accounts: buyback, staking, dao, emergency. Each fund is funded on every mint. Funds are managed via DAO voting.

### 20. Buyback and Burn

20% of each mint's commission is automatically burned. This creates constant deflationary pressure. The mechanism is implemented via the buyback_and_burn instruction, which performs a burn CPI to the SPL Token Program.

### 21. Staking Design

Users can stake ENRG and receive a share of the protocol commissions. Rewards are distributed proportionally to the staking-pool share. The current implementation uses a simple mechanism; acc_reward_per_share is planned for the future.

### 22. DAO Governance

Protocol governance will be handed to token holders via a DAO. The votable parameters: the exponential-halving coefficient (k), the commission size, device limits and treasury distribution.

### 23. Emission Mathematics

The base formula: E(S) = 1 MWh × k^S, where S is the share of already-mined tokens and k is the difficulty coefficient. With k=10:

| Share (S) | MWh per 1 ENRG |
|----------|-----------------|
| 0%       | 1               |
| 25%      | 1.78            |
| 50%      | 10              |
| 75%      | 178             |
| 90%      | 1 000           |
| 99%      | 10 000          |

The model is asymptotic: the last token is practically unreachable.

### 24. Economic Scenarios (k=3/5/10)

With k=3 the emission is smoother; with k=10 it accelerates sharply toward the end. The k parameter will be chosen from modeling and approved via the DAO.

### 25. Threat Model (STRIDE)

The STRIDE model is applied:

- Spoofing: protected by Ed25519 signatures, ATECC608.

- Tampering: integrity control via the packet signature.

- Repudiation: nonce and timestamp guarantee non-repudiation.

- Information Disclosure: minimized on-chain data.

- Denial of Service: gas limits, limit checks.

- Elevation of Privilege: the PDA architecture, deployer pinning.

### 26. Security Architecture

Layered protection:

- Device layer: a Secure Element, signed OTA.

- Network layer: TLS, decentralized oracles.

- Contract layer: checked arithmetic, PDAs, authority checks.

- Reputation layer: ERS lowers the weight of anomalous accounts.

### 27. Anti-Fraud Framework

A combination of hardware (ATECC608), network (generation profiles) and reputation (ERS) methods. Profile anomalies (constant power at night) lower the rating and trigger extra checks.

### 28. Industrial Integration

A dedicated adapter will be developed to integrate industrial meters (Siemens, ABB), converting Modbus/Profibus protocols into the ENRG format. Industrial devices will get "Industrial" status without limits.

### 29. Energy Data Economy

Verified energy-production data becomes a commodity. ENRG Market provides paid access to aggregated anonymized data for analysts, traders and researchers.

### 30. ENRG Market

A decentralized P2P venue for trading energy, carbon credits and derivatives. The marketplace smart contracts provide automatic order matching and ENRG settlements.

### 31. Carbon Credits Vision

Every verified ENRG received for green energy can be converted into a tokenized carbon credit. This creates an additional market and incentivizes green generation.

### 32. API Specification

The oracle REST API:

- POST /api/v1/proof/submit — accept a signed packet.

- GET /api/v1/device/{id}/status — device status.

- GET /api/v1/pool/{id}/stats — pool statistics.

### 33. OpenAPI Draft

The repository ships openapi.yaml describing all endpoints.

### 34. Sequence Diagram Narrative

1. IoT device → signature → oracle.

2. Oracle → validation → pool aggregation.

3. Threshold reached → mint_energy call.

4. Solana → verification → mint → event.

### 35. PDA Architecture Concept

All key accounts are PDAs with predefined seeds:

- vault: ["vault"]

- buyback: ["buyback", mint]

- staking: ["staking", mint]

- dao: ["dao", mint]

- emergency: ["emergency", mint]

- producer: ["producer", authority]

### 36. Scaling Strategy

Horizontal scaling via multiple oracles and pool sharding. A switch to Switchboard to decentralize verification. Contract optimization to reduce compute units.

### 37. KPI Framework

- The number of registered devices.

- The total verified energy (MWh).

- The volume of burned tokens (ENRG).

- TVL in staking.

- The number of active pools.

- The network average ERS.

### 38. Grant Strategy

Target grants: Solana Foundation, Superteam Earn, Gitcoin Grants. Directions: oracle development, Ed25519 integration, contract audit, feature expansion.

### 39. Roadmap 2026-2030

- Q2-Q3 2026: testnet, an IoT prototype, the first devnet mint.

- Q4 2026 – Q1 2027: mainnet, the first devices, DEX listing.

- Q2-Q3 2027: Vault activation, Buyback & Burn, industrial producers.

- 2028: ENRG Market, P2P trading.

- 2029: cross-chain integration, carbon credits.

- 2030: a full DAO, institutional level.

### 40. Long-Term Vision

ENRG becomes the global settlement layer for the energy market, providing transparency, scarcity and fair rewards for every energy producer. A protocol that cannot be stopped and requires no trust in central authorities.
