# ENRG Error Registry

## Status

Normative

---

# Overview

This registry defines the official ENRG Protocol error codes.

Only error codes registered in this document SHALL be considered standard protocol errors.

---

# Device Errors

| Code | Description |
|------|-------------|
| DEVICE_NOT_FOUND | Device does not exist |
| DEVICE_ALREADY_REGISTERED | Device already registered |
| DEVICE_NOT_CLAIMED | Device has not been claimed |
| DEVICE_REVOKED | Device has been revoked |
| INVALID_DEVICE_STATE | Invalid Device Lifecycle state |

---

# Provisioning Errors

| Code | Description |
|------|-------------|
| PROVISIONING_REQUIRED | Device requires provisioning |
| PROVISIONING_FAILED | Provisioning failed |
| INVALID_MANIFEST | Invalid Device Manifest |

---

# Proof Errors

| Code | Description |
|------|-------------|
| INVALID_PROOF | Invalid Proof-of-Production |
| INVALID_SIGNATURE | Invalid cryptographic signature |
| INVALID_NONCE | Invalid nonce |
| INVALID_TIMESTAMP | Invalid timestamp |
| REPLAY_DETECTED | Replay attack detected |

---

# Oracle Errors

| Code | Description |
|------|-------------|
| ORACLE_UNAVAILABLE | Oracle unavailable |
| VERIFICATION_FAILED | Proof verification failed |

---

# Policy Errors

| Code | Description |
|------|-------------|
| POLICY_REJECTED | Policy Engine rejected the request |
| POLICY_NOT_FOUND | Policy not found |

---

# Registry Errors

| Code | Description |
|------|-------------|
| REGISTRY_CONFLICT | Registry conflict detected |
| REGISTRY_UNAVAILABLE | Registry unavailable |

---

# Smart Contract Errors

| Code | Description |
|------|-------------|
| CONTRACT_REJECTED | Smart Contract rejected the transaction |
| MINT_FAILED | SRC mint failed |
| INSUFFICIENT_BALANCE | Insufficient balance |

---

# Governance Errors

| Code | Description |
|------|-------------|
| PROPOSAL_NOT_FOUND | Governance proposal not found |
| PROPOSAL_REJECTED | Proposal rejected |

---

# General Errors

| Code | Description |
|------|-------------|
| INVALID_REQUEST | Invalid protocol request |
| UNAUTHORIZED | Unauthorized request |
| FORBIDDEN | Operation not permitted |
| INTERNAL_ERROR | Internal protocol error |

---

# Registration Rules

New protocol error codes SHALL be introduced only through Protocol Governance.
