# ADR-0003: Verifier Does Not Make Policy Decisions — Policy Engine Does

**Status:** Accepted
**Date:** 2025-06-28 (revised 2026-07-27)
**Authors:** Axis Protocol Team

---

## Context

In the current implementation, the Verifier performs multiple functions: verifies signatures, accumulates data, issues Digital Claims, and also makes decisions about whether to quarantine a device, allow a Proof, or require a secure firmware update. This mixes responsibilities and complicates system evolution.

## Decision

The Verifier is responsible **only for**:

- Receiving Proofs from devices.
- Verifying cryptographic signatures.
- Passing verified data to the Policy Engine.
- Executing actions (e.g., issuing Digital Claims) as instructed by the Policy Engine.

All decisions about device state, Proof admissibility, secure firmware update requirements, and quarantine are made by a separate component — the **Policy Engine**. The Verifier is an **executor**, not a source of policies.

## Rationale

- **Separation of concerns:** Verifier handles cryptography and data transfer; Policy Engine handles logic and policies.
- **Flexibility:** Policies can be changed without rewriting the Verifier.
- **Scalability:** The Policy Engine can be extracted into a separate service.
- **Testability:** Each component can be tested in isolation.

## Consequences

- The Verifier **does not store** device state (this is handled by the Registry).
- The Verifier **does not make decisions** about quarantine or secure firmware updates.
- The Verifier executes actions **only after confirmation** from the Policy Engine.
- The Policy Engine interacts with the Device Registry and Verifier via well-defined interfaces.

## Alternatives Considered

- **Verifier makes all decisions itself** — rejected due to mixing responsibilities.
- **Policy Engine embedded in the Verifier** — rejected as it violates the single responsibility principle.

---

## Related ADRs

- ADR-0002: Device Registry as the Single Source of Truth
- ADR-0004: Device Manifest
- ADR-0005: Device Lifecycle States

---

## Implementation Notes

- This decision is **protocol-level** and must be respected by all implementations.
- Implementation details (Policy Engine API, integration patterns) are defined in the Axis-core repository.
