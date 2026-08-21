# Provisioning Service Specification

## Status
Draft v0.1

## Introduction
The Provisioning Service handles registration, identification and initial configuration of devices in the ENRG ecosystem. It is the entry point for all new devices.

---

## Device registration process

### Step 1. Key generation
On first boot, the device (ESP32) generates an Ed25519 key pair:
- The private key stays on the device (never leaves it).
- The public key is sent to the server for registration.

### Step 2. Send the registration request
The device sends a request to the Provisioning Service containing:
- `device_id` — a unique identifier (generated on the device).
- `public_key` — the public key in Base64.
- `signature` — the request signature (proof of key ownership).
- `device_type` — the device type (Basic, Verified, Industrial).
- `firmware_version` — the firmware version.

### Step 3. Verification
The Provisioning Service checks:
- The request signature.
- device_id uniqueness.
- No duplicate public keys.

### Step 4. Claim Code generation
After a successful verification, the server generates a **one-time Claim Code** (8 characters, e.g. `A7F4-K92Q`).

### Step 5. Return the response to the device
The device receives:
- `claim_code` — for display to the user.
- `status` — `registered`.
- `oracle_endpoint` — the oracle URL for sending Proofs.

### Step 6. Owner binding (Claim)
The user enters the Claim Code in the Dashboard. The device is then bound to their wallet and moves to the `CLAIMED` state.

---

## API endpoints

### POST /identity/register
Register a new device.

**Request:**
```json
{
  "device_id": "esp32-001",
  "public_key": "pXZTI7zgANLzstGbXkX2hDxUtVBrT71Cb1ByGlCkcbw=",
  "signature": "...",
  "device_type": "Basic",
  "firmware_version": "1.0.0"
}
