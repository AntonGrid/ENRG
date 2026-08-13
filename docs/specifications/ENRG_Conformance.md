# ENRG Conformance

## Status

Normative

---

# 1. Overview

This document defines the requirements for protocol compliance.

Only implementations satisfying all mandatory requirements defined by the ENRG Protocol Specification may claim protocol conformance.

---

# 2. Conformance Levels

The ENRG Protocol defines the following implementation categories.

- Device
- Provisioning Service
- Device Registry
- Policy Engine
- Oracle Implementation
- Smart Contract
- Client Application
- SDK

Each implementation SHALL satisfy the requirements applicable to its category.

---

# 3. Mandatory Requirements

A compliant implementation SHALL:

- Implement all mandatory protocol requirements.
- Preserve protocol behavior.
- Preserve interoperability.
- Preserve deterministic execution.
- Preserve protocol compatibility.

---

# 4. Prohibited Behavior

A compliant implementation SHALL NOT:

- Modify protocol semantics.
- Skip mandatory verification.
- Bypass Policy Engine decisions.
- Expose device private keys.
- Generate incompatible protocol messages.

---

# 5. Optional Features

Implementations MAY support optional capabilities.

Optional capabilities SHALL NOT affect mandatory protocol behavior.

---

# 6. Protocol Compatibility

Implementations claiming compatibility SHALL declare:

- Supported Protocol Version
- Supported Specification Revision

Unsupported protocol versions SHALL be rejected.

## Declaration (reference implementation — `enrg_mvp`)

| Field                     | Value                                                            |
|---------------------------|------------------------------------------------------------------|
| Implementation            | `enrg_mvp` (Solana/Anchor, program `9rVoq…XF`)                   |
| Supported Protocol Version| **v7.0** (ENRG Technical Specification v7.0)                     |
| Specification Revision    | **v8.0** (ENRG Technical Specification v8.0, decimals=9/atomic)  |
| Decimals                  | 9 (`SRC_DECIMALS = 9`; 1 SRC = 1e9 atomics)                      |
| Max Supply                | 1e18 atomics = 1,000,000,000 SRC (`MAX_SUPPLY_ATOMIC`)           |
| Emission Formula          | `E(S) = 1 MWh × 10^S` (`INITIAL_ENERGY_PER_SRC`, `k = 10`)       |
| Commission                | 15%: buyback 20 / staking 40 / dao 30 / emergency 10             |
| Trust Levels              | Basic / Verified / Industrial / Institutional (v7.0 §15)         |
| ERS                       | Energy Reputation Score (v7.0 §16/§27)                           |
| Pool distribution         | 1 MWh threshold, proportional + ERS-weighted (v7.0 §14/§16)      |
| Governance                | MVP: roles + timelock + quorum (v7.0 §22, ADR-0009)              |

Conformance deviations from Axis Core (ADR-0002/0003/0006) are documented in
`adr/ADR-00X-enrg-core-vs-energy-profile.md` §7.


---

# 7. Compliance Statement

An implementation satisfying all applicable requirements MAY state:

"This implementation conforms to the ENRG Protocol Specification."

---

# 8. References

- ENRG Protocol Specification
- ENRG Terminology
- RFC 2119
- RFC 8174
