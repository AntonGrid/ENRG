# 7. Device Identity

## 7.1 Overview

Every physical device participating in the ENRG Protocol SHALL possess a unique cryptographic identity.

Device identity is the foundation of authentication, trust establishment, Proof generation, and secure protocol participation.

Without a valid Device Identity, a device SHALL NOT participate in the ENRG Protocol.

---

## 7.2 Objectives

Device Identity provides:

- Unique identification
- Cryptographic authentication
- Digital signatures
- Secure provisioning
- Lifecycle continuity
- Replay protection

Identity SHALL remain stable throughout the operational lifetime of the device.

---

## 7.3 Identity Components

Every Device Identity SHALL consist of:

- Device Identifier (Device ID)
- Ed25519 Key Pair
- Public Key
- Registration Timestamp
- Lifecycle State

Additional metadata MAY be associated through the Device Registry.

---

## 7.4 Device Identifier

Every device SHALL possess a globally unique Device Identifier.

The protocol does not mandate a specific identifier generation algorithm.

Possible implementations include:

- UUID
- Hardware-derived identifiers
- Manufacturer-generated identifiers
- Cryptographically secure random identifiers

Device IDs SHALL remain immutable after successful registration.

---

## 7.5 Cryptographic Identity

Each device SHALL generate its own Ed25519 key pair.

Private keys SHALL be generated on the device.

Private keys SHALL never leave the device.

Only the corresponding public key MAY be distributed through the protocol.

This requirement is mandatory.

---

## 7.6 Ownership

Device ownership SHALL remain independent from Device Identity.

Ownership MAY change.

Identity SHALL NOT change.

Ownership information SHALL be maintained by the Device Registry.

---

## 7.7 Registration

Before participating in the protocol, every device SHALL be registered.

Registration SHALL include:

- Device ID
- Public Key
- Registration Timestamp
- Initial Lifecycle State

Duplicate Device IDs SHALL be rejected.

Duplicate public keys SHALL be rejected.

---

## 7.8 Authentication

Every authenticated protocol message SHALL include:

- Device Identifier
- Digital Signature
- Timestamp
- Nonce

Receivers SHALL verify all authentication elements before accepting protocol messages.

---

## 7.9 Identity Persistence

Device Identity SHALL survive:

- Power loss
- Device reboot
- Firmware update
- Network interruption

Identity SHALL remain unchanged unless explicitly regenerated through a factory reset procedure.

---

## 7.10 Secure Storage

Production devices SHOULD use hardware-backed secure key storage whenever available.

Examples include:

- Secure Element
- TPM
- Hardware Security Module

Development devices MAY use software storage.

---

## 7.11 Factory Reset

Factory reset MAY erase local configuration.

Factory reset SHALL NOT preserve protocol participation automatically.

If Device Identity is regenerated, the device SHALL repeat the complete registration process.

---

## 7.12 Identity Independence

Device Identity SHALL remain independent from:

- Oracle implementation
- Blockchain implementation
- Cloud infrastructure
- Database technology
- Device manufacturer

Identity belongs exclusively to the device.

---

## 7.13 Future Extensions

Future protocol versions MAY introduce:

- Hardware attestation
- Decentralized Identity (DID)
- Post-Quantum Cryptography
- Certificate Chains

Such extensions SHOULD preserve backward compatibility whenever technically possible.

---

## 7.14 Requirements Summary

Every compliant implementation SHALL satisfy the following requirements.

- Every device MUST possess a unique Device Identity.
- Every device MUST generate its own cryptographic key pair.
- Private keys MUST never leave the device.
- Every authenticated message MUST be digitally signed.
- Identity MUST remain stable throughout the device lifecycle.
- Ownership MAY change independently from Device Identity.
