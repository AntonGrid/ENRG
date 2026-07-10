# 9. Provisioning

## 9.1 Overview

Provisioning is the process by which a device becomes eligible to participate in the ENRG Protocol.

The protocol defines the provisioning process but does not mandate a specific implementation.

Provisioning MAY be implemented using REST, Bluetooth, NFC, QR codes, local communication, or other compatible mechanisms.

---

## 9.2 Objectives

Provisioning SHALL:

- Register a device.
- Verify device ownership.
- Deliver the Device Manifest.
- Establish initial protocol configuration.
- Prepare the device for activation.

Provisioning SHALL NOT evaluate protocol policy.

Provisioning SHALL NOT verify Proof-of-Production.

Provisioning SHALL NOT perform blockchain operations.

---

## 9.3 Provisioning Workflow

A compliant provisioning process SHALL follow the sequence below.

```
Register Device
        │
        ▼
Verify Claim
        │
        ▼
Generate Manifest
        │
        ▼
Sign Manifest
        │
        ▼
Deliver Manifest
        │
        ▼
Verify Manifest
        │
        ▼
Provision Complete
```

---

## 9.4 Claim Process

Every device SHALL be claimed before provisioning.

Claim verification SHALL establish ownership without exposing the device private key.

Claim mechanisms MAY include:

- Claim Codes
- QR Codes
- NFC
- Physical pairing
- Manufacturer onboarding

---

## 9.5 Claim Code Requirements

Claim Codes SHOULD satisfy the following requirements.

- Cryptographically secure.
- Unique.
- Single-use.
- Time limited.
- Bound to one device.

Expired Claim Codes SHALL be rejected.

---

## 9.6 Device Manifest

Provisioning SHALL deliver a cryptographically signed Device Manifest.

The Provisioning Service SHALL NOT modify the Manifest after signing.

The device SHALL verify the Manifest before applying it.

---

## 9.7 Provisioning Completion

Provisioning SHALL be considered complete only after:

- Manifest delivery;
- Manifest verification;
- Successful Manifest application.

Receiving a Manifest alone SHALL NOT complete provisioning.

---

## 9.8 Security Requirements

Provisioning SHALL:

- Protect private keys.
- Verify ownership.
- Authenticate provisioning requests.
- Reject duplicate registrations.
- Reject invalid claims.

---

## 9.9 Implementation Independence

The protocol specifies provisioning behavior.

It does not prescribe:

- Server architecture.
- User interface.
- Transport protocol.
- Programming language.

Any implementation MAY be used provided it satisfies this specification.

---

## 9.10 Requirements Summary

Every compliant implementation SHALL satisfy the following requirements.

- Every device MUST complete provisioning before activation.
- Provisioning MUST verify ownership.
- Provisioning MUST deliver a signed Device Manifest.
- Provisioning MUST NOT evaluate protocol policy.
- Provisioning MUST NOT perform cryptographic Proof verification.
