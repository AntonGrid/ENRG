# Axis Protocol & ENRG: Architecture Overview

## 1. Vision

**Axis Protocol** is a higher‑level trust layer between the physical and digital worlds.

Its goal is to provide a general way for physical devices and agents to produce **cryptographic attestations** about the real world, and for digital systems (blockchains, dApps, off‑chain services) to **verify and consume** these attestations in a consistent way.

**ENRG** is the **first application built on Axis**. It focuses on the energy domain: tokenizing electricity production (SRC token) using attestations about generation capacity and behaviour. ENRG is just one vertical; the core design of Axis is intentionally domain‑agnostic.

---

## 2. Axis Protocol: Core Concepts

Axis defines a set of roles, data structures, and flows that are independent of any specific use case (energy, logistics, identity, etc.).

### 2.1 Roles

- **Device / Agent**
  - A physical device or system (e.g. energy generator, sensor, gateway) that produces measurements or statements about the physical world.
  - Possesses one or more cryptographic keys (directly or via a secure module / gateway).

- **Oracle**
  - A service that receives raw attestations or measurements from devices/agents.
  - Validates signatures, checks basic consistency, and aggregates or normalizes data.
  - Produces **oracle‑level attestations** that can be used on‑chain or by other systems.

- **Registry**
  - Maintains metadata and trust anchors for devices and oracles:
    - device identifiers and ownership;
    - public keys / certificates;
    - revocation / status information;
    - configuration (e.g. max rated power, geolocation, allowed policies).
  - Can be on‑chain, off‑chain, or hybrid, depending on deployment.

- **Policy Engine**
  - Evaluates attestations and context against domain‑specific and global policies:
    - “Is this device type allowed to produce this kind of statement?”
    - “Does the claimed capacity fit the certified limits?”
    - “Is the attestation fresh and non‑replayed?”
  - Produces a decision object (e.g. `allowed: bool`, limits, reasons).

- **On‑chain Bridge / Storage**
  - Bridges validated attestations to blockchain environments.
  - Converts high‑level attestation structures into on‑chain parameters and stores them in smart contracts or feeds them to other dApps.

### 2.2 Attestations (High‑level Data Model)

A generic Axis attestation has the following logical structure (simplified):

- **Request from Device to Oracle** (off‑chain):

  ```json
  {
    "device_id": "device-123",
    "nonce": "random-or-sequence",
    "timestamp": "2024-07-01T12:00:00Z",
    "payload": { /* domain-specific data */ },
    "signature": "..."  // over device_id + nonce + timestamp + payload
  }
payload is domain‑specific (energy, logistics, identity, etc.).

Everything else is Axis‑level (ids, timestamps, nonces, signatures).

Oracle Attestation / Decision (off‑chain):

{
  "attestation_id": "attestation-abc",
  "device_id": "device-123",
  "decision": {
    "allowed": true,
    "limits": {
      "max_value": 123.45
    },
    "policy": "axis://policy/energy/capacity/v1"
  },
  "issued_at": "2024-07-01T12:00:10Z"
}
decision is produced by Oracle + Policy Engine, based on:
device request,
registry state,
policies.
Axis defines:

how these structures look (schemas),
how they are signed and validated,
how they are mapped to on‑chain formats.
It does not hard‑code what exactly payload or limits mean — that belongs to specific applications (like ENRG).

3. On‑chain Layer (Axis Core)
For blockchains, Axis provides a reference on‑chain component that:

accepts attestations from trusted oracles;
stores them in a compact, verifiable way;
exposes them to other contracts and users.
3.1 Reference Contract
Current reference implementation (in Solidity):

EnrgOracleAttestation.sol (historical name, functionally an Axis Oracle Attestation contract).
Key properties:

Maintains a mapping from attestationId to a struct containing:
attestationId (bytes32);
deviceId (bytes32);
allowed (bool);
maxPowerW (uint64) — in the ENRG example (energy domain);
oracle (address) — who submitted the attestation;
issuedAt (uint64) — unix timestamp.
Restricts submitAttestation to addresses marked as trusted oracles.
Emits events on new attestations (for off‑chain consumers and other contracts).
Guards against duplicate attestation IDs.
Although the current struct includes maxPowerW, conceptually this is a field derived from the decision/payload and can be generalized to other domains or extended for future applications.

3.2 On‑chain Bridge (Off‑chain Helper)
An off‑chain bridge transforms validated attestation JSON into on‑chain calldata. The reference implementation:

takes an attestation object (JSON/dict),

computes:

attestation_id → keccak256(text(attestation_id)) : bytes32;
device_id → keccak256(text(device_id)) : bytes32;
decision‑specific numeric fields (e.g. max_power_kw) → on‑chain units (max_power_w = kw * 1000);
issued_at (ISO8601 string) → unix timestamp (uint64),
and returns a struct that can be passed to submitAttestation.

This bridge is part of Axis Core and is reused by different applications, including ENRG.

4. ENRG on Axis: First Application (Energy / SRC)
ENRG is the first concrete vertical built on Axis Protocol. It uses Axis primitives to solve a specific problem: trusted tokenization of electricity production.

4.1 Domain‑specific Payload
In the ENRG case, the device payload and oracle decision are specialized for energy:

payload might include:

rated power capacity (kW),
generation profile,
metering data,
location / grid connection metadata.
decision for ENRG often includes:

whether the device is allowed to participate (allowed: true/false);
limits such as max_power_kw;
references to energy‑specific policies.
These domain‑specific fields are interpreted by ENRG logic (off‑chain and on‑chain), but the attestation container, signing rules, and bridge logic come from Axis.

4.2 SRC Token & Settlement (Future / Planned)
On top of Axis + ENRG attestations, the project plans (or may already implement):

SRC token (e.g. ERC‑20/1155):

represents units of verified electricity production;
minted or distributed according to attested capacity/production.
Settlement / Market Contracts:

consume attestations from the Axis Oracle contract;
compute how much SRC can be minted or settled for a given device and time;
enforce domain‑specific rules (caps, time windows, double‑spend prevention, etc.).
Crucially, SRC and ENRG logic are applications: they depend on Axis contracts and attestations, but Axis itself does not know about SRC, energy, or economic details.

5. Current Code Mapping (Status Quo)
At the moment (hackathon snapshot), the repository contains components that can be logically grouped as Axis Core with an ENRG‑specific example:

Axis Core (off‑chain):

Oracle API (oracle_attest_request format, validation logic).
On‑chain bridge (build_attestation_params‑like function).
Axis Core (on‑chain):

EnrgOracleAttestation.sol — reference oracle attestation contract:
trusted oracles;
attestation storage;
accessors and events.
ENRG Example:

use of max_power_kw / max_power_w fields in decisions;
energy‑oriented naming in some places (SRC, ENRG).
Over time, naming and directory structure can be refactored to reflect this separation explicitly (e.g. axis/core vs products/enrg), but conceptually the split is already in place.

6. Summary
Axis Protocol is the general, domain‑agnostic protocol for device attestations, validation, and on‑chain integration.
ENRG / SRC is the first application on top of Axis, focused on energy and tokenization of electricity production.
The current implementation already contains:
a reference oracle contract (Axis Core on‑chain),
an off‑chain oracle and bridge (Axis Core off‑chain),
an energy‑specific example (ENRG) as a concrete use case.
This layered design allows future applications (logistics, IoT insurance, decentralized identity, etc.) to reuse Axis Core while defining their own domain‑specific payloads, policies, and economic models.

