# 20. Error Model

## 20.1 Overview

The ENRG Protocol defines a standardized error model to ensure consistent behavior across all compliant implementations.

Every protocol component SHALL use the standardized protocol error codes defined by this specification.

Error messages intended for human users MAY vary by implementation and language.

Protocol error codes SHALL remain stable.

---

## 20.2 Purpose

The Error Model provides:

- Deterministic error reporting
- Implementation interoperability
- Client compatibility
- Reliable debugging
- Consistent API behavior

Every compliant implementation SHALL use the standardized protocol error codes.

---

## 20.3 Error Structure

Every protocol error SHALL contain:

- Error Code
- Error Name
- Error Category
- Optional Human-Readable Message

Implementations MAY include additional diagnostic information.

---

## 20.4 Error Categories

The protocol defines the following error categories.

### Identity Errors

- ERR_DEVICE_NOT_FOUND
- ERR_DEVICE_ALREADY_EXISTS
- ERR_DEVICE_REVOKED
- ERR_DEVICE_NOT_ACTIVE

---

### Authentication Errors

- ERR_INVALID_SIGNATURE
- ERR_INVALID_NONCE
- ERR_INVALID_TIMESTAMP
- ERR_UNAUTHORIZED

---

### Manifest Errors

- ERR_MANIFEST_INVALID
- ERR_MANIFEST_VERSION
- ERR_MANIFEST_SIGNATURE

---

### Proof Errors

- ERR_PROOF_INVALID
- ERR_PROOF_REJECTED
- ERR_DUPLICATE_PROOF

---

### Policy Errors

- ERR_POLICY_DENIED
- ERR_POLICY_UNAVAILABLE

---

### Registry Errors

- ERR_REGISTRY_NOT_FOUND
- ERR_REGISTRY_CONFLICT

---

### Smart Contract Errors

- ERR_TRANSACTION_INVALID
- ERR_STATE_CONFLICT
- ERR_MINT_DENIED

---

### Protocol Errors

- ERR_PROTOCOL_VERSION
- ERR_PROTOCOL_UNSUPPORTED
- ERR_INTERNAL

---

## 20.5 Error Stability

Once introduced, protocol error codes SHALL NOT change.

Future protocol versions MAY introduce additional error codes.

Existing error codes SHALL preserve their meaning.

---

## 20.6 Error Propagation

Protocol components SHALL preserve protocol error codes whenever possible.

Implementations SHALL NOT replace standardized protocol errors with implementation-specific identifiers.

---

## 20.7 Human-Readable Messages

Human-readable error messages:

- MAY be localized.
- MAY differ between implementations.
- SHALL NOT change the meaning of the protocol error code.

Applications SHOULD rely on protocol error codes rather than message text.

---

## 20.8 Security Considerations

Error responses SHALL NOT expose:

- Private keys
- Internal secrets
- Sensitive implementation details
- Internal infrastructure information

---

## 20.9 References

- ADR-0001 — Private Key Never Leaves Device
- ADR-0002 — Device Registry Source of Truth
- ADR-0003 — Oracle Never Makes Policy Decisions
- ADR-0004 — Device Manifest
- ADR-0005 — Device Lifecycle

---

## 20.10 Requirements Summary

Every compliant implementation SHALL satisfy the following requirements.

- Standardized error codes MUST be used.
- Error codes MUST remain stable.
- Human-readable messages MAY be localized.
- Protocol error codes MUST be implementation-independent.
- Sensitive information MUST NOT be exposed through errors.
