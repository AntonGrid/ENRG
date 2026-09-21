# 22. Software Development Kit (SDK)

## 22.1 Overview

The ENRG Software Development Kit (SDK) provides a standardized interface for developing applications compatible with the ENRG Protocol.

The SDK is a reference implementation of protocol interfaces.

The SDK SHALL simplify protocol integration without altering protocol behavior.

---

## 22.2 Purpose

The SDK enables developers to:

- Register devices
- Claim devices
- Submit Proof-of-Production
- Query protocol state
- Access Device Registry
- Interact with Smart Contracts
- Participate in governance

The SDK SHALL expose protocol functionality through stable interfaces.

---

## 22.3 Design Principles

Every ENRG SDK SHALL satisfy the following principles:

- Protocol compatibility
- Deterministic behavior
- Stable public interfaces
- Clear error reporting
- Backward compatibility whenever possible

---

## 22.4 Supported Operations

A compliant SDK SHOULD provide interfaces for:

- Identity Management
- Device Management
- Provisioning
- Proof Submission
- Registry Queries
- Policy Requests
- Smart Contract Operations
- Event Subscription

---

## 22.5 Version Compatibility

SDK implementations SHALL declare the supported ENRG Protocol version.

SDKs SHALL reject incompatible protocol versions.

---

## 22.6 Error Handling

SDK implementations SHALL expose standardized protocol error codes.

SDKs SHALL NOT replace protocol error codes with implementation-specific identifiers.

Human-readable messages MAY vary by implementation.

---

## 22.7 Event Support

SDK implementations SHOULD support subscription to standardized Protocol Events.

Supported events SHALL remain compatible with the ENRG Event Model.

---

## 22.8 Security Considerations

SDK implementations SHALL:

- Verify protocol responses.
- Preserve cryptographic integrity.
- Protect user credentials.
- Never expose device private keys.

SDK implementations SHALL NOT bypass protocol validation.

---

## 22.9 Language Independence

This specification does not prescribe any programming language.

Reference SDKs MAY be implemented in:

- Rust
- TypeScript
- JavaScript
- Go
- Python
- Swift
- Kotlin

Other implementations MAY exist provided protocol compatibility is preserved.

---

## 22.10 Future Extensions

Future SDK versions MAY introduce:

- Higher-level abstractions
- Helper libraries
- Code generation
- Client templates
- Testing utilities

Such extensions SHALL preserve protocol compatibility.

---

## 22.11 References

- Chapter 18 — Protocol Interfaces
- Chapter 19 — Protocol Events
- Chapter 20 — Error Model
- ADR-0002 — Device Registry Source of Truth

---

## 22.12 Requirements Summary

Every compliant implementation SHALL satisfy the following requirements.

- SDKs MUST preserve protocol behavior.
- SDKs MUST expose standardized protocol errors.
- SDKs MUST remain protocol-version aware.
- SDKs MUST support standardized protocol interfaces.
- SDKs MUST remain implementation-independent.

---

## 22.13 Reference implementation in this repository

`sdk/README.md` ships reference clients in **JavaScript** (`sdk/js/enrg-client.js`)
and **Python** (`sdk/python/enrg_client.py`). Today they cover the live oracle
interfaces — device registration payloads, proof submission, registry/state
queries, the device manifest and firmware metadata — plus the wire format
(`device_message_to_sign`, `oracle_message_to_sign`, `proof_hash`,
`oracle_attest_message`), which is the part an integrator must get byte-exact.

Not covered yet (gaps, stated rather than implied): governance operations, event
subscription and direct smart-contract calls — see §22.4. The wire format is not
hand-written: `sdk/vectors/wire_format.json` is generated from `policy.js`, which
the conformance vectors pin against the Rust engine, and both language suites
assert it byte for byte.
