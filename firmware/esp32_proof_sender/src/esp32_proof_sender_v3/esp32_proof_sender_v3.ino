/*
 * ENRG Proof Sender v3 — security-hardened firmware (H-3 / H-4 fixes).
 *
 * Changes relative to v1/v2:
 *   1. (H-3) NO hard-coded private key: the key is generated on the
 *      first boot and stored in NVS (Preferences) or in a protected
 *      ATECC608A slot (if ENRG_USE_ATECC608=1).
 *   2. (H-4) Optional Secure Element ATECC608A as a protected store
 *      for the seed key. IMPORTANT: ATECC608A does NOT support Ed25519 — the signature
 *      is computed in the CPU; the chip is used as a protected Data-Zone slot
 *      (the seed is not in plain NVS). For FULL hardware Ed25519 signing
 *      an NXP SE050 path was added (ENRG_USE_SE050=1, env esp32dev-se050):
 *      the key is generated and signing happens INSIDE the chip (ADR-0001).
 *      If the chip is unavailable — key in NVS + a warning.
 *   3. Binary signature format (as on-chain OracleReport::device_message_to_sign):
 *        device_id(32) || nonce(8 LE) || timestamp(8 LE) || energy_wh(8 LE)
 *   4. Wall-clock via NTP (not millis()).
 *   5. HTTPS with root certificate verification; mTLS optional.
 *
 * Dependencies (PlatformIO):
 *   - platform: espressif32 (Arduino framework)
 *   - lib_deps: rweather/Crypto   (Ed25519)
 *   - optional: cryptoauthlib (when ENRG_USE_ATECC608)
 *   - optional: se050          (when ENRG_USE_SE050 — NXP SE050)
 *   - optional: PZEM004Tv30    (when ENRG_USE_PZEM)
 *
 * /api/v1/proof/submit fields: device_id (0x-hex 64), timestamp, energyWh,
 * nonce, signature (base64). The signature uses the binary format, verified
 * by server.js as sig_mode='binary'.
 */

// ════════════════════════════════════════════════════════════════
//  CONFIGURATION (fill in before flashing)
// ════════════════════════════════════════════════════════════════

// ⚠️ SECURITY (audit 2026-08-18, P1 + Plug & Play): WiFi credentials are NEVER
// set in source/compile-time. They are stored ONLY in NVS
// (Preferences, namespace "enrg", keys wifi_ssid/wifi_pass) and entered
// by the user through the Captive Portal "Axis-Device-XXXX" (see setup_wifi()).
//
// ── Plug & Play: local HTTP signer (Axis-connect) ──
// Local signer port: GET /api/device/info, POST /api/device/sign.
#ifndef ENRG_SIGNER_PORT
#define ENRG_SIGNER_PORT 8080
#endif
// 1 — accept signer requests ONLY from local subnets
// (RFC1918 10/8, 172.16/12, 192.168/16, loopback, link-local).
#ifndef ENRG_SIGNER_LAN_ONLY
#define ENRG_SIGNER_LAN_ONLY 1
#endif
// Maximum message size that can be signed over HTTP (bytes).
#ifndef ENRG_SIGNER_MAX_MSG
#define ENRG_SIGNER_MAX_MSG 256
#endif
// Saved-WiFi connection timeout (ms) — 30 seconds.
#ifndef ENRG_WIFI_CONNECT_TIMEOUT_MS
#define ENRG_WIFI_CONNECT_TIMEOUT_MS 30000UL
#endif
// Captive Portal timeout (sec). After it expires the device continues without WiFi.
#ifndef ENRG_AP_TIMEOUT_SEC
#define ENRG_AP_TIMEOUT_SEC 600
#endif

// Oracle HTTP(S) endpoint. The firmware supports both modes: http://
// (local network / dev, only when ENRG_ALLOW_HTTP=1) and https:// (with root CA
// verification, ENRG_CA_CERT). By default — HTTPS ONLY (ADR-0008: TLS 1.3
// for proof/manifest/OTA delivery). If a valid Device Manifest is received
// (ADR-0004), the real URL is taken from manifest.oracle_url.
// ⚠️ Replace the default address with your oracle before flashing.
#ifndef ENRG_ORACLE_URL
#define ENRG_ORACLE_URL "https://oracle.enrg.network/api/v1/proof/submit"
#endif

// ── Device Manifest (ADR-0004) ──
// Manifest endpoint base URL: "/<device_id>" is appended to it.
#ifndef ENRG_MANIFEST_URL_BASE
#define ENRG_MANIFEST_URL_BASE "https://oracle.enrg.network/api/v1/manifest"
#endif

// ORACLE public key (founder, Ed25519, 32 bytes) — embedded into the firmware.
// Manifests are signed with this key on the oracle side (FOUNDER_KEY);
// the device verifies the signature BEFORE using the manifest.
// FILL IN the real key before flashing (32 hex bytes, without "0x").
#ifndef ENRG_FOUNDER_PUBKEY_HEX
// Real founder key (Ed25519, 32 hex bytes) — the oracle public key used
// to sign Device Manifests (ADR-0004) and firmware images (ADR-0008).
// Corresponds to the founder wallet ~/.config/solana/founder-wallet.json
// (base58: 6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8).
// IMPORTANT: when FOUNDER_KEY changes on the oracle, update the key and reflash the devices.
#define ENRG_FOUNDER_PUBKEY_HEX "545ebb75bdc2022c089a4813eb4e76acc7c6628cadd18eb84d74131ccf9bfafd"
#endif

// ── SEPARATE "cold" firmware-signing key (ADR-0008, D-5) ──
// OTA images are signed with THIS key, NOT the founder key (key separation
// principle: the founder signs manifests, the firmware key signs images).
// The private key lives in an offline store (HSM/cold wallet); a dev copy is in
// firmware/firmware-signing-keypair.json (gitignored). The public key is embedded
// here to verify OTA metadata signatures on the device.
#ifndef ENRG_FIRMWARE_PUBKEY_HEX
#define ENRG_FIRMWARE_PUBKEY_HEX "393561ec672d078ea3cae1962db935568fd1af06ddd25b65be3bdfe746d23354"
#endif

// 1 — the manifest is required: without a valid manifest proofs are NOT sent.
// 0 — backward compatibility: if the manifest is unavailable/invalid, the device
//     works with the hard-coded configuration (ENRG_ORACLE_URL).
#ifndef ENRG_MANIFEST_REQUIRED
#define ENRG_MANIFEST_REQUIRED 0
#endif

// How often to retry fetching the manifest (ms) when it has not been received.
#ifndef ENRG_MANIFEST_RETRY_MS
#define ENRG_MANIFEST_RETRY_MS 60000UL
#endif

// ── OTA updates (ADR-0008) ──
// Current firmware version (used for anti-rollback).
#ifndef ENRG_FW_VERSION
#define ENRG_FW_VERSION "1.0.0"
#endif

// Oracle firmware endpoint base URL: /latest and /latest/image are appended.
#ifndef ENRG_FIRMWARE_URL_BASE
#define ENRG_FIRMWARE_URL_BASE "https://oracle.enrg.network/api/v1/firmware"
#endif

// ⚠️ SECURITY (audit 2026-08-18, P0-3): by default the firmware REFUSES
// to work over plain HTTP (ADR-0008 requires TLS 1.3). For local
// development set ENRG_ALLOW_HTTP=1 in build_flags — and only together with
// ENRG_MANIFEST_REQUIRED=0 for an explicit dev mode.
#ifndef ENRG_ALLOW_HTTP
#define ENRG_ALLOW_HTTP 0
#endif

// Device model (the oracle puts it into metadata; the device skips the
// update if the model does not match).
#ifndef ENRG_FW_MODEL
#define ENRG_FW_MODEL "ENRG-ESP32-v1"
#endif

// How often to check for updates (ms). Default 6 hours.
#ifndef ENRG_UPDATE_CHECK_MS
#define ENRG_UPDATE_CHECK_MS 21600000UL
#endif

// Maximum image size (bytes) — smaller than the ESP32 OTA partition (~1.3 MB).
#ifndef ENRG_MAX_FW_SIZE
#define ENRG_MAX_FW_SIZE 1300000UL
#endif

// NTP server for the wall clock.
#ifndef ENRG_NTP_SERVER
#define ENRG_NTP_SERVER "pool.ntp.org"
#endif

// Root CA certificate for TLS connection verification.
// Example for Let's Encrypt (ISRG Root X1): https://letsencrypt.org/certs/isrgrootx1.pem.txt
#ifndef ENRG_CA_CERT
#define ENRG_CA_CERT nullptr
#endif

// ── mTLS (optional): client certificate and key (PEM). ──
#ifndef ENRG_MTLS
#define ENRG_MTLS 0
#endif
#ifndef ENRG_CLIENT_CERT
#define ENRG_CLIENT_CERT nullptr
#endif
#ifndef ENRG_CLIENT_PRIVKEY
#define ENRG_CLIENT_PRIVKEY nullptr
#endif

// ── Secure Element ATECC608 (optional). Requires cryptoauthlib. ──
#ifndef ENRG_USE_ATECC608
#define ENRG_USE_ATECC608 0
#endif
// ATECC608A Data-Zone slot number for storing the 32-byte seed (0..15).
#ifndef ENRG_ATECC_SLOT
#define ENRG_ATECC_SLOT 4
#endif

// ── Secure Element NXP SE050 (optional). Requires lib_deps: se050. ──
// SE050 supports Ed25519 NATIVELY: the private key is stored and signing
// happens INSIDE the chip — full ADR-0001 compliance (unlike
// ATECC608A, which is only a seed vault and signs in the CPU).
// Build: pio run -e esp32dev-se050   (see platformio.ini).
// ⚠️ The path requires a board with SE050 (I2C) and the se050 library; by default
// it is disabled — it does not affect the base build.
#ifndef ENRG_USE_SE050
#define ENRG_USE_SE050 0
#endif
// SSS object id of the Ed25519 key inside the SE050.
#ifndef ENRG_SE050_KEY_ID
#define ENRG_SE050_KEY_ID 0x00000011
#endif
// SE050 I2C address (0x48 — default, SE050 rev B).
#ifndef ENRG_SE050_I2C_ADDR
#define ENRG_SE050_I2C_ADDR 0x48
#endif

// ── Hardware OTA anti-rollback (ADR-0008) ──
// 1 = dual-bank A/B + monotonic eFuse secure_version (env esp32dev-ota).
// Requires partitions_ota.csv (app0/app1/otadata) and
// sdkconfig.defaults.esp32dev-ota (CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y,
// CONFIG_BOOTLOADER_EFUSE_SECURE_VERSION=y). Default 0 — does not affect
// the base build (single-app, anti-rollback only via NVS fw_version).
#ifndef ENRG_ENABLE_HW_ANTI_ROLLBACK
#define ENRG_ENABLE_HW_ANTI_ROLLBACK 0
#endif

// ── PZEM-004T sensor (optional). Without it — a read_energy_wh() stub. ──
#ifndef ENRG_USE_PZEM
#define ENRG_USE_PZEM 0
#endif

// Proof send interval, ms (default 60 s).
#ifndef ENRG_REPORT_INTERVAL_MS
#define ENRG_REPORT_INTERVAL_MS 60000UL
#endif

// Minimum epoch for the time to be considered synced (2000-09-09).
#ifndef ENRG_MIN_EPOCH
#define ENRG_MIN_EPOCH 968000000L

// ════════════════════════════════════════════════════════════════
//  INCLUDE
// ════════════════════════════════════════════════════════════════

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>   // Plug & Play: local HTTP signer (port ENRG_SIGNER_PORT)
#include <ESPmDNS.h>     // Plug & Play: mDNS axis-device-XXXX.local
#include <WiFiManager.h> // Plug & Play: Captive Portal (AP Axis-Device-XXXX)
#include <Preferences.h>
#include <ArduinoJson.h>   // ADR-0004: parse the signed Device Manifest
#include <LittleFS.h>      // ADR-0008: staging area for the OTA image
#include <Update.h>        // ADR-0008: ESP32 OTA (firmware update)
#include <Crypto.h>        // Ed25519 (signatures)
#include <SHA256.h>        // ADR-0008: SHA-256 for OTA image verification
#include <Ed25519.h>

#if ENRG_USE_PZEM
#include <PZEM004Tv30.h>
#endif

#if ENRG_USE_ATECC608
#include <cryptoauthlib.h>
#endif

#if ENRG_USE_SE050
// NXP SE050 (plug-and-trust): SSS API. Requires lib_deps: se050.
#include <sss.h>
#include <fsl_sss_se05x_apis.h>
#include <fsl_sss_se05x_types.h>
#endif

#if ENRG_ENABLE_HW_ANTI_ROLLBACK
// ADR-0008: dual-bank OTA (esp_ota A/B) + monotonic eFuse secure_version.
#include <esp_ota_ops.h>
#include <esp_efuse.h>
#endif

// ── Global device keys (filled in identity_init_v3) ──
static uint8_t g_privateKey[32];
static uint8_t g_publicKey[32];
static unsigned long g_lastReportMs = 0;

// ════════════════════════════════════════════════════════════════
//  base64 (compact implementation, no external libraries)
// ════════════════════════════════════════════════════════════════

static const char BASE64_CHARS[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

String base64_encode(const uint8_t *data, size_t len) {
    String out;
    out.reserve(((len + 2) / 3) * 4);
    for (size_t i = 0; i < len; i += 3) {
        uint32_t b = ((uint32_t)data[i]) << 16;
        if (i + 1 < len) b |= ((uint32_t)data[i + 1]) << 8;
        if (i + 2 < len) b |= data[i + 2];
        out += BASE64_CHARS[(b >> 18) & 0x3F];
        out += BASE64_CHARS[(b >> 12) & 0x3F];
        out += (i + 1 < len) ? BASE64_CHARS[(b >> 6) & 0x3F] : '=' ;
        out += (i + 2 < len) ? BASE64_CHARS[b & 0x3F] : '=';
    }
    return out;
}

// Base64 character value (0..63) or -1 if the character is invalid.
static int b64_val(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

/**
 * Base64 decoding (no external libraries). Returns the number of
 * decoded bytes or -1 on error/buffer overflow.
 * Used to parse the Device Manifest signature (ADR-0004).
 */
int base64_decode(const String &in, uint8_t *out, size_t maxOut) {
    size_t oi = 0;
    int buf = 0, bits = 0;
    for (size_t i = 0; i < in.length(); i++) {
        char c = in[i];
        if (c == '=' || c == '\r' || c == '\n' || c == ' ') break; // padding/junk
        int v = b64_val(c);
        if (v < 0) return -1;
        buf = (buf << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            if (oi >= maxOut) return -1;
            out[oi++] = (uint8_t)((buf >> bits) & 0xFF);
        }
    }
    return (int)oi;
}

// ════════════════════════════════════════════════════════════════
//  hex (device_id = "0x" + 64 hex characters of the public key)
// ════════════════════════════════════════════════════════════════

String to_hex(const uint8_t *data, size_t len) {
    static const char HEX_CHARS[] = "0123456789abcdef";
    String out;
    out.reserve(len * 2);
    for (size_t i = 0; i < len; ++i) {
        out += HEX_CHARS[(data[i] >> 4) & 0x0F];
        out += HEX_CHARS[data[i] & 0x0F];
    }
    return out;
}

String device_id_from_pubkey(const uint8_t *pubkey) {
    return "0x" + to_hex(pubkey, 32);
}

// ════════════════════════════════════════════════════════════════
//  KEY STORAGE (H-3 / H-4)
//  Priority: ATECC608A (if enabled and available) → NVS.
// ════════════════════════════════════════════════════════════════

static Preferences g_prefs;
static bool g_key_in_secure_element = false;

static bool store_seed_atecc(const uint8_t seed[32]) {
#if ENRG_USE_ATECC608
    ATCA_STATUS status = atcab_init(NULL);
    if (status != ATCA_SUCCESS) return false;
    // Write to the Data-Zone slot; the slot must be configured as
    // write-protected/encrypted (see the ATECC608A datasheet, config zone).
    status = atcab_write_bytes(ENRG_ATECC_SLOT, 0, (uint8_t *)seed, 32);
    if (status != ATCA_SUCCESS) return false;
    g_key_in_secure_element = true;
    return true;
#else
    (void)seed;
    return false;
#endif
}

static bool load_seed_atecc(uint8_t seed[32]) {
#if ENRG_USE_ATECC608
    ATCA_STATUS status = atcab_init(NULL);
    if (status != ATCA_SUCCESS) return false;
    status = atcab_read_bytes(ENRG_ATECC_SLOT, 0, seed, 32);
    if (status != ATCA_SUCCESS) return false;
    g_key_in_secure_element = true;
    return true;
#else
    (void)seed;
    return false;
#endif
}

#if ENRG_USE_SE050
// ════════════════════════════════════════════════════════════════
//  NXP SE050 — hardware Ed25519 signing (full ADR-0001 compliance).
//
//  Unlike ATECC608A (seed vault + CPU signing), the SE050 supports Ed25519
//  NATIVELY: the private key is generated/stored INSIDE the chip and never
//  leaves it; signing is performed in hardware.
//
//  ⚠️ REFERENCE IMPLEMENTATION: the code requires a board with SE050 (I2C) and the
//  `se050` library (PlatformIO env `esp32dev-se050`). Without the chip the path does not build and
//  is not enabled (ENRG_USE_SE050=0 by default). During bring-up, check the SSS
//  function names against the library version.
// ════════════════════════════════════════════════════════════════

static sss_se05x_connect_ctx_t g_se05x_ctx = {0};
static sss_session_t g_se05x_session = {0};
static sss_key_store_t g_se05x_key_store = {0};
static sss_object_t g_se05x_key_obj = {0};
static sss_asymmetric_t g_se05x_asym = {0};
static bool g_se050_ready = false;

/** Open a session with the SE050 (I2C). */
static bool se050_open() {
    sss_status_t st = sss_se05x_connect(&g_se05x_ctx);
    if (st != kStatus_SSS_Success) {
        Serial.println("[SE050] connect failed");
        return false;
    }
    st = sss_open_session(&g_se05x_session, &g_se05x_ctx, kSSS_ConnectionType_Plain);
    if (st != kStatus_SSS_Success) {
        Serial.println("[SE050] open session failed");
        return false;
    }
    st = sss_key_store_init(&g_se05x_key_store, &g_se05x_session);
    if (st != kStatus_SSS_Success) {
        Serial.println("[SE050] key store init failed");
        return false;
    }
    st = sss_key_object_init(&g_se05x_key_obj, &g_se05x_key_store);
    if (st != kStatus_SSS_Success) {
        Serial.println("[SE050] key object init failed");
        return false;
    }
    return true;
}

/**
 * Load an existing Ed25519 key from the SE050 or create a new one INSIDE the chip.
 * The public key is obtained from the SE050 (device_id stays stable across boots).
 */
static bool se050_load_or_create_key(uint8_t publicKey[32]) {
    sss_status_t st = sss_crypto_object_get_handle(
        &g_se05x_key_obj, &g_se05x_key_store,
        kSSS_KeyPart_Pair_Ed25519, kSSS_CipherType_EC_ED25519, ENRG_SE050_KEY_ID);
    if (st != kStatus_SSS_Success) {
        // No key — generate it DIRECTLY IN the SE050 (the secret never appears on the bus).
        st = sss_crypto_object_create(
            &g_se05x_key_obj, &g_se05x_key_store,
            kSSS_KeyPart_Pair_Ed25519, kSSS_CipherType_EC_ED25519, ENRG_SE050_KEY_ID);
        if (st != kStatus_SSS_Success) {
            Serial.println("[SE050] key create failed");
            return false;
        }
        Serial.println("[SE050] Ed25519 keypair created inside chip");
    } else {
        Serial.println("[SE050] existing Ed25519 key loaded");
    }

    st = sss_asymmetric_context_init(&g_se05x_asym, &g_se05x_session,
                                     &g_se05x_key_obj, kAlgorithm_SSS_Ed25519,
                                     kMode_SSS_Sign);
    if (st != kStatus_SSS_Success) {
        Serial.println("[SE050] asymmetric context init failed");
        return false;
    }

    size_t pubLen = 32;
    st = sss_asymmetric_get_pub_key(&g_se05x_asym, &g_se05x_key_obj, publicKey, &pubLen);
    if (st != kStatus_SSS_Success || pubLen != 32) {
        Serial.println("[SE050] get pub key failed");
        return false;
    }
    return true;
}

/** Hardware Ed25519 signature inside the SE050 (the private key never leaves the chip). */
static bool se050_sign(const uint8_t *msg, size_t msgLen, uint8_t signature[64]) {
    size_t sigLen = 64;
    sss_status_t st = sss_asymmetric_sign(&g_se05x_asym, msg, msgLen, signature, &sigLen);
    return (st == kStatus_SSS_Success && sigLen == 64);
}

/** SE050 path initialization: session + key + public key. */
static bool identity_init_se050(uint8_t publicKey[32]) {
    if (!se050_open()) return false;
    if (!se050_load_or_create_key(publicKey)) return false;
    g_se050_ready = true;
    return true;
}
#endif // ENRG_USE_SE050

// Generates the Ed25519 key on first boot and stores the seed in NVS
// (or ATECC608A). On later boots — loads it.
bool identity_init_v3(uint8_t privateKey[32], uint8_t publicKey[32]) {
    g_prefs.begin("enrg", false);

    // 1) Try the Secure Element (if enabled).
#if ENRG_USE_ATECC608
    if (load_seed_atecc(privateKey)) {
        Ed25519::derivePublicKey(publicKey, privateKey);
        Serial.println("[KEY] loaded from ATECC608A (secure slot)");
        return true;
    }
#endif

    // 2) Try NVS.
    size_t privLen = g_prefs.getBytesLength("privkey");
    if (privLen == 32) {
        g_prefs.getBytes("privkey", privateKey, 32);
        Ed25519::derivePublicKey(publicKey, privateKey);
        Serial.println("[KEY] loaded from NVS");
        return true;
    }

    // 3) No key — generate one.
    // Crypto 0.4.0: Ed25519::generatePrivateKey(privkey) uses the internal RNG.
    Ed25519::generatePrivateKey(privateKey);
    Ed25519::derivePublicKey(publicKey, privateKey);

#if ENRG_USE_ATECC608
    if (store_seed_atecc(privateKey)) {
        g_prefs.remove("privkey"); // no duplicate in NVS needed
        Serial.println("[KEY] generated and stored in ATECC608A");
        return true;
    }
    Serial.println("[WARN] ATECC608A unavailable — the key is stored in NVS (not a Secure Element).");
#else
    Serial.println("[WARN] Secure Element disabled (ENRG_USE_ATECC608=0) — key in NVS (flash).");
#endif

    g_prefs.putBytes("privkey", privateKey, 32);
    Serial.println("[KEY] generated and stored in NVS");
    return true;
}

// ════════════════════════════════════════════════════════════════
//  COMMON SIGNING PATH (Serial SIGN / local HTTP signer)
//  ADR-0001: the private key never leaves the device; only the signature
//  goes out. CPU Ed25519 (NVS/ATECC seed) or hardware SE050.
// ════════════════════════════════════════════════════════════════

static bool sign_with_device_key(const uint8_t *msg, size_t msgLen, uint8_t signature[64]) {
#if ENRG_USE_SE050
    if (g_se050_ready) return se050_sign(msg, msgLen, signature);
#endif
    Ed25519::sign(signature, g_privateKey, g_publicKey, msg, msgLen);
    return true;
}

// Canonical prefix of the messages the device signs OVER THE NETWORK
// (mirrors security/lifecycle.rs: enrg:device:register/claim/rotate).
static const uint8_t ENRG_DEVICE_SIGN_PREFIX[] = "enrg:device:";
static const size_t ENRG_DEVICE_SIGN_PREFIX_LEN = sizeof(ENRG_DEVICE_SIGN_PREFIX) - 1; // 12

/**
 * Domain validation for the HTTP signer (mandatory):
 *  - the message starts with "enrg:device:" (protocol domains only);
 *  - the embedded device_id (bytes 12..44) == our public key.
 * The HTTP endpoint does NOT sign arbitrary messages — only Serial
 * (physical access to the device).
 */
static bool signer_message_allowed(const uint8_t *msg, size_t len) {
    if (len < ENRG_DEVICE_SIGN_PREFIX_LEN + 32) return false;
    if (memcmp(msg, ENRG_DEVICE_SIGN_PREFIX, ENRG_DEVICE_SIGN_PREFIX_LEN) != 0) return false;
    if (memcmp(msg + ENRG_DEVICE_SIGN_PREFIX_LEN, g_publicKey, 32) != 0) return false;
    return true;
}

/** RFC1918 / loopback / link-local — the "local loop" for the signer. */
static bool is_private_ipv4(uint8_t a, uint8_t b, uint8_t c, uint8_t d) {
    (void)c; (void)d;
    if (a == 10) return true;               // 10/8
    if (a == 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a == 192 && b == 168) return true;  // 192.168/16
    if (a == 127) return true;              // loopback
    if (a == 169 && b == 254) return true;  // link-local 169.254/16
    return false;
}

static bool signer_client_allowed(const IPAddress &ip) {
#if ENRG_SIGNER_LAN_ONLY
    return is_private_ipv4(ip[0], ip[1], ip[2], ip[3]);
#else
    (void)ip;
    return true;
#endif
}

// Monotonic nonce, persistent across reboots (anti-replay).
uint32_t next_nonce() {
    uint32_t n = g_prefs.getUInt("nonce", 0) + 1;
    g_prefs.putUInt("nonce", n);
    return n;
}

// ════════════════════════════════════════════════════════════════
//  BINARY SIGNATURE (on-chain format)
//  message = device_id(32) || nonce(8 LE) || timestamp(8 LE) || energy_wh(8 LE)
//  Matches state/oracle.rs OracleReport::device_message_to_sign().
// ════════════════════════════════════════════════════════════════

static void le64_put(uint8_t *buf, uint64_t v) {
    for (int i = 0; i < 8; ++i) { buf[i] = (uint8_t)(v >> (8 * i)); }
}

void build_proof_message(uint8_t msg[56], const uint8_t pubkey[32],
                         uint32_t nonce, int64_t timestamp, uint64_t energyWh) {
    memcpy(msg, pubkey, 32);
    le64_put(msg + 32, nonce);
    le64_put(msg + 40, (uint64_t)timestamp);
    le64_put(msg + 48, energyWh);
}

// ════════════════════════════════════════════════════════════════
//  ENERGY (Wh per report interval)
// ════════════════════════════════════════════════════════════════

#if ENRG_USE_PZEM
static PZEM004Tv30 g_pzem(Serial2, 16, 17); // RX=16, TX=17
static bool g_pzem_ok = false;
#endif

uint64_t read_energy_wh() {
#if ENRG_USE_PZEM
    float energy = g_pzem.energy(); // kWh
    if (isnan(energy)) {
        Serial.println("[SENSOR] PZEM error (NaN)");
        return 0;
    }
    return (uint64_t)(energy * 1000.0f); // kWh -> Wh
#else
    // Stub without a sensor. Connect a PZEM-004T and enable ENRG_USE_PZEM=1.
    return 1; // 1 Wh per interval
#endif
}

// ════════════════════════════════════════════════════════════════
//  NTP (wall clock instead of millis())
// ════════════════════════════════════════════════════════════════

void ntp_sync() {
    configTime(0, 0, ENRG_NTP_SERVER);
    Serial.printf("[NTP] syncing with %s ...\n", ENRG_NTP_SERVER);
}

bool time_is_synced() {
    time_t now = time(nullptr);
    return now > ENRG_MIN_EPOCH;
}

// ════════════════════════════════════════════════════════════════
//  WIFI
// ════════════════════════════════════════════════════════════════

// ── Credentials: ONLY NVS (Preferences, namespace "enrg") ──
static const char WIFI_PREF_SSID[] = "wifi_ssid";
static const char WIFI_PREF_PASS[] = "wifi_pass";

static String wifi_ssid_from_nvs() { return g_prefs.getString(WIFI_PREF_SSID, ""); }
static String wifi_pass_from_nvs() { return g_prefs.getString(WIFI_PREF_PASS, ""); }

static void wifi_save_creds(const String &ssid, const String &pass) {
    g_prefs.putString(WIFI_PREF_SSID, ssid);
    g_prefs.putString(WIFI_PREF_PASS, pass);
    Serial.printf("[WIFI] credentials saved in NVS: %s\n", ssid.c_str());
}

static void wifi_clear_creds() {
    g_prefs.remove(WIFI_PREF_SSID);
    g_prefs.remove(WIFI_PREF_PASS);
    Serial.println("[WIFI] credentials erased from NVS");
}

// ── Plug & Play: names are derived from deviceId (last pubkey hex), ──
//    so Axis-connect can derive the hostname directly from the QR payload.
static String device_tail_hex(size_t n) {
    String id = device_id_from_pubkey(g_publicKey); // "0x" + 64 hex
    return id.substring(id.length() - n);
}
// AP "Axis-Device-XXXX": XXXX = last 4 deviceId hex chars.
static String ap_name() { return "Axis-Device-" + device_tail_hex(4); }
// AP password: last 8 deviceId hex chars (not hard-coded; printed to Serial).
static String ap_password() { return device_tail_hex(8); }
// mDNS: axis-device-xxxx.local (RFC 6763: only [a-z0-9-]).
static String mdns_hostname() {
    String tail = device_tail_hex(4);
    tail.toLowerCase();
    return "axis-device-" + tail;
}

/** Connect to Wi-Fi with explicit credentials and a timeout. */
bool connect_wifi_creds(const String &ssid, const String &pass, unsigned long timeoutMs) {
    if (WiFi.status() == WL_CONNECTED) return true;
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), pass.c_str());
    Serial.printf("[WIFI] connecting to %s ...\n", ssid.c_str());
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - start) < timeoutMs) {
        delay(200);
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("[WIFI] connected, IP=%s\n", WiFi.localIP().toString().c_str());
        return true;
    }
    Serial.println("[WIFI] connect FAILED");
    return false;
}

/** Connect using the credentials from NVS. */
bool connect_wifi_from_nvs(unsigned long timeoutMs) {
    if (WiFi.status() == WL_CONNECTED) return true;
    String ssid = wifi_ssid_from_nvs();
    if (ssid.length() == 0) return false;
    return connect_wifi_creds(ssid, wifi_pass_from_nvs(), timeoutMs);
}

/**
 * Captive Portal (WiFiManager): a protected AP "Axis-Device-XXXX".
 * The user connects to the AP, is taken to the portal (DNS redirect),
 * and enters the home network SSID/password. WE save the credentials in NVS ourselves.
 * Returns true if the user configured the network (ESP.restart() needed).
 */
static bool start_captive_portal() {
    String apName = ap_name();
    String apPass = ap_password();
    Serial.printf("[PORTAL] AP: %s (password: %s)\n", apName.c_str(), apPass.c_str());
    Serial.printf("[PORTAL] connect to %s, open http://192.168.4.1\n", apName.c_str());

    WiFiManager wm;
    // Do not rely on WiFiManager's own persistence — the credentials
    // are read/written only through our Preferences (namespace "enrg").
    wm.setConfigPortalTimeout((unsigned long)ENRG_AP_TIMEOUT_SEC);
    wm.setConnectTimeout(30);

    if (!wm.startConfigPortal(apName.c_str(), apPass.c_str())) {
        Serial.println("[PORTAL] the user did not configure the network (timeout/cancel)");
        return false;
    }

    String ssid = wm.getWiFiSSID();
    String pass = wm.getWiFiPass();
    if (ssid.length() == 0) {
        Serial.println("[PORTAL] WiFiManager did not return an SSID — continuing without WiFi");
        return false;
    }
    wifi_save_creds(ssid, pass);
    return true;
}

/** Orchestration: NVS credentials → 30s connect → otherwise Captive Portal. */
static bool setup_wifi() {
    String ssid = wifi_ssid_from_nvs();
    if (ssid.length() > 0) {
        if (connect_wifi_creds(ssid, wifi_pass_from_nvs(), ENRG_WIFI_CONNECT_TIMEOUT_MS)) {
            return true;
        }
        Serial.println("[WIFI] saved network unavailable — starting the Captive Portal");
    } else {
        Serial.println("[WIFI] no credentials in NVS — starting the Captive Portal (first setup)");
    }

    if (start_captive_portal()) {
        Serial.println("[WIFI] setup complete — rebooting for a clean STA start");
        delay(1000);
        ESP.restart();
    }
    return WiFi.status() == WL_CONNECTED;
}

// ════════════════════════════════════════════════════════════════
//  SENDING PROOF (http:// or https:// — chosen by the URL scheme)
// ════════════════════════════════════════════════════════════════

// ── Global manifest state (ADR-0004) ──
// Proof-sending URL: ENRG_ORACLE_URL by default (backward
// compatibility); replaced by manifest.oracle_url when a valid manifest exists.
static String g_proof_url = ENRG_ORACLE_URL;
// Device rated power from the manifest (W); 0 — not set.
static uint64_t g_rated_power = 0;
// true — the manifest was received and its signature verified.
static bool g_manifest_valid = false;

/** Extract the host from a URL (http://host[:port]/path). */
static String url_host(const String &url) {
    int schemeEnd = url.indexOf("://");
    if (schemeEnd < 0) return "";
    int hostStart = schemeEnd + 3;
    int slash = url.indexOf('/', hostStart);
    int colon = url.indexOf(':', hostStart);
    int end = slash < 0 ? (int)url.length() : slash;
    if (colon > 0 && colon < end) end = colon;
    return url.substring(hostStart, end);
}

/** Is the host local: loopback / RFC1918 / link-local / mDNS .local. */
static bool host_is_local(const String &host) {
    if (host == "localhost") return true;
    if (host.endsWith(".local")) return true;
    int a = -1, b = -1, c = -1, d = -1;
    if (sscanf(host.c_str(), "%d.%d.%d.%d", &a, &b, &c, &d) == 4) {
        return is_private_ipv4((uint8_t)a, (uint8_t)b, (uint8_t)c, (uint8_t)d);
    }
    return false;
}

/**
 * Transport protection against plain HTTP (P0-3, ADR-0008: TLS 1.3).
 * https:// — always allowed. http:// — allowed ONLY for the local
 * loop (loopback/LAN/mDNS: local oracle, signing via the signer);
 * http:// to a REMOTE host is always blocked. ENRG_ALLOW_HTTP=1 is an explicit
 * dev bypass (fully opens http).
 * Returns false if the request is blocked.
 */
static bool transport_allowed(const String &url) {
    if (url.startsWith("https://")) return true;
    if (url.startsWith("http://")) {
#if ENRG_ALLOW_HTTP
        Serial.println("[TLS] WARNING: http:// (no encryption) — DEV only (ENRG_ALLOW_HTTP=1)");
        return true;
#else
        String host = url_host(url);
        if (host_is_local(host)) {
            Serial.printf("[TLS] WARNING: http:// to local host %s (local loop only)\n",
                          host.c_str());
            return true;
        }
        Serial.printf("[TLS] BLOCKED http:// to remote host (ADR-0008): %.80s\n", url.c_str());
        return false;
#endif
    }
    Serial.printf("[TLS] BLOCKED unknown URL scheme: %.80s\n", url.c_str());
    return false;
}

int send_proof_http(const String &body) {
    int code = -1;
    String resp = "";

    if (!transport_allowed(g_proof_url)) {
        return -1;
    }

    if (g_proof_url.startsWith("https://")) {
        // TLS with root CA verification (ENRG_CA_CERT); mTLS optional.
        WiFiClientSecure client;
        client.setCACert(ENRG_CA_CERT); // mandatory root CA verification
#if ENRG_MTLS
        client.setCertificate(ENRG_CLIENT_CERT);
        client.setPrivateKey(ENRG_CLIENT_PRIVKEY);
#endif
        HTTPClient http;
        if (!http.begin(client, g_proof_url)) {
            Serial.println("[HTTP] begin failed (https)");
            return -1;
        }
        http.addHeader("Content-Type", "application/json");
        code = http.POST(body);
        if (code > 0) resp = http.getString();
        http.end();
    } else {
        // Plain HTTP (local network / dev): http://host:port
        WiFiClient client;
        HTTPClient http;
        if (!http.begin(client, g_proof_url)) {
            Serial.println("[HTTP] begin failed (http)");
            return -1;
        }
        http.addHeader("Content-Type", "application/json");
        code = http.POST(body);
        if (code > 0) resp = http.getString();
        http.end();
    }

    if (code == 200) {
        Serial.printf("[PROOF] sent successfully (code=%d, resp=%.120s)\n",
                      code, resp.c_str());
    } else if (code > 0) {
        Serial.printf("[HTTP] proof rejected, code=%d, resp=%.120s\n",
                      code, resp.c_str());
    } else {
        Serial.printf("[HTTP] send failed: %s\n",
                      HTTPClient::errorToString(code).c_str());
    }
    return code;
}

/**
 * Simple HTTP(S) GET (to fetch the Device Manifest, ADR-0004, and
 * OTA metadata). Returns the response body (empty string on error).
 */
String http_get(const String &url) {
    String body = "";
    int code;

    if (!transport_allowed(url)) {
        return "";
    }

    if (url.startsWith("https://")) {
        WiFiClientSecure client;
        client.setCACert(ENRG_CA_CERT); // mandatory root CA verification
#if ENRG_MTLS
        client.setCertificate(ENRG_CLIENT_CERT);
        client.setPrivateKey(ENRG_CLIENT_PRIVKEY);
#endif
        HTTPClient http;
        if (!http.begin(client, url)) {
            Serial.println("[HTTP] GET begin failed (https)");
            return "";
        }
        code = http.GET();
        if (code == 200) body = http.getString();
        else Serial.printf("[HTTP] GET %s -> %d\n", url.c_str(), code);
        http.end();
    } else {
        WiFiClient client;
        HTTPClient http;
        if (!http.begin(client, url)) {
            Serial.println("[HTTP] GET begin failed (http)");
            return "";
        }
        code = http.GET();
        if (code == 200) body = http.getString();
        else Serial.printf("[HTTP] GET %s -> %d\n", url.c_str(), code);
        http.end();
    }

    return body;
}

// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
//  DEVICE MANIFEST (ADR-0004)
// ════════════════════════════════════════════════════════════════

// Parse the founder public key hex string into bytes (32).
bool parse_hex(const char *hex, uint8_t *out, size_t outLen) {
    size_t len = strlen(hex);
    if (len != outLen * 2) return false;
    for (size_t i = 0; i < outLen; i++) {
        char hi = hex[i * 2], lo = hex[i * 2 + 1];
        auto nib = [](char c) -> int {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            return -1;
        };
        int h = nib(hi), l = nib(lo);
        if (h < 0 || l < 0) return false;
        out[i] = (uint8_t)((h << 4) | l);
    }
    return true;
}

/**
 * Verify a signed Device Manifest (ADR-0004).
 *
 * 1. Parses the JSON.
 * 2. Checks the binding to THIS device: device_id == ours, public_key == ours.
 * 3. Rebuilds the canonical signature message (same as in policy.js):
 *      device_id|rated_power|oracle_url|public_key|timestamp
 * 4. Decodes the base64 signature and verifies it with the founder Ed25519 public key
 *    (embedded in the firmware as ENRG_FOUNDER_PUBKEY_HEX).
 *
 * @param body the oracle response body (JSON)
 * @param deviceId our device_id ("0x" + public key hex)
 * @param ownPublicKey our Ed25519 public key (32 bytes)
 * @param ratedPowerOut the rated power (W) from the manifest
 * @param oracleUrlOut the oracle_url from the manifest
 * @returns true if the manifest is valid
 */
bool verify_manifest(const String &body, const String &deviceId,
                     const uint8_t *ownPublicKey,
                     uint64_t &ratedPowerOut, String &oracleUrlOut) {
    // Founder (oracle) public key from the configuration.
    uint8_t founderPub[32];
    if (!parse_hex(ENRG_FOUNDER_PUBKEY_HEX, founderPub, sizeof(founderPub))) {
        Serial.println("[MANIFEST] FATAL: ENRG_FOUNDER_PUBKEY_HEX is invalid");
        return false;
    }

    DynamicJsonDocument doc(1024);
    if (deserializeJson(doc, body)) return false;

    const char *m_id = doc["device_id"];
    const char *m_rated = doc["rated_power"];
    const char *m_oracle = doc["oracle_url"];
    const char *m_pub = doc["public_key"];
    const char *m_ts = doc["timestamp"];
    const char *m_trust = doc["trust_level"];
    const char *m_hb = doc["heartbeat_interval"];
    const char *m_pt = doc["proof_threshold"];
    const char *m_pv = doc["policy_version"];
    const char *m_ve = doc["verifier_endpoint"];
    const char *m_sig = doc["signature"];
    // ADR-0004: all fields are required (audit 2026-08-18, P1-12).
    if (!m_id || !m_rated || !m_oracle || !m_pub || !m_ts || !m_sig ||
        !m_trust || !m_hb || !m_pt || !m_pv || !m_ve) {
        Serial.println("[MANIFEST] one of the required ADR-0004 fields is missing");
        return false;
    }

    // Binding to this device (the manifest cannot be swapped/redirected).
    if (String(m_id) != deviceId) return false;
    if (String(m_pub) != base64_encode(ownPublicKey, 32)) return false;

    // Canonical message — byte-for-byte as in policy.js::buildManifestMessage.
    String msg = String(m_id) + "|" + String(m_rated) + "|" +
                 String(m_oracle) + "|" + String(m_pub) + "|" + String(m_ts) + "|" +
                 String(m_trust) + "|" + String(m_hb) + "|" + String(m_pt) + "|" +
                 String(m_pv) + "|" + String(m_ve);

    uint8_t sig[64];
    if (base64_decode(String(m_sig), sig, sizeof(sig)) != 64) return false;
    if (!Ed25519::verify(sig, founderPub, (const uint8_t *)msg.c_str(), msg.length())) {
        return false;
    }

    ratedPowerOut = strtoull(m_rated, NULL, 10);
    oracleUrlOut = String(m_oracle);
    return true;
}

/** Apply a valid manifest: rated_power + oracle_url → proof endpoint. */
bool apply_manifest(const String &body, const String &deviceId) {
    uint64_t rp = 0;
    String ourl = "";
    if (!verify_manifest(body, deviceId, g_publicKey, rp, ourl)) return false;

    g_rated_power = rp;
    if (ourl.endsWith("/")) ourl.remove(ourl.length() - 1);
    g_proof_url = ourl + "/api/v1/proof/submit";
    g_manifest_valid = true;

    Serial.printf("[MANIFEST] OK device=%s rated_power=%lluW proof_url=%s\n",
                  deviceId.c_str(), (unsigned long long)g_rated_power, g_proof_url.c_str());
    return true;
}

/** Load the manifest from NVS and verify its signature. */
bool load_manifest_from_nvs(const String &deviceId) {
    String stored = g_prefs.getString("manifest", "");
    if (stored.length() == 0) return false;
    if (!apply_manifest(stored, deviceId)) {
        Serial.println("[MANIFEST] NVS copy invalid — will re-request");
        g_prefs.remove("manifest");
        return false;
    }
    return true;
}

/** Request the manifest from the oracle (GET /api/v1/manifest/<device_id>). */
String fetch_manifest_body(const String &deviceId) {
    String url = String(ENRG_MANIFEST_URL_BASE) + "/" + deviceId;
    Serial.printf("[MANIFEST] fetching %s\n", url.c_str());
    return http_get(url);
}

/** Full manifest initialization at startup (setup). */
bool init_manifest(const String &deviceId) {
    // 1) First the NVS copy (the device can work offline, ADR-0004).
    if (load_manifest_from_nvs(deviceId)) return true;

    // 2) Otherwise — fetch a fresh manifest and save it.
    String body = fetch_manifest_body(deviceId);
    if (body.length() > 0 && apply_manifest(body, deviceId)) {
        g_prefs.putString("manifest", body);
        return true;
    }

    g_manifest_valid = false;
    if (ENRG_MANIFEST_REQUIRED) {
        Serial.println("[MANIFEST] FATAL: manifest not received/invalid — proofs blocked");
    } else {
        Serial.println("[MANIFEST] WARN: manifest unavailable — using the hard-coded config (backward compatibility)");
    }
    return false;
}


//  PROOF
// ════════════════════════════════════════════════════════════════

void send_proof(const uint8_t privateKey[32], const uint8_t publicKey[32]) {
    // ADR-0004: if the manifest is required but not received/invalid — we do NOT send proofs.
    if (ENRG_MANIFEST_REQUIRED && !g_manifest_valid) {
        Serial.println("[PROOF] skip: no valid manifest (ENRG_MANIFEST_REQUIRED)");
        return;
    }

    if (!time_is_synced()) {
        Serial.println("[NTP] time not synced yet — proof skipped");
        return;
    }

    uint64_t energyWh = read_energy_wh();

    // ADR-0004: if the rated power is known (rated_power from the manifest),
    // the energy of one report is capped by it (coarse protection against false readings).
    if (g_rated_power > 0 && energyWh > g_rated_power) {
        Serial.printf("[PROOF] WARN: energy %lluWh > rated_power %lluW — clamping\n",
                      (unsigned long long)energyWh, (unsigned long long)g_rated_power);
        energyWh = g_rated_power;
    }

    uint32_t nonce = next_nonce();
    int64_t timestamp = (int64_t)time(nullptr); // wall-clock (epoch)

    // Binary message and signature.
    uint8_t msg[56];
    build_proof_message(msg, publicKey, nonce, timestamp, energyWh);

    uint8_t signature[64];
#if ENRG_USE_SE050
    if (g_se050_ready) {
        // Hardware Ed25519 signature inside the SE050 (the private key never leaves the chip).
        if (!se050_sign(msg, sizeof(msg), signature)) {
            Serial.println("[PROOF] SE050 signing failed — proof skipped");
            return;
        }
    } else {
        Ed25519::sign(signature, privateKey, publicKey, msg, sizeof(msg));
    }
#else
    Ed25519::sign(signature, privateKey, publicKey, msg, sizeof(msg));
#endif

    String deviceId = device_id_from_pubkey(publicKey);
    String sigB64 = base64_encode(signature, sizeof(signature));

    // JSON without external libraries.
    String body;
    body.reserve(256);
    body += "{\"device_id\":\"";
    body += deviceId;
    body += "\",\"timestamp\":";
    body += String(timestamp);
    body += ",\"energyWh\":";
    body += String((unsigned long long)energyWh);
    body += ",\"nonce\":";
    body += String(nonce);
    body += ",\"signature\":\"";
    body += sigB64;
    body += "\"}";

    Serial.printf("[PROOF] device=%s ts=%lld energy=%llu nonce=%u\n",
                  deviceId.c_str(), (long long)timestamp,
                  (unsigned long long)energyWh, nonce);

    if (WiFi.status() != WL_CONNECTED) {
        if (!connect_wifi_from_nvs(20000)) return;
    }
    send_proof_http(body);
}

// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
//  FIRMWARE OTA UPDATES (ADR-0008)
// ════════════════════════════════════════════════════════════════

/**
 * Version comparison "a.b.c..." (numeric, component-wise).
 * Returns >0 if a > b, <0 if a < b, 0 if equal.
 */
int compare_versions(const String &a, const String &b) {
    int pa = 0, pb = 0;
    while (pa < a.length() || pb < b.length()) {
        long na = 0, nb = 0;
        while (pa < a.length() && a[pa] != '.') { na = na * 10 + (a[pa] - '0'); pa++; }
        while (pb < b.length() && b[pb] != '.') { nb = nb * 10 + (b[pb] - '0'); pb++; }
        if (na != nb) return na < nb ? -1 : 1;
        pa++; pb++;
    }
    return 0;
}

/**
 * Firmware metadata signature verification (ADR-0008).
 * The canonical message is `version|image_hash|image_size` (same as in
 * policy.js::buildFirmwareMessage). The public key is embedded in the firmware
 * (ENRG_FIRMWARE_PUBKEY_HEX — a SEPARATE "cold" firmware key, D-5;
 * NOT the founder key used for manifests).
 */
bool verify_firmware_signature(const String &version, const String &hashHex,
                               long imageSize, const String &sigB64) {
    uint8_t fwPub[32];
    if (!parse_hex(ENRG_FIRMWARE_PUBKEY_HEX, fwPub, sizeof(fwPub))) {
        Serial.println("[OTA] FATAL: ENRG_FIRMWARE_PUBKEY_HEX is invalid");
        return false;
    }
    String msg = version + "|" + hashHex + "|" + String(imageSize);
    uint8_t sig[64];
    if (base64_decode(sigB64, sig, sizeof(sig)) != 64) return false;
    return Ed25519::verify(sig, fwPub, (const uint8_t *)msg.c_str(), msg.length());
}

#if ENRG_ENABLE_HW_ANTI_ROLLBACK
// ════════════════════════════════════════════════════════════════
//  DUAL-BANK OTA + HARDWARE MONOTONIC COUNTER (ADR-0008)
//
//  Dual-bank A/B: otadata + app0/app1 (partitions_ota.csv). The new image
//  starts as "pending"; if the application did NOT confirm itself
//  (esp_ota_mark_app_valid_cancel_rollback was not called or
//  esp_ota_mark_app_invalid was called) — the bootloader automatically rolls back
//  to the previous image on the next reboot.
//  Monotonic: secure_version is "burned" into eFuse (the value can only
//  grow); the bootloader (CONFIG_BOOTLOADER_EFUSE_SECURE_VERSION=y) refuses
//  to boot images with an OLDER secure_version — hardware anti-rollback,
//  unlike the NVS fw_version, which can be overwritten with physical access.
// ════════════════════════════════════════════════════════════════

/** "1.2.3" → 1*10000 + 2*100 + 3 (grows monotonically with the version). */
static uint32_t fw_version_number(const char *v) {
    uint32_t maj = 0, min = 0, pat = 0;
    int p = 0;
    while (v[p] && v[p] != '.') { maj = maj * 10 + (uint32_t)(v[p] - '0'); p++; }
    if (v[p] == '.') p++;
    while (v[p] && v[p] != '.') { min = min * 10 + (uint32_t)(v[p] - '0'); p++; }
    if (v[p] == '.') p++;
    while (v[p] >= '0' && v[p] <= '9') { pat = pat * 10 + (uint32_t)(v[p] - '0'); p++; }
    return maj * 10000 + min * 100 + pat;
}

/** Confirm the current image (cancels the automatic rollback). */
static void ota_mark_boot_ok() {
    esp_err_t e = esp_ota_mark_app_valid_cancel_rollback();
    Serial.printf("[OTA] mark_app_valid_cancel_rollback: %s\n", esp_err_to_name(e));
}

/** Burn secure_version into eFuse (increase only) — hardware anti-rollback. */
static void ota_mark_hardware_anti_rollback() {
    uint32_t ver = fw_version_number(ENRG_FW_VERSION);
    esp_err_t e = esp_efuse_update_secure_version(ver);
    Serial.printf("[OTA] eFuse secure_version -> %lu (%s)\n",
                  (unsigned long)ver, esp_err_to_name(e));
}

/** Mark the current image invalid and reboot → rollback to the previous one. */
static void ota_mark_app_invalid() {
    // In the current IDF: esp_ota_mark_app_invalid_rollback_and_reboot() itself
    // performs the reboot. The ESP.restart() below is a safety net.
    esp_err_t e = esp_ota_mark_app_invalid_rollback_and_reboot();
    Serial.printf("[OTA] mark_app_invalid_rollback_and_reboot: %s — rollback...\n",
                  esp_err_to_name(e));
    ESP.restart();
}
#endif // ENRG_ENABLE_HW_ANTI_ROLLBACK


// ════════════════════════════════════════════════════════════════
//  SERIAL COMMANDS (onboarding / registration)
//
//  ADR-0001: the private key NEVER leaves the device. The SIGN
//  command signs an arbitrary message with the LOCAL key and outputs
//  only the signature (64 bytes). This is needed for:
//    * PoP registration at the oracle: a signature over `${device_id}|${public_key}`;
//    * on-chain register/claim: a signature over binary messages
//      (`enrg:device:register ‖ device_id ‖ ts`, etc.).
//
//  Format:
//    HELP             — list of commands
//    INFO             — device_id, public_key (base64/hex), storage
//    SIGN <hex>       — sign the message (hex) with the device Ed25519 key
//                       (max 256 bytes); output: sig_base64 / sig_hex
// ════════════════════════════════════════════════════════════════

static String g_serialLine = "";

static int hex_val_serial(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

/** hex string → bytes. Returns the byte count or -1 on error/overflow. */
static int hex_to_bytes_serial(const String &hex, uint8_t *out, size_t maxOut) {
    if (hex.length() == 0 || hex.length() % 2 != 0) return -1;
    size_t n = hex.length() / 2;
    if (n > maxOut) return -1;
    for (size_t i = 0; i < n; i++) {
        int hi = hex_val_serial(hex[i * 2]);
        int lo = hex_val_serial(hex[i * 2 + 1]);
        if (hi < 0 || lo < 0) return -1;
        out[i] = (uint8_t)((hi << 4) | lo);
    }
    return (int)n;
}

static void print_help_serial() {
    Serial.println("[HELP] Commands:");
    Serial.println("  HELP              — this list");
    Serial.println("  INFO              — device_id, public_key, WiFi/mDNS/signer, storage");
    Serial.println("  SIGN <hex>        — sign an ARBITRARY message (hex, max 256 bytes)");
    Serial.println("                      with the device key (physical access only);");
    Serial.println("                      output sig_base64/sig_hex");
    Serial.println("  CLEARWIFI         — erase the WiFi credentials from NVS and reboot");
    Serial.println("                      (the device will start the Axis-Device-XXXX Captive Portal)");
    Serial.println("  Examples:");
    Serial.println("    SIGN 68656c6c6f           (sign 'hello')");
    Serial.println("    SIGN <hex(device_id|public_key)>   (PoP for the oracle)");
}

static void print_device_info_serial() {
    Serial.printf("[INFO] device_id     = %s\n", device_id_from_pubkey(g_publicKey).c_str());
    Serial.printf("[INFO] public_key    = %s\n", base64_encode(g_publicKey, 32).c_str());
    Serial.printf("[INFO] public_key_hex= %s\n", to_hex(g_publicKey, 32).c_str());
    Serial.printf("[INFO] storage       = %s\n",
                  g_key_in_secure_element ? "Secure Element (SE050/ATECC608A)" : "NVS (flash)");
    Serial.printf("[INFO] fw_version    = %s\n",
                  g_prefs.getString("fw_version", ENRG_FW_VERSION).c_str());
    Serial.printf("[INFO] wifi          = %s\n",
                  (WiFi.status() == WL_CONNECTED) ? ("connected (" + WiFi.localIP().toString() + ")").c_str()
                                                  : "not connected");
    Serial.printf("[INFO] mDNS          = %s.local\n", mdns_hostname().c_str());
    Serial.printf("[INFO] signer        = :%d (LAN-only: %d)\n",
                  (int)ENRG_SIGNER_PORT, (int)ENRG_SIGNER_LAN_ONLY);
    Serial.printf("[INFO] wifi_ssid_nvs = %s\n",
                  wifi_ssid_from_nvs().length() > 0 ? "<saved>" : "<none>");
}

/** CLEARWIFI: fully erase the WiFi credentials from NVS + reboot into AP mode. */
static void cmd_clear_wifi() {
    wifi_clear_creds();
    Serial.println("[WIFI] credentials fully erased from Preferences (NVS)");
    Serial.println("[WIFI] rebooting — the device will start the Axis-Device-XXXX Captive Portal");
    delay(500);
    ESP.restart();
}

static void cmd_sign(const String &hexArg) {
    if (hexArg.length() == 0) {
        Serial.println("[SIGN] ERR: provide a hex message (SIGN <hex>), max 256 bytes");
        return;
    }
    uint8_t msg[256];
    int msgLen = hex_to_bytes_serial(hexArg, msg, sizeof(msg));
    if (msgLen < 0) {
        Serial.println("[SIGN] ERR: invalid hex (even length, 0-9a-fA-F, <= 256 bytes)");
        return;
    }

    uint8_t signature[64];
    if (!sign_with_device_key(msg, (size_t)msgLen, signature)) {
        Serial.println("[SIGN] ERR: signing failed (SE050)");
        return;
    }

    // ADR-0001: only the signature goes out — the private key never leaves the device.
    Serial.printf("[SIGN] device_id    = %s\n", device_id_from_pubkey(g_publicKey).c_str());
    Serial.printf("[SIGN] msg_len      = %d\n", msgLen);
    Serial.printf("[SIGN] sig_base64   = %s\n", base64_encode(signature, 64).c_str());
    Serial.printf("[SIGN] sig_hex      = %s\n", to_hex(signature, 64).c_str());
}

static void process_serial_command(const String &line) {
    int sp = line.indexOf(' ');
    String cmd = (sp < 0) ? line : line.substring(0, sp);
    String arg = (sp < 0) ? "" : line.substring(sp + 1);
    cmd.toUpperCase();
    arg.trim();

    if (cmd == "HELP" || cmd == "?") { print_help_serial(); return; }
    if (cmd == "INFO") { print_device_info_serial(); return; }
    if (cmd == "SIGN") { cmd_sign(arg); return; }
    if (cmd == "CLEARWIFI" || cmd == "WIFIRESET") { cmd_clear_wifi(); return; }

    Serial.printf("[SERIAL] unknown command: %s (HELP for the list)\n", cmd.c_str());
}

/** Poll Serial: accumulates a line until '\n' and parses the command. */
static void handle_serial_input() {
    while (Serial.available() > 0) {
        char c = (char)Serial.read();
        if (c == '\n') {
            g_serialLine.trim();
            if (g_serialLine.length() > 0) process_serial_command(g_serialLine);
            g_serialLine = "";
        } else if (c != '\r') {
            if (g_serialLine.length() < 640) g_serialLine += c; // 512 hex + headroom
        }
    }
}


// ════════════════════════════════════════════════════════════════
//  LOCAL HTTP SIGNER + mDNS (Plug & Play, communication with Axis-connect)
// ════════════════════════════════════════════════════════════════

static WebServer g_signerServer(ENRG_SIGNER_PORT);
static const char SIGNER_JSON[] = "application/json";

static void signer_reject(int code, const char *error) {
    g_signerServer.send(code, SIGNER_JSON, String("{\"error\":\"") + error + "\"}");
}

/** GET /api/device/info → {deviceId, schema, firmware, state}. */
static void handle_device_info() {
    if (!signer_client_allowed(g_signerServer.client().remoteIP())) {
        signer_reject(403, "forbidden");
        return;
    }
    String state = (WiFi.status() == WL_CONNECTED) ? "ready" : "no-wifi";
    if (state == "ready" && ENRG_MANIFEST_REQUIRED && !g_manifest_valid) state = "no-manifest";

    String json = String("{\"deviceId\":\"") + device_id_from_pubkey(g_publicKey) + "\",";
    json += "\"schema\":\"axis-energy-v1\",";
    json += "\"firmware\":\"" ENRG_FW_VERSION "\",";
    json += "\"state\":\"" + state + "\"}";
    g_signerServer.send(200, SIGNER_JSON, json);
}

/**
 * POST /api/device/sign.
 * Body: {"hex":"<message hex>"} (JSON, Axis-connect format) or raw
 * binary payload (application/octet-stream). Response: {"signature":"<hex>"}.
 * Security:
 *  - ENRG_SIGNER_LAN_ONLY — local subnets only (RFC1918);
 *  - domain validation signer_message_allowed(): only "enrg:device:*"
 *    and only with OUR device_id inside. Arbitrary SIGN — Serial only.
 */
static void handle_device_sign() {
    if (!signer_client_allowed(g_signerServer.client().remoteIP())) {
        signer_reject(403, "forbidden");
        return;
    }

    String body = g_signerServer.arg("plain");
    if (body.length() == 0) { signer_reject(400, "empty body"); return; }

    uint8_t msg[ENRG_SIGNER_MAX_MSG];
    size_t msgLen = 0;
    String contentType = g_signerServer.header("Content-Type");

    if (contentType.indexOf("json") >= 0) {
        // {"hex":"..."} — Axis-connect format
        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, body);
        if (err) { signer_reject(400, "invalid json"); return; }
        const char *hex = doc["hex"] | "";
        int n = hex_to_bytes_serial(String(hex), msg, sizeof(msg));
        if (n <= 0) { signer_reject(400, "invalid hex"); return; }
        msgLen = (size_t)n;
    } else {
        // Raw binary body (payload/hash)
        if (body.length() > sizeof(msg)) { signer_reject(413, "message too large"); return; }
        memcpy(msg, body.c_str(), body.length());
        msgLen = body.length();
    }

    if (!signer_message_allowed(msg, msgLen)) {
        Serial.printf("[SIGNER] BLOCKED non-protocol message (%u bytes) from %s\n",
                      (unsigned)msgLen,
                      g_signerServer.client().remoteIP().toString().c_str());
        signer_reject(403, "message not allowed: prefix enrg:device: and own device_id required");
        return;
    }

    uint8_t signature[64];
    if (!sign_with_device_key(msg, msgLen, signature)) {
        signer_reject(500, "sign failed");
        return;
    }

    String resp = String("{\"signature\":\"") + to_hex(signature, 64) + "\",";
    resp += "\"deviceId\":\"" + device_id_from_pubkey(g_publicKey) + "\"}";
    g_signerServer.send(200, SIGNER_JSON, resp);
    Serial.printf("[SIGNER] signed %u bytes for %s\n",
                  (unsigned)msgLen,
                  g_signerServer.client().remoteIP().toString().c_str());
}

static void signer_server_start() {
    g_signerServer.on("/api/device/info", HTTP_GET, handle_device_info);
    g_signerServer.on("/api/device/sign", HTTP_POST, handle_device_sign);
    g_signerServer.begin();
    Serial.printf("[SIGNER] HTTP signer on port %d (LAN-only: %d)\n",
                  (int)ENRG_SIGNER_PORT, (int)ENRG_SIGNER_LAN_ONLY);
}


//  SETUP / LOOP
// ════════════════════════════════════════════════════════════════

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n[BOOT] ENRG Proof Sender v3 (secure)");

    // H-3: key generation on first boot / loading from NVS/ATECC608.
    // Storage priority (ADR-0001): NXP SE050 (hardware Ed25519) →
    // ATECC608A (seed-vault) → NVS.
#if ENRG_USE_SE050
    if (identity_init_se050(g_publicKey)) {
        Serial.println("[KEY] storage: NXP SE050 (hardware Ed25519 signing)");
        g_key_in_secure_element = true;
        // The private key never leaves the SE050 — no seed in RAM needed.
        memset(g_privateKey, 0, sizeof(g_privateKey));
    } else {
        Serial.println("[SE050] chip unavailable — falling back to ATECC/NVS");
        if (!identity_init_v3(g_privateKey, g_publicKey)) {
            Serial.println("[FATAL] key init failed");
#if ENRG_ENABLE_HW_ANTI_ROLLBACK
            ota_mark_app_invalid(); // A/B rollback to the previous image
#else
            while (true) { delay(1000); }
#endif
        }
    }
#else
    if (!identity_init_v3(g_privateKey, g_publicKey)) {
        Serial.println("[FATAL] key init failed");
#if ENRG_ENABLE_HW_ANTI_ROLLBACK
        ota_mark_app_invalid(); // A/B rollback to the previous image
#else
        while (true) { delay(1000); }
#endif
    }
#endif
    if (g_key_in_secure_element) {
        Serial.println("[KEY] storage: Secure Element (ATECC608A / SE050)");
    } else {
        Serial.println("[KEY] storage: NVS (not a Secure Element) — see ENRG_USE_ATECC608");
    }
    Serial.printf("[KEY] device_id = %s\n", device_id_from_pubkey(g_publicKey).c_str());

#if ENRG_USE_PZEM
    g_pzem_ok = true;
#endif

    // ADR-0008: LittleFS — the staging area for the OTA image.
    if (!LittleFS.begin()) {
        Serial.println("[OTA] WARN: LittleFS not mounted — OTA unavailable");
    }

    // Plug & Play: NVS credentials → 30s connect → otherwise Captive Portal.
    if (setup_wifi()) {
        // mDNS responder + local HTTP signer (communication with Axis-connect).
        if (MDNS.begin(mdns_hostname().c_str())) {
            MDNS.addService("axis-connect", "tcp", ENRG_SIGNER_PORT);
            MDNS.addServiceTxt("axis-connect", "tcp", "schema", "axis-energy-v1");
            Serial.printf("[MDNS] hostname: %s.local\n", mdns_hostname().c_str());
        } else {
            Serial.println("[MDNS] WARN: mDNS not started");
        }
    } else {
        Serial.println("[WARN] WiFi not connected — the local signer is unavailable without a network");
    }
    // The HTTP signer always starts (in AP mode it is also available at 192.168.4.1).
    signer_server_start();

    // ADR-0004: fetch and verify the signed manifest at startup.
    // device_id = "0x" + public key hex (as when registering with the oracle).
    String deviceId = device_id_from_pubkey(g_publicKey);
    init_manifest(deviceId);

    // ADR-0008: current firmware version (from NVS or default) — for anti-rollback.
    if (g_prefs.getString("fw_version", "").length() == 0) {
        g_prefs.putString("fw_version", ENRG_FW_VERSION);
    }
    Serial.printf("[OTA] current version: %s\n", g_prefs.getString("fw_version", ENRG_FW_VERSION).c_str());

#if ENRG_ENABLE_HW_ANTI_ROLLBACK
    // ADR-0008: A/B rollback — confirm the current image AFTER a successful
    // startup (key, WiFi, manifest, version) and burn the monotonic secure_version.
    ota_mark_boot_ok();
    ota_mark_hardware_anti_rollback();
#endif

    // First update check right after startup (do not wait for ENRG_UPDATE_CHECK_MS).
    checkForUpdates();

    ntp_sync();
    g_lastReportMs = millis();
}

void loop() {
    // Onboarding: handle Serial commands (HELP/INFO/SIGN/CLEARWIFI) — non-blocking.
    handle_serial_input();

    // Plug & Play: serve the local HTTP signer.
    g_signerServer.handleClient();

    // ADR-0008: periodic firmware update check.
    static unsigned long g_lastUpdateCheckMs = 0;
    unsigned long nowMs = millis();
    if (nowMs - g_lastUpdateCheckMs >= ENRG_UPDATE_CHECK_MS) {
        g_lastUpdateCheckMs = nowMs;
        checkForUpdates(); // it calls ESP.restart() on a successful install
    }

    // ADR-0004: if the manifest is required but not yet received — periodically
    // retry the request (otherwise the device never leaves the blocked state).
    if (ENRG_MANIFEST_REQUIRED && !g_manifest_valid) {
        static unsigned long lastAttemptMs = 0;
        unsigned long nowMs = millis();
        if (nowMs - lastAttemptMs >= ENRG_MANIFEST_RETRY_MS) {
            lastAttemptMs = nowMs;
            String deviceId = device_id_from_pubkey(g_publicKey);
            if (!load_manifest_from_nvs(deviceId)) {
                String body = fetch_manifest_body(deviceId);
                if (body.length() > 0 && apply_manifest(body, deviceId)) {
                    g_prefs.putString("manifest", body);
                }
            }
        }
    }

    unsigned long now = millis();
    if (now - g_lastReportMs >= ENRG_REPORT_INTERVAL_MS) {
        g_lastReportMs = now;
        send_proof(g_privateKey, g_publicKey);
    }
    delay(10);
}

/**
 * Download the image into LittleFS (/fw_update.bin) with parallel SHA-256
 * computation. Returns true if the size and hash match the metadata.
 */
bool download_firmware(const String &url, long expectedSize, const String &expectedHashHex) {
    // P0-3 (ADR-0008): downloading a firmware image over plain HTTP is forbidden
    // (except the explicit dev mode ENRG_ALLOW_HTTP=1).
    if (!transport_allowed(url)) {
        Serial.println("[OTA] image download blocked: non-TLS transport");
        return false;
    }

    // Transport by URL scheme: https:// → TLS (WiFiClientSecure + CA verification),
    // http:// → plain TCP (local dev network, port 3000).
    WiFiClientSecure secureClient;
    WiFiClient plainClient;
    WiFiClient *client;
    if (url.startsWith("https://")) {
        secureClient.setCACert(ENRG_CA_CERT);
        client = &secureClient;
    } else {
        client = &plainClient;
    }

    HTTPClient http;
    if (!http.begin(*client, url)) { Serial.println("[OTA] GET begin failed"); return false; }
    int code = http.GET();
    if (code != 200) {
        Serial.printf("[OTA] GET %s -> %d\n", url.c_str(), code);
        http.end();
        return false;
    }
    int len = http.getSize();
    if (len <= 0 || len > (int)ENRG_MAX_FW_SIZE) {
        Serial.printf("[OTA] bad size: %d\n", len);
        http.end();
        return false;
    }

    LittleFS.remove("/fw_update.bin");
    File out = LittleFS.open("/fw_update.bin", "w");
    if (!out) { http.end(); return false; }

    WiFiClient *stream = http.getStreamPtr();
    SHA256 sha;
    sha.reset();
    uint8_t buf[512];
    size_t total = 0;
    while (http.connected() && total < (size_t)len) {
        size_t n = stream->readBytes(buf, sizeof(buf));
        if (n == 0) break;
        sha.update(buf, n);
        out.write(buf, n);
        total += n;
    }
    out.close();
    http.end();

    if (total != (size_t)len) {
        Serial.printf("[OTA] size mismatch: %u != %d\n", total, len);
        LittleFS.remove("/fw_update.bin");
        return false;
    }

    uint8_t digest[32];
    sha.finalize(digest, sizeof(digest));
    char hex[65];
    for (int i = 0; i < 32; i++) snprintf(hex + i * 2, 3, "%02x", digest[i]);
    hex[64] = 0;

    if (String(hex) != expectedHashHex) {
        Serial.printf("[OTA] SHA-256 mismatch: got %s\n", hex);
        LittleFS.remove("/fw_update.bin");
        return false;
    }
    Serial.printf("[OTA] downloaded %u bytes, SHA-256 OK\n", total);
    return true;
}



/**
 * Apply the image via ESP32 OTA (Update). The file has already been verified
 * (signature + SHA-256). After a successful install the caller performs ESP.restart().
 */
bool apply_firmware_update(const char *path) {
    File f = LittleFS.open(path, "r");
    if (!f) { Serial.println("[OTA] staging file missing"); return false; }
    if (!Update.begin(f.size())) {
        Update.printError(Serial);
        f.close();
        return false;
    }
    size_t written = Update.writeStream(f);
    if (written != f.size()) {
        Update.printError(Serial);
        f.close();
        return false;
    }
    if (!Update.end()) {
        Update.printError(Serial);
        f.close();
        return false;
    }
    f.close();
    LittleFS.remove(path);
    Serial.println("[OTA] Update.end() OK — image installed, rebooting...");
    return true;
}

/**
 * Full update-check cycle (called periodically):
 *   1. GET {ENRG_FIRMWARE_URL_BASE}/latest → metadata (version, hash, size, signature).
 *   2. Anti-rollback: the version must be strictly higher than the current one (from NVS).
 *   3. Verify the metadata signature with the founder key.
 *   4. Download the image + verify SHA-256.
 *   5. Apply (Update) + write the new version to NVS + reboot.
 */
bool checkForUpdates() {
    String url = String(ENRG_FIRMWARE_URL_BASE) + "/latest";
    String body = http_get(url);
    if (body.length() == 0) { Serial.println("[OTA] oracle did not respond"); return false; }

    DynamicJsonDocument doc(1024);
    if (deserializeJson(doc, body)) { Serial.println("[OTA] invalid JSON"); return false; }

    const char *v = doc["version"];
    const char *hash = doc["image_hash"];
    long size = doc["image_size"];
    const char *sig = doc["signature"];
    const char *model = doc["model"];
    if (!v || !hash || size <= 0 || !sig) { Serial.println("[OTA] incomplete metadata"); return false; }

    if (model && strlen(model) > 0 && String(model) != String(ENRG_FW_MODEL)) {
        Serial.printf("[OTA] model %s != %s — skip\n", model, ENRG_FW_MODEL);
        return false;
    }

    // Anti-rollback: accept only a strictly newer version.
    String current = g_prefs.getString("fw_version", ENRG_FW_VERSION);
    if (compare_versions(String(v), current) <= 0) {
        Serial.printf("[OTA] version %s <= current %s — skip (anti-rollback)\n", v, current.c_str());
        return false;
    }

    // Metadata signature (before downloading) — reject unsigned/foreign images.
    if (!verify_firmware_signature(String(v), String(hash), size, String(sig))) {
        Serial.println("[OTA] invalid signature — image rejected");
        return false;
    }

    // Download + SHA-256 verification.
    String imgUrl = String(ENRG_FIRMWARE_URL_BASE) + "/latest/image";
    if (!download_firmware(imgUrl, size, String(hash))) {
        Serial.println("[OTA] download/hash mismatch — image rejected");
        return false;
    }

    // Apply.
    if (!apply_firmware_update("/fw_update.bin")) {
        Serial.println("[OTA] install failed");
        return false;
    }

    g_prefs.putString("fw_version", String(v)); // new version (anti-rollback after reboot)
    Serial.printf("[OTA] update to %s applied, rebooting...\n", v);
    ESP.restart();
    return true;
}


#endif
