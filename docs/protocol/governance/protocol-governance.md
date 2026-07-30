# 23. Protocol Governance

## 23.1 Overview

Protocol Governance defines the mechanisms through which the ENRG Protocol evolves over time.

The purpose of Governance is to preserve interoperability, maintain protocol stability, and enable transparent, community-driven evolution.

Governance SHALL govern the protocol.

Governance SHALL NOT own the protocol.

---

## 23.2 Objectives

Protocol Governance SHALL provide:

- Transparent decision making
- Controlled protocol evolution
- Backward compatibility
- Public review of proposed changes
- Long-term protocol stability

---

## 23.3 Governance Scope

Protocol Governance MAY approve:

- Protocol Specification updates
- Architecture Decision Records (ADR)
- Requests for Comments (RFC)
- New Capability Identifiers
- New Event Types
- New Error Codes
- New Manifest Versions
- New Protocol Versions

Implementation-specific decisions SHALL remain outside Governance.

---

## 23.4 Governance Process

Every protocol modification SHOULD follow the lifecycle below.

```
Problem
    │
    ▼
Architecture Decision Record (ADR)
    │
    ▼
Request for Comments (RFC)
    │
    ▼
Community Review
    │
    ▼
Governance Approval
    │
    ▼
Protocol Specification
    │
    ▼
Reference Implementation
```

Protocol evolution SHALL remain transparent.

---

## 23.5 Architecture Decision Records

Architecture Decision Records (ADR) define accepted architectural principles.

ADR documents SHALL become normative references for future protocol development.

Previously accepted ADRs SHOULD NOT be modified.

If architectural changes are required, new ADRs SHOULD supersede previous decisions.

---

## 23.6 Requests for Comments

RFC documents define proposed protocol improvements.

RFCs SHALL NOT modify the protocol until approved through Governance.

Rejected RFCs SHALL remain part of the protocol history.

---

## 23.7 Version Management

Governance SHALL manage:

- Protocol Versions
- Specification Versions
- Capability Registry
- Event Registry
- Error Registry

Backward compatibility SHOULD be preserved whenever technically possible.

---

## 23.8 Reference Implementations

Reference implementations demonstrate protocol compliance.

Reference implementations SHALL NOT define the protocol.

The ENRG Protocol Specification SHALL remain the authoritative source.

---

## 23.9 Transparency

Governance decisions SHOULD remain publicly accessible.

Historical protocol decisions SHOULD remain permanently available.

Protocol evolution SHALL be auditable.

---

## 23.10 Security Considerations

Governance SHALL preserve:

- Protocol integrity
- Security
- Compatibility
- Decentralization

Governance SHALL NOT weaken accepted security guarantees without explicit protocol revision.

---

## 23.11 References

- ADR-0001 — Private Key Never Leaves Device
- ADR-0002 — Device Registry Source of Truth
- ADR-0003 — Oracle Never Makes Policy Decisions
- ADR-0004 — Device Manifest
- ADR-0005 — Device Lifecycle

---

## 23.12 Requirements Summary

Every compliant implementation SHALL recognize that:

- Governance governs the protocol.
- Governance does not own the protocol.
- ADRs define accepted architecture.
- RFCs define proposed protocol evolution.
- The Protocol Specification remains the normative reference.
