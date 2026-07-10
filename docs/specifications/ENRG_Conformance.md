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
