#pragma once

#include <Arduino.h>
#include <stdint.h>

// Device public identity struct
struct DeviceIdentity {
    String deviceId;       // base58(sha256(public_key))
    uint8_t publicKey[32]; // Ed25519 public key
};

// Identity subsystem initialization.
// Called from setup():
//  - tries to load keys from NVS
//  - if not found — generates a new Ed25519 keypair and saves it
bool identity_init();

// Get the current device identity (device_id + public key)
DeviceIdentity get_device_identity();

// Sign an arbitrary message buffer `bytes` of length msgLen.
// sigOut must point to a 64-byte buffer (Ed25519 signature).
// Returns true on success.
bool sign_message(const uint8_t* msg, size_t msgLen, uint8_t* sigOut);

// Helper: get the firmware version compiled into the firmware
// (define FW_VERSION in platformio.ini or at the top of the .ino file).
const char* get_firmware_version();

// Helper: get the current manifest_version,
// stored in NVS (or an empty string if not yet applied).
String get_manifest_version();

// Set manifest_version and store it in NVS after a successful Manifest application.
void set_manifest_version(const String& manifestVersion);
