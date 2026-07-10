# 17. Cryptography

## 17.1 Overview

Cryptography forms the foundation of trust within the ENRG Protocol.

Every authenticated protocol operation SHALL rely on cryptographic verification rather than trust in infrastructure, manufacturers, or centralized authorities.

---

## 17.2 Objectives

The cryptographic model SHALL provide:

- Device authentication
- Data integrity
- Non-repudiation
- Replay protection
- Secure identity verification

---

## 17.3 Private Key Protection

Every device SHALL possess a unique private key.

The private key SHALL be generated on or securely provisioned to the device.

The private key SHALL never leave the device.

This requirement is defined by ADR-0001.

---

## 17.4 Public Key

Every device SHALL expose a public key.

The public key SHALL be registered through the Device Registry.

The public key SHALL be used for signature verification only.

---

## 17.5 Digital Signatures

Every authenticated protocol message SHALL be digitally signed.

Digital signatures SHALL protect:

- Proof-of-Production
- Device registration
- Provisioning responses
- Manifest verification
- Protocol requests

Unsigned authenticated messages SHALL be rejected.

---

## 17.6 Signature Verification

Signature verification SHALL occur before policy evaluation.

Verification SHALL confirm:

- Signature validity
- Registered public key
- Device status
- Message integrity

Invalid signatures SHALL terminate protocol processing.

---

## 17.7 Replay Protection

Replay protection SHALL use:

- Nonces
- Timestamps
- Registry state

Previously accepted authenticated messages SHALL NOT be accepted again.

---

## 17.8 Cryptographic Algorithms

This specification defines cryptographic requirements but does not mandate a specific implementation.

Reference implementations currently use:

- Ed25519 for digital signatures
- SHA-256 for hashing

Future versions MAY support additional algorithms while preserving interoperability.

---

## 17.9 Random Number Generation

Cryptographic operations SHALL use cryptographically secure random number generators.

Predictable randomness SHALL NOT be used.

---

## 17.10 Security Requirements

Every compliant implementation SHALL:

- Protect private keys.
- Verify every digital signature.
- Reject invalid signatures.
- Prevent replay attacks.
- Preserve cryptographic integrity.

---

## 17.11 Algorithm Agility

Future protocol versions MAY replace cryptographic algorithms if necessary.

Algorithm upgrades SHALL preserve compatibility whenever possible.

---

## 17.12 Requirements Summary

Every compliant implementation SHALL satisfy the following requirements.

- Private keys MUST never leave the device.
- Every authenticated message MUST be digitally signed.
- Every signature MUST be verified.
- Replay attacks MUST be prevented.
- Cryptographic verification MUST precede policy evaluation.
