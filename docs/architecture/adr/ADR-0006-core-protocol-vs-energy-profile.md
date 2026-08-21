# ADR-0006: Core Protocol vs Domain Profile

## Status

Accepted

## Context

The protocol historically evolved as a monolithic system: one smart contract, one Oracle, one tokenization scheme. As the architecture grew, it became clear that the protocol solves two fundamentally different problems:

### 1. Core Protocol

Establishing trust between a physical device and a digital system. Data verification, cryptographic device identity, proof of events (Proof-of-*). This layer is not tied to any specific domain — it can work with any physical assets.

### 2. Domain Profile

Domain-specific logic: tokenization, reward calculation, economic model, fees, buyback and burn mechanisms. This is the *first* use case for the Core Protocol, but not the only one.

### Problem with the Current Architecture

The current codebase does not explicitly separate these two entities. Everything resides in a single contract, creating risks:

- **Tight coupling:** changing domain logic affects the Core Protocol and vice versa.
- **Audit complexity:** auditors review a single contract where functions from different layers are mixed.
- **Barrier to new scenarios:** the next profile (e.g., water, carbon, connectivity, logistics) would require forking the entire contract.

## Decision

Adopt an architectural split into two layers:

### Core Protocol

Responsible for:
- Cryptographic device identity
- Device lifecycle (states and transitions)
- Device Registry (public keys and metadata)
- Oracle Registry (trusted oracles)
- Policy Engine (rules for verifying proofs)
- Trusted data transfer from device through Oracle to the digital system

The Core Protocol **knows nothing** about tokens, emissions, or fees. It operates with concepts: device, oracle, proof, trust.

### Domain Profile

Responsible for:
- Interpreting data from the Core Protocol in domain terms
- Tokenization of domain assets
- Economic model (emission, distribution, fees)
- Buyback and burn mechanisms (if applicable)
- User interfaces and business logic

The Domain Profile **does not know** how trust is established at the Core Protocol level. It receives already verified data and works with it.

## Consequences

### Positive

1. **Clear separation of concerns:** Core Protocol handles trust; Domain Profile handles business logic.
2. **Simplified auditing:** Core Protocol can be audited separately from domain logic.
3. **New domains enabled:** any new profile can use the Core Protocol without changes.
4. **Independent evolution:** Core Protocol and Domain Profile can evolve independently.

### Negative

1. **Increased architectural complexity:** explicit separation is required at the code and documentation level.
2. **Additional integration effort:** each new domain must implement its own Profile.
3. **Risk of duplication:** domain profiles may reinvent the wheel if the Core Protocol is not flexible enough.

### Trade-offs

- Core Protocol must be abstract enough to support different domains
- Domain Profile must be flexible enough not to require Core Protocol changes
- Documentation must clearly separate these two layers

## Related ADRs

- ADR-0001: Keys Never Leave the Device
- ADR-0002: Device Registry as Source of Truth
- ADR-0003: Oracle and Policy Engine
- ADR-0004: Device Manifest
- ADR-0005: Device Lifecycle States

## Implementation Status

The separation is accepted at the architectural level. The Core Protocol implementation resides in the Axis-core repository. The Domain Profile is implemented as a separate application.
