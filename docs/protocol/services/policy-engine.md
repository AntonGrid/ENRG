# 12. Policy Engine

## 12.1 Overview

The Policy Engine is the authoritative decision-making component of the ENRG Protocol.

Its responsibility is to evaluate protocol rules after successful cryptographic verification and determine whether a requested protocol operation is permitted.

The Policy Engine SHALL be the only protocol component authorized to make protocol policy decisions.

---

## 12.2 Responsibilities

The Policy Engine SHALL be responsible for:

- Evaluating protocol policies
- Determining device eligibility
- Evaluating Proof-of-Production
- Managing lifecycle transitions
- Detecting policy violations
- Producing deterministic decisions

The Policy Engine SHALL NOT perform cryptographic verification.

The Policy Engine SHALL NOT maintain the authoritative protocol state.

---

## 12.3 Verification and Decision Separation

The ENRG Protocol separates verification from decision making.

Responsibilities are divided as follows.

| Component | Responsibility |
|-----------|----------------|
| Device | Produce Proof |
| Oracle | Verify Proof |
| Policy Engine | Evaluate Policy |
| Device Registry | Store State |
| Smart Contract | Execute State Transition |

This separation SHALL be preserved by every compliant implementation.

---

## 12.4 Policy Evaluation

Policy evaluation SHALL occur only after successful cryptographic verification.

Policy evaluation MAY consider:

- Device Lifecycle
- Manifest Version
- Firmware Version
- Registry State
- Device Capabilities
- Governance Parameters

Implementations MAY extend policy evaluation provided protocol compatibility is preserved.

---

## 12.5 Policy Decisions

The Policy Engine MAY produce the following decisions.

- ACCEPT
- REJECT
- QUARANTINE
- MAINTENANCE
- REVOKE

Additional decisions MAY be introduced through future protocol versions.

---

## 12.6 Deterministic Behavior

Policy evaluation SHALL be deterministic.

Identical protocol inputs SHALL always produce identical policy decisions.

Random or non-deterministic behavior SHALL NOT influence protocol decisions.

---

## 12.7 Policy Version

Every Policy Engine SHALL operate according to a defined Policy Version.

Policy Versions SHOULD be maintained independently from:

- Protocol Version
- Manifest Version
- Firmware Version

Policy updates SHALL preserve protocol compatibility whenever technically possible.

---

## 12.8 Audit Requirements

Every policy decision SHOULD be auditable.

Audit information SHOULD include:

- Decision
- Timestamp
- Device Identifier
- Policy Version
- Reason

Audit records SHALL support future investigation and protocol transparency.

---

## 12.9 Security Requirements

The Policy Engine SHALL:

- Evaluate only verified data.
- Reject invalid protocol requests.
- Produce deterministic decisions.
- Preserve auditability.
- Prevent unauthorized policy modification.

---

## 12.10 Implementation Independence

This specification defines policy behavior.

It does not prescribe:

- Rule engine
- Programming language
- Database
- Deployment model

Any implementation MAY be used provided protocol behavior remains compliant.

---

## 12.11 Requirements Summary

Every compliant implementation SHALL satisfy the following requirements.

- The Policy Engine MUST be the only component authorized to make protocol policy decisions.
- Policy evaluation MUST occur after successful cryptographic verification.
- Policy decisions MUST be deterministic.
- Every policy decision SHOULD be auditable.
- Policy behavior MUST remain implementation-independent.
