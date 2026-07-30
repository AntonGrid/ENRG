# ENRG Manifest Registry

## Status

Normative

---

# Overview

This registry defines the official Device Manifest versions recognized by the ENRG Protocol.

Every Device Manifest SHALL declare its Manifest Version.

Unknown Manifest Versions SHALL be rejected.

---

# Registered Manifest Versions

| Version | Status | Description |
|---------|--------|-------------|
| 1.0 | Current | Initial ENRG Device Manifest |

---

# Manifest Requirements

Every Device Manifest SHALL include:

- Manifest Version
- Device Type
- Device Manufacturer
- Device Model
- Firmware Version
- Public Key
- Capability List

Optional fields MAY be included provided they do not alter protocol semantics.

---

# Compatibility Rules

Manifest Versions SHALL remain backward compatible whenever technically possible.

Breaking changes SHALL require a new major Manifest Version.

---

# Registration Rules

New Manifest Versions SHALL be approved through Protocol Governance.

Existing Manifest Versions SHALL NOT be modified after publication.
