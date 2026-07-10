# 21. Client Applications

## 21.1 Overview

Client Applications provide human interaction with the ENRG Protocol.

Client Applications are not part of the protocol itself.

They are protocol consumers that implement the behavior defined by this specification.

---

## 21.2 Purpose

Client Applications enable users to:

- Register devices
- Claim devices
- Provision devices
- Monitor device status
- View Proof-of-Production history
- Manage protocol assets
- Participate in protocol governance

Client Applications SHALL NOT modify protocol behavior.

---

## 21.3 Protocol Independence

The ENRG Protocol SHALL remain independent from any specific client implementation.

Compatible clients MAY include:

- Web Applications
- Mobile Applications
- Desktop Applications
- Command Line Interfaces
- Embedded Interfaces

Future client implementations SHALL remain interoperable.

---

## 21.4 User Experience

Client Applications SHOULD abstract protocol complexity from end users.

Users SHOULD NOT be required to manually interact with:

- Public Keys
- Nonces
- Oracle Endpoints
- Manifest Files
- Raw Protocol Messages

Implementations SHOULD provide intuitive workflows while preserving protocol integrity.

---

## 21.5 Wallet Integration

Client Applications MAY integrate blockchain wallets.

Wallet integration SHALL be implementation-specific.

The protocol SHALL NOT require a specific wallet provider.

---

## 21.6 Device Management

Client Applications SHOULD provide interfaces for:

- Device Registration
- Device Claiming
- Provisioning
- Device Monitoring
- Device Revocation

Protocol state SHALL remain authoritative within the Device Registry.

---

## 21.7 Data Presentation

Client Applications MAY visualize:

- Energy Production
- Proof History
- Device Status
- SRC Balance
- Governance Activity

Visualization SHALL NOT modify protocol state.

---

## 21.8 Security Considerations

Client Applications SHALL:

- Verify authenticated sessions.
- Protect user credentials.
- Never expose private device keys.
- Preserve protocol integrity.

Client Applications SHALL NOT bypass protocol validation.

---

## 21.9 Accessibility

Client Applications SHOULD provide consistent user experiences across supported platforms.

Accessibility improvements MAY be implementation-specific.

---

## 21.10 Implementation Independence

This specification defines client behavior.

It does not prescribe:

- User Interface Design
- Programming Language
- Framework
- Operating System
- Deployment Model

Any implementation MAY be compliant provided it follows this specification.

---

## 21.11 References

- ADR-0001 — Private Key Never Leaves Device
- ADR-0002 — Device Registry Source of Truth
- ADR-0005 — Device Lifecycle

---

## 21.12 Requirements Summary

Every compliant implementation SHALL satisfy the following requirements.

- Client Applications MUST remain protocol-independent.
- Client Applications MUST NOT modify protocol behavior.
- Client Applications MUST preserve protocol integrity.
- Client Applications SHOULD hide protocol complexity from users.
- Client Applications MAY implement any compatible user interface.
