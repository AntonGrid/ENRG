
# Device Lifecycle Specification

## Status
Draft v0.1

## Introduction
This document describes the full device lifecycle in the ENRG Protocol ecosystem. Every device passes through a sequence of states, each defining its behavior, rights and allowed actions.

The goal is transparency, manageability and security of the whole network.

---

## Device states

### 1. UNREGISTERED
The device is unknown to the system. It has no cryptographic identity within ENRG.

**Actions:**
- Generate a key pair (private/public key).
- Send a registration request with the public key.

### 2. REGISTERED
The device has a cryptographic identity but is not yet bound to an owner.

**Actions:**
- Wait for owner binding via a Claim Code.
- Send heartbeats (periodic status signals).

### 3. CLAIMED
The device is bound to a specific owner (wallet) but not yet configured to work.

**Actions:**
- Receive the configuration (Device Manifest).
- Configure Wi-Fi, sync time.

### 4. PROVISIONED
The device is fully configured and ready to work, but not yet active.

**Actions:**
- Wait for the activation command.
- Run a system self-test.

### 5. ACTIVE
The device produces energy, signs Proofs and sends them to the oracle.

**Actions:**
- Send Proofs.
- Send heartbeats.
- Join pools.
- Accumulate SRC tokens.

### 6. QUARANTINE
The device is under suspicion. Data is not minted, but diagnostics are available.

**Causes:**
- Suspicious activity (anomalous power, frequent errors).
- Missed heartbeats.
- Complaints from other network participants.

**Actions:**
- Send diagnostics.
- Manual or automatic analysis.
- Return to ACTIVE after the security is confirmed.

### 7. MAINTENANCE
The device is temporarily decommissioned for maintenance (sensor replacement, software updates).

**Actions:**
- Disconnect from pools.
- Stop Proofs.
- After completion — return to ACTIVE.

### 8. REVOKED
The device is permanently removed from the system.

**Causes:**
- Key compromise.
- Sale or transfer to a new owner (via the official mechanism).
- Network rule violations.

**Actions:**
- Block all actions.
- Remove from the registry.
- Wipe data (if necessary).

---

## State transitions

```text
UNREGISTERED
    │
    ▼ (registration)
REGISTERED
    │
    ▼ (binding via a Claim Code)
CLAIMED
    │
    ▼ (configuration)
PROVISIONED
    │
    ▼ (activation)
ACTIVE
    │
    ├── (suspicion/failure) → QUARANTINE → (recovery) → ACTIVE
    │
    ├── (maintenance) → MAINTENANCE → (done) → ACTIVE
    │
    └── (revocation/transfer) → REVOKED
