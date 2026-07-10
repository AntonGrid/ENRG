# ENRG Technical Specification

**Version:** 8.0 (Draft)

**Status:** Working Draft

**Protocol:** ENRG

**License:** MIT

---

# Abstract

ENRG is an open protocol that defines how physical devices can cryptographically prove real-world events and how digital systems can independently verify those proofs without trusting manufacturers, centralized servers, or individual organizations.

This specification defines the protocol architecture, component responsibilities, security model, device lifecycle, cryptographic model, Proof-of-Production, tokenization rules, and interoperability requirements.

The protocol is blockchain-agnostic.

The current reference implementation uses Solana.

---

# Design Principles

The protocol is based on the following immutable principles.

## Open Standard

ENRG is an open specification.

Anyone may implement compatible software or hardware.

---

## Blockchain Agnostic

The protocol is independent of any blockchain.

Reference implementation:

- Solana

Future implementations may support additional networks.

---

## Trust Minimization

No component should require unnecessary trust.

Trust must be established through cryptographic verification.

---

## Architecture Before Implementation

Architecture defines the protocol.

Implementations may differ.

The protocol must remain compatible.

---

## Single Responsibility

Every component has exactly one responsibility.

No component should perform unrelated tasks.

---

## Security First

Convenience must never compromise security.

Every architectural decision must preserve trust.

---

# Protocol Overview

The ENRG ecosystem consists of the following logical components.

- Device
- Provisioning Service
- Device Registry
- Device Manifest
- Oracle
- Policy Engine
- Smart Contract
- Dashboard
- SDK
- Applications

The following chapters describe each component in detail.
---

# Table of Contents

1. Introduction
2. Protocol Philosophy
3. Architecture Overview
4. Design Principles
5. Component Model
6. Device Identity
7. Device Lifecycle
8. Provisioning Service
9. Device Registry
10. Device Manifest
11. Policy Engine
12. Oracle
13. Proof-of-Production
14. Smart Contract
15. Token Economics
16. Cryptography
17. API Specification
18. Dashboard
19. SDK
20. Security Model
21. Reference Implementation
22. Governance
23. Mainnet Requirements
24. Future Extensions
25. Glossary
# 1. Introduction

## 1.1 Purpose

This document defines the official ENRG Protocol Specification.

Its purpose is to provide a complete and implementation-independent description of the ENRG protocol.

The specification defines protocol behavior, component responsibilities, security principles, interoperability requirements, and architectural constraints.

This document is the normative reference for all future ENRG implementations.

---

## 1.2 Scope

This specification covers:

- Protocol architecture
- Device identity
- Proof-of-Production
- Oracle behavior
- Device Registry
- Policy Engine
- Smart Contract interaction
- Cryptographic model
- Security model
- Token economics
- API
- Governance
- Mainnet requirements

User interfaces and implementation-specific details are outside the scope of this specification.

---

## 1.3 Goals

The protocol has four primary goals.

### 1. Cryptographic Trust

Every event must be independently verifiable.

---

### 2. Open Interoperability

Any compatible implementation should be able to participate in the ENRG ecosystem.

---

### 3. Decentralization

No single organization should become a mandatory trust anchor.

---

### 4. Long-Term Stability

The protocol should remain compatible across multiple software generations.

---

## 1.4 Non-Goals

ENRG does not attempt to define:

- hardware manufacturing;
- blockchain consensus;
- electrical standards;
- market regulations;
- national energy policies.

These responsibilities remain outside the protocol.

---

## 1.5 Terminology

Throughout this specification the following terms are used.

**MUST**

Indicates an absolute protocol requirement.

**SHOULD**

Indicates a recommended behavior.

**MAY**

Indicates an optional behavior.

These keywords follow RFC 2119 conventions whenever applicable.

---

## 1.6 Reference Implementation

The current reference implementation consists of:

- Solana Smart Contract
- Oracle Server
- ESP32 Firmware
- Dashboard
- Technical Documentation

Future implementations may differ while remaining protocol compatible.

---

## 1.7 Protocol Evolution

The ENRG Protocol is designed to evolve.

Future versions may introduce additional components, capabilities, and optimizations.

Backward compatibility SHOULD be preserved whenever technically possible.

Breaking changes MUST be documented through RFCs and reflected in future protocol versions.
# 2. Protocol Philosophy

## 2.1 Philosophy

ENRG is an open protocol that defines how trust is established between physical devices and digital systems.

The protocol is not tied to a specific implementation, blockchain, programming language, company, or hardware manufacturer.

Its primary purpose is to establish common rules that enable independent implementations to interoperate.

---

## 2.2 Open Standard

ENRG SHALL remain an open specification.

Any individual or organization MAY implement compatible software or hardware without requesting permission from the protocol authors.

Protocol compatibility SHALL be determined by compliance with this specification rather than by implementation origin.

---

## 2.3 Reference Implementation

The official ENRG repository contains the reference implementation.

The reference implementation demonstrates one correct implementation of the protocol.

It does not define the protocol itself.

The specification always takes precedence over implementation details.

---

## 2.4 Separation Between Protocol and Implementation

The protocol defines:

- required behavior;
- security guarantees;
- message formats;
- component responsibilities;
- interoperability rules.

Implementations define:

- programming language;
- operating system;
- blockchain integration;
- database technology;
- deployment architecture.

Different implementations MAY use different technologies while remaining protocol compatible.

---

## 2.5 Trust Model

The protocol minimizes trust assumptions.

Trust SHALL originate from cryptographic verification rather than centralized control.

No participant is automatically trusted because of ownership, infrastructure, or authority.

Every operation MUST be independently verifiable whenever possible.

---

## 2.6 Device Identity

Every physical device participating in ENRG possesses its own cryptographic identity.

The private key MUST remain under the exclusive control of the device.

Only the corresponding public key MAY be distributed through the protocol.

Identity SHALL be independent of manufacturers, network operators, Oracle implementations, and blockchain infrastructure.

---

## 2.7 Architecture Principles

All protocol components SHALL follow the following principles.

### Single Responsibility

Every component SHOULD perform one clearly defined responsibility.

Responsibilities SHOULD NOT overlap.

---

### Separation of Concerns

Identity, policy, verification, storage, governance, and execution SHALL remain logically separated.

---

### Replaceability

Every component SHOULD be replaceable without requiring changes to unrelated protocol components.

---

### Extensibility

Future protocol versions SHOULD introduce new capabilities without breaking existing implementations whenever technically possible.

---

## 2.8 Interoperability

Independent implementations SHALL be able to exchange protocol messages without prior coordination.

Protocol compatibility SHALL depend exclusively on compliance with this specification.

---

## 2.9 Security Philosophy

Security SHALL always take precedence over convenience.

Architectural decisions SHALL favor verifiable correctness over implementation simplicity.

Whenever a trade-off exists between usability and protocol integrity, protocol integrity SHALL prevail.

---

## 2.10 Neutrality

ENRG does not prescribe:

- a particular blockchain;
- a specific Oracle implementation;
- a specific hardware vendor;
- a cloud provider;
- a database engine;
- a commercial business model.

The protocol defines interfaces rather than products.

---

## 2.11 Evolution

The protocol is expected to evolve.

Evolution SHALL occur through documented architectural decisions and protocol proposals.

Breaking changes MUST be carefully evaluated and SHOULD be avoided whenever possible.

Long-term protocol stability is considered one of the primary design objectives.

---

## 2.12 Fundamental Principles

The following principles define the foundation of ENRG.

1. Trust is established through cryptography.
2. Architecture is more important than implementation.
3. Open standards are more valuable than closed products.
4. Specifications outlive software.
5. Components must remain independent.
6. Private keys never leave devices.
7. Every proof must be independently verifiable.
8. Protocol evolution must preserve interoperability whenever possible.

These principles SHALL remain valid regardless of future protocol versions or implementation technologies.
# 3. Architecture Overview

## 3.1 Overview

The ENRG Protocol is composed of independent components that collectively establish trust between physical devices and digital systems.

Each component has a clearly defined responsibility.

No component is permitted to perform responsibilities assigned to another component.

This separation enables scalability, maintainability, interoperability, and independent evolution.

---

## 3.2 High-Level Architecture

```
                    +----------------------+
                    |     Dashboard        |
                    +----------+-----------+
                               |
                               |
                    REST / WebSocket API
                               |
                               ▼
                    +----------------------+
                    |    Policy Engine     |
                    +----------+-----------+
                               |
                 +-------------+-------------+
                 |                           |
                 ▼                           ▼
        +----------------+         +----------------+
        | Device Registry|         |    Oracle      |
        +--------+-------+         +--------+-------+
                 |                          |
                 |                          |
                 |                Proof Verification
                 |                          |
                 ▼                          ▼
        +----------------+         +----------------+
        | Provisioning   |         | Smart Contract |
        |    Service     |         +--------+-------+
        +--------+-------+                  |
                 |                          |
                 ▼                          ▼
        +----------------+          Solana Network
        | Device Manifest|
        +--------+-------+
                 |
                 ▼
        +----------------+
        |     Device     |
        +----------------+
```

---

## 3.3 Component Model

The ENRG Protocol consists of the following logical components.

| Component | Responsibility |
|------------|----------------|
| Device | Produces Proof-of-Production |
| Provisioning Service | Registers new devices |
| Device Registry | Stores device identity and state |
| Device Manifest | Delivers signed configuration |
| Oracle | Verifies Proofs |
| Policy Engine | Applies protocol policies |
| Smart Contract | Executes protocol state changes |
| Dashboard | User interaction |
| SDK | Developer integration |

---

## 3.4 Component Independence

Each component SHALL operate independently.

Failure of one component SHOULD NOT require redesign of the remaining architecture.

Communication SHALL occur only through defined protocol interfaces.

---

## 3.5 Device

The Device represents a physical source of measurable events.

Responsibilities include:

- measuring data;
- generating Proof-of-Production;
- signing messages;
- protecting private keys;
- communicating with the protocol.

The Device SHALL NOT perform policy decisions.

The Device SHALL NOT mint tokens.

---

## 3.6 Provisioning Service

Provisioning Service is responsible for onboarding devices.

Responsibilities include:

- registration;
- identity verification;
- claim code generation;
- manifest distribution.

Provisioning SHALL NOT verify Proofs.

Provisioning SHALL NOT manage protocol economics.

---

## 3.7 Device Registry

Device Registry is the authoritative source of device metadata.

Responsibilities include:

- identity;
- ownership;
- lifecycle state;
- capabilities;
- firmware version;
- trust level;
- audit history.

No other component SHALL become the primary source of this information.

---

## 3.8 Device Manifest

The Device Manifest defines operational parameters.

Typical information includes:

- heartbeat interval;
- proof interval;
- Oracle endpoint;
- protocol version;
- capabilities;
- policy version.

The Manifest SHALL be cryptographically signed.

---

## 3.9 Oracle

The Oracle performs cryptographic verification.

Responsibilities include:

- signature verification;
- nonce validation;
- timestamp validation;
- Proof validation;
- Smart Contract invocation.

The Oracle SHALL NOT define protocol policy.

---

## 3.10 Policy Engine

Policy Engine determines whether verified Proofs satisfy protocol rules.

Responsibilities include:

- quarantine decisions;
- trust evaluation;
- anomaly detection;
- OTA requirements;
- Proof acceptance.

Policy Engine SHALL remain independent from Oracle implementation.

---

## 3.11 Smart Contract

The Smart Contract represents the protocol state on-chain.

Responsibilities include:

- token minting;
- staking;
- treasury management;
- vesting;
- governance.

Business logic outside blockchain consensus SHOULD remain off-chain.

---

## 3.12 Dashboard

Dashboard provides the user interface.

Dashboard SHALL NOT become a protocol component.

It is a client of the protocol.

---

## 3.13 SDK

SDK implementations provide developer access to the protocol.

SDKs MAY exist for multiple programming languages.

SDKs SHALL implement protocol behavior defined by this specification.

---

## 3.14 Communication Principles

Components communicate through well-defined interfaces.

Internal implementation details SHALL remain encapsulated.

Components SHOULD avoid direct database dependencies whenever possible.

---

## 3.15 Architectural Stability

Individual implementations may evolve.

The architectural model defined by this chapter SHALL remain stable across protocol versions unless modified through the formal protocol evolution process.
# 4. Device Identity

## 4.1 Overview

Every device participating in the ENRG Protocol SHALL possess a unique cryptographic identity.

Device identity forms the foundation of trust throughout the protocol.

Without a valid identity, a device SHALL NOT participate in Proof-of-Production.

---

## 4.2 Objectives

Device Identity provides:

- authentication;
- proof ownership;
- message signing;
- replay protection;
- lifecycle tracking;
- secure provisioning.

Identity SHALL remain stable throughout the operational lifetime of the device.

---

## 4.3 Identity Components

Each device identity consists of:

- Device Identifier (Device ID)
- Ed25519 Key Pair
- Public Key
- Lifecycle State
- Capabilities
- Firmware Information

Additional metadata MAY be introduced by future protocol versions.

---

## 4.4 Device Identifier

Every device SHALL possess a globally unique Device ID.

The Device ID SHALL remain immutable after registration.

The protocol does not mandate a specific generation algorithm.

Possible implementations include:

- UUID
- Secure Random Identifier
- Manufacturer Identifier
- Hardware-derived Identifier

---

## 4.5 Cryptographic Identity

Each device SHALL generate an Ed25519 key pair.

Private keys SHALL be generated on the device.

Private keys SHALL never leave the device.

Only public keys MAY be transmitted through the network.

This requirement is mandatory.

---

## 4.6 Ownership

Device ownership is independent from device identity.

Ownership MAY change.

Identity SHALL NOT.

Ownership records SHALL be maintained by the Device Registry.

---

## 4.7 Public Key Registration

During provisioning the following information SHALL be registered:

- Device ID
- Public Key
- Device Type
- Firmware Version
- Registration Timestamp

The Registry SHALL reject duplicate public keys.

The Registry SHALL reject duplicate Device IDs.

---

## 4.8 Identity Verification

Every protocol message requiring authentication SHALL include a cryptographic signature.

The receiver SHALL verify:

- public key;
- signature;
- timestamp;
- nonce.

Messages failing verification SHALL be rejected.

---

## 4.9 Identity Persistence

Identity SHALL survive:

- reboot;
- power loss;
- firmware update;
- network interruption.

Identity SHALL NOT be regenerated except during explicit factory reset procedures.

---

## 4.10 Factory Reset

A factory reset MAY erase local configuration.

It SHALL NOT automatically preserve protocol registration.

If identity is regenerated, the device SHALL repeat the registration process.

---

## 4.11 Secure Storage

Production devices SHOULD use hardware-backed key storage.

Examples include:

- ATECC608
- TPM
- Secure Element
- Hardware Security Module

Software storage MAY be used only for development and testing.

---

## 4.12 Identity Lifecycle

Identity progresses through the following states:

UNREGISTERED

↓

REGISTERED

↓

CLAIMED

↓

PROVISIONED

↓

ACTIVE

↓

QUARANTINE

↓

MAINTENANCE

↓

REVOKED

The meaning of each state is defined in Chapter 5.

---

## 4.13 Identity Integrity

Identity SHALL NOT depend upon:

- Oracle implementation;
- blockchain implementation;
- database technology;
- cloud provider;
- manufacturer infrastructure.

Identity belongs exclusively to the device.

---

## 4.14 Future Extensions

Future protocol versions MAY support:

- hardware attestation;
- post-quantum cryptography;
- decentralized identity (DID);
- certificate chains;
- multiple authentication methods.

Such extensions SHALL remain backward compatible whenever technically possible.

---

## 4.15 Requirements Summary

A compliant implementation SHALL satisfy the following requirements.

- Every device MUST have a unique identity.
- Every device MUST possess its own Ed25519 key pair.
- Private keys MUST never leave the device.
- Public keys MUST be registered before protocol participation.
- Every authenticated message MUST be signed.
- Identity MUST remain stable throughout the device lifecycle.
- Ownership MAY change independently from identity.
