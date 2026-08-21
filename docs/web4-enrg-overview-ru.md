# ENRG as Web4: the architectural difference from Web3

## 1. From Web3 to Web4

Web3 answers the question:

> "How do we make ownership and operations over **digital objects** (tokens, NFTs, smart-contract state) decentralized and verifiable?"

The Web3 blockchain sees the world through:

- addresses (accounts),
- digital assets (balances, tokens),
- smart-contract state.

Everything that happens **off-chain** is for Web3 by default:

- either nonexistent,
- or exists as "transaction data" that cannot be trusted without external infrastructure (oracles, API gateways, etc.).

**An ENRG-type protocol** adds another layer:

> "How do we make **real-world events** part of the decentralized consensus with the same strict verifiability as balances and hashes?"

That is:

- Web3: decentralized **digital state**.  
- ENRG (in the Web4-layer sense): decentralized **trustworthy physical-world events** + digital state and economics around them.

---

## 2. ENRG architecture as a Web4 layer

ENRG introduces a set of primitives that Web3 does not have "out of the box":

### 2.1. Real-World Actors (devices and processes)

In Web3 everything revolves around:

- users (keys, wallets),
- smart contracts.

ENRG adds a separate class of first-class entities:

- devices (meters, inverters, ESP32, sensors, etc.),
- industrial controllers,
- and, in general, any physical actor with a cryptographic identity.

They become **full protocol participants**, not just sources of "data in comments".

### 2.2. From measurements to proofs (Measurements → Proofs)

ENRG describes a strict path:

1. The device records a measurement (`value`, `timestamp`, `nonce`).
2. Builds a message in a defined format.
3. Signs it with its key (e.g. Ed25519).
4. From the sequence of messages and checks we get a **proof of the event**, suitable for on-chain validation.

This is not arbitrary transaction data but a formalized layer with strict validation rules.

### 2.3. Oracles as a formal part of the protocol

In Web3 oracles are usually an external "bring outside data" service. The formal model is weak.

In ENRG:

- oracle roles are defined,
- the format of their reports (Oracle Reports),
- the cryptographic requirements,
- validation policies.

An oracle report is not just a payload — it is **part of the formal consensus loop about a real event**.

### 2.4. An economic engine bound to physical events

In most Web3 systems tokens:

- are issued on a fixed schedule (inflation, halvings),
- or are "printed" by internal dApp rules (staking, AMM, DAO).

ENRG adds:

- an emission model that **mathematically depends** on the flow of confirmed physical-world events,
- an economy that "listens" not only to transactions but also to **validated device measurements**.

---

## 3. ENRG-Core, profiles and tokens

To avoid confusing the core with a concrete domain, ENRG is split into three levels:

### 3.1. ENRG-Core (the Web4 layer)

> **ENRG-Core is the common proof-and-incentive layer for real-world events.**

It defines:

- the device identity model,
- the message and proof formats,
- oracle roles and on-chain report verification rules,
- common economic primitives (emission via `f(event, total_supply)`, funds, staking, DAO).

ENRG-Core **knows nothing** about what is measured: energy, logistics, climate — that is the profiles level.

### 3.2. Deployment Profiles

> **Deployment Profile — a concrete domain where ENRG-Core is applied to a specific type of event.**

A profile defines:

- what counts as an event,
- which devices and units of measurement are used,
- which extra checks are needed (bounds, monotonicity, geography, etc.),
- which **profile-native token** is issued.

Examples:

- ENRG-Energy v1 (energy),
- ENRG-Logistics v1 (logistics),
- ENRG-Climate v1 (climate data),
- etc.

### 3.3. SRC as the energy-profile token

Important:

> **SRC is the native token of the ENRG-Energy profile specifically, not a universal "all events in the world" token.**

In ENRG-Energy v1:

- the event object is **confirmed electricity production**;
- SRC is issued only for validated energy events (Proof of Production);
- the SRC economic model (emission, funds, staking, buyback) is tuned for energy.

For other profiles:

- the same ENRG-Core is used (device → proof → oracle → on-chain),
- but a **profile-native token** can be introduced:
  - e.g. `LOG` for logistics,
  - `CLM` for climate events, etc.,
- with its own economics and funds.

That is:

- **SRC = tokenization of confirmed electricity production;**
- **The ENRG Web4 layer = a proof-and-incentive architecture on top of which different profiles and their tokens can live.**

---

## 4. Why this is a new layer, not just a Web3 dApp

Summary of the architectural differences:

1. **A new class of entities**  
   - Web3: accounts, contracts.  
   - ENRG/Web4: devices and physical processes as first-class actors.

2. **A new consensus axis**  
   - Web3: transactions and state inside the blockchain.  
   - ENRG/Web4: consensus about **which real-world events happened and were validly recorded**.

3. **A formalized "reality → consensus" path**  
   Not ad-hoc oracles but a deterministic pipeline:
   ```text
   Physical Event
        ↓
   Device Measurement
        ↓
   Device Signature
        ↓
   Oracle Verification
        ↓
   On-chain Proof Validation
        ↓
   Domain-native Token Emission (SRC / LOG / ...)
   ```

4. **Economics over real events, not just over digital state**  
   Rewards and emission depend on confirmed physical processes.

This is why an ENRG-type architecture can honestly be called the **next layer over Web3**: not another token, but a **universal layer of trust and incentives for real-world events**, with the first profile — energy and the SRC token.
