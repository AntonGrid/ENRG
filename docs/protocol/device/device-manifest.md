# 11. Device Manifest

## 11.1 Overview

The Device Manifest is a cryptographically signed configuration artifact that defines how a device participates in the ENRG Protocol.

The Device Manifest is not an executable protocol component.

Every compliant implementation SHALL interpret the Device Manifest according to this specification.

---

## 11.2 Purpose

The Device Manifest provides protocol configuration required for device operation.

Typical configuration includes:

- Protocol Version
- Manifest Version
- Device Identifier
- Policy Version
- Communication Parameters
- Operational Parameters

Implementations MAY extend the Manifest while preserving interoperability.

---

## 11.3 Ownership

The Device Manifest belongs to the device.

The Provisioning Service SHALL generate and deliver the Manifest.

The Device SHALL verify and apply the Manifest.

The Device Registry MAY maintain the current Manifest Version.

---

## 11.4 Manifest Lifecycle

Every Device Manifest SHALL follow the lifecycle below.

```
Create
    │
    ▼
Sign
    │
    ▼
Deliver
    │
    ▼
Verify
    │
    ▼
Apply
    │
    ▼
Activate
```

A Manifest SHALL NOT become active before successful verification.

---

## 11.5 Mandatory Fields

Every Device Manifest SHALL contain at least:

- Protocol Version
- Manifest Version
- Device Identifier
- Policy Version
- Digital Signature

Additional fields MAY be introduced by future protocol versions.

---

## 11.6 Manifest Versioning

Every Device Manifest SHALL possess its own version.

Manifest versions SHALL increase whenever protocol configuration changes.

Devices SHOULD reject older Manifest versions unless explicitly permitted by protocol policy.

---

## 11.7 Signature Verification

Every Device Manifest SHALL be digitally signed before delivery.

The receiving device SHALL verify:

- Signature
- Device Identifier
- Protocol Version
- Manifest Version

Invalid Manifests SHALL be rejected.

---

## 11.8 Updates

Manifest updates MAY occur during the operational lifetime of the device.

Every update SHALL follow the complete Manifest Lifecycle defined by this specification.

Partial updates SHALL NOT bypass signature verification.

---

## 11.9 Security Requirements

The Device Manifest SHALL:

- Protect configuration integrity.
- Prevent unauthorized modification.
- Support version validation.
- Support auditability.

Implementations SHALL reject modified or unsigned Manifests.

---

## 11.10 Implementation Independence

This specification defines Manifest behavior.

It does not prescribe:

- File format
- Serialization format
- Transport mechanism
- Storage implementation

Implementations MAY choose any compatible technology.

---

## 11.11 Requirements Summary

Every compliant implementation SHALL satisfy the following requirements.

- Every device MUST receive a signed Device Manifest.
- Every Manifest MUST be verified before application.
- Every Manifest MUST possess a version.
- Manifest updates MUST preserve integrity.
- Invalid Manifests MUST be rejected.
