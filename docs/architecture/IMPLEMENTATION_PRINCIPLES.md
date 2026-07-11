# ENRG Implementation Principles

Status: Active

---

# Purpose

This document defines the relationship between the ENRG Protocol and its implementations.

The protocol is the source of truth.

Every implementation MUST conform to the protocol specification.

---

# Principle 1

The protocol defines the rules.

The implementation follows the protocol.

The implementation MUST NEVER redefine protocol behavior.

---

# Principle 2

Documentation precedes implementation.

Every protocol change SHALL first be reflected in the specification.

Only after specification approval may implementation begin.

---

# Principle 3

Every implementation is replaceable.

Examples include:

- Smart Contract
- Oracle
- SDK
- Mobile Application
- Dashboard
- CLI
- Device Firmware

All implementations MUST remain compatible with the protocol.

---

# Principle 4

Protocol compatibility has higher priority than implementation convenience.

If implementation behavior conflicts with the specification, the implementation MUST be updated.

---

# Principle 5

The protocol evolves through specifications, ADRs, registries and RFCs.

Implementations evolve through code.

These processes are independent.

---

# Principle 6

Implementations SHOULD remain modular.

Business rules belong to the protocol.

Code implements those rules.

---

# Principle 7

Protocol documentation SHALL remain implementation-independent whenever possible.

The specification describes behavior.

It does not prescribe internal source code organization.

---

# Conclusion

ENRG is a protocol.

The smart contract is one implementation.

The Oracle is another implementation.

Future implementations MUST follow the same protocol.
