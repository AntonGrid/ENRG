'use strict';

/**
 * ENRG Policy Engine — a standalone policy module (ADR-0003).
 *
 * The Axis spec (ADR-0003) requires separating the Verifier (cryptography and
 * data transport) from the Policy Engine (admissibility decisions for Proofs, limits,
 * quarantine, etc.). This module implements the Policy Engine for the off-chain
 * oracle: ALL incoming data checks (format / range / freshness / nonce /
 * signature) were moved from server.js here.
 *
 * Contract:
 *   - each check is a separate pure function `validateXxx(...)`;
 *   - the result is `{ ok: true, ...data }` or `{ ok: false, status, error }`,
 *     where `status` is the HTTP code and `error` the error string (backward
 *     compatible with the previous server.js responses);
 *   - `validateProof(proof, ctx)` and `validateRegister(...)` — aggregates for
 *     the `/api/v1/proof/submit` and `/api/v1/device/register` routes.
 *
 * Limit configuration is loaded at startup:
 *   priority: environment variables > policy-config.json > defaults.
 *   See policy-config.json and the "Policy configuration" section in oracle/README.md.
 */

const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default;
const { Keypair, PublicKey } = require('@solana/web3.js');

// ════════════════════════════════════════════════════════════════
//  POLICY CONFIGURATION (ADR-0003: limits are parameters, not hardcoded)
// ════════════════════════════════════════════════════════════════

/**
 * Default values. Synced with on-chain:
 *   - constants.rs::MAX_CLOCK_SKEW = 300
 *   - security/validation.rs::MAX_PROOF_AGE = 900
 */
const DEFAULT_CONFIG = {
    // Energy limit per report (Wh) — inflation protection (CR-2).
    maxEnergyPerReportWh: 1_000_000_000,
    // The timestamp may not be more than this many seconds in the future (M-3).
    maxTimestampSkewSec: 300,
    // The proof may not be older than this many seconds (M-3).
    maxProofAgeSec: 900,
    // Global rate limit: requests per minute per IP (M-6).
    rateLimitPerMinute: 100,
    // Public oracle URL that goes into the signed Device Manifest
    // (ADR-0004). The device sends proofs exactly to this address.
    oracleUrl: 'http://localhost:3000',
    // Default device rated power (W) for the Device Manifest,
    // when the device has no explicit value (ADR-0004).
    defaultRatedPowerW: 10_000,
    // Max firmware image size for OTA (bytes) — protection against DoS
    // and OTA partition overflow (ADR-0008).
    maxFirmwareSizeBytes: 2_000_000,
};

/** Mapping of env vars → config keys (env takes priority). */
const CONFIG_ENV_KEYS = {
    MAX_ENERGY_PER_REPORT_WH: 'maxEnergyPerReportWh',
    MAX_TIMESTAMP_SKEW_SEC: 'maxTimestampSkewSec',
    MAX_PROOF_AGE_SEC: 'maxProofAgeSec',
    RATE_LIMIT_PER_MINUTE: 'rateLimitPerMinute',
    ORACLE_URL: 'oracleUrl',
    DEFAULT_RATED_POWER_W: 'defaultRatedPowerW',
    MAX_FIRMWARE_SIZE_BYTES: 'maxFirmwareSizeBytes',
};

/** Current (active) configuration. Mutated via setConfig/reloadConfig. */
let config = { ...DEFAULT_CONFIG };

function _isPositiveNumber(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function _isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Coerce a value to the valid type for a config key.
 * Numeric keys accept a number or numeric string (> 0); string keys —
 * a non-empty string. Returns the value or undefined if invalid.
 */
function _coerceValue(key, v) {
    if (typeof DEFAULT_CONFIG[key] === 'string') {
        return _isNonEmptyString(v) ? v.trim() : undefined;
    }
    const num = typeof v === 'number' ? v : Number(v);
    return _isPositiveNumber(num) ? num : undefined;
}

/**
 * Load configuration: defaults → policy-config.json → environment variables.
 * Returns a new config object and stores it in `config`.
 *
 * @param {object} [opts]
 * @param {string} [opts.configPath] path to the JSON file (default POLICY_CONFIG_PATH or ./policy-config.json)
 * @returns {object} the active configuration
 */
function loadConfig(opts = {}) {
    const cfg = { ...DEFAULT_CONFIG };

    const configPath =
        opts.configPath ||
        process.env.POLICY_CONFIG_PATH ||
        path.join(__dirname, 'policy-config.json');
    try {
        if (fs.existsSync(configPath)) {
            const fileCfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            for (const key of Object.keys(DEFAULT_CONFIG)) {
                const coerced = _coerceValue(key, fileCfg[key]);
                if (coerced !== undefined) cfg[key] = coerced;
            }
        }
    } catch (e) {
        console.warn('[policy] Cannot load policy-config.json:', e && e.message);
    }

    for (const envKey of Object.keys(CONFIG_ENV_KEYS)) {
        const raw = process.env[envKey];
        if (raw !== undefined) {
            const coerced = _coerceValue(CONFIG_ENV_KEYS[envKey], raw);
            if (coerced !== undefined) cfg[CONFIG_ENV_KEYS[envKey]] = coerced;
        }
    }

    // Mutate the object in place so the external `module.exports.config` reference
    // always reflects the live configuration (important for tests/hot reload).
    for (const key of Object.keys(DEFAULT_CONFIG)) {
        config[key] = cfg[key];
    }
    return config;
}

/**
 * Reload the configuration from policy-config.json + env.
 * Useful when the config file changes without a restart, and in tests.
 */
function reloadConfig() {
    return loadConfig();
}

/**
 * Set/override configuration values at runtime (mainly for tests).
 * @param {object} overrides partial overrides of DEFAULT_CONFIG keys
 */
function setConfig(overrides = {}) {
    for (const key of Object.keys(DEFAULT_CONFIG)) {
        const coerced = _coerceValue(key, overrides[key]);
        if (coerced !== undefined) config[key] = coerced;
    }
    return config;
}

/**
 * Ready-made options object for express-rate-limit (RATE_LIMIT_PER_MINUTE).
 * The server just plugs it into rateLimit(policy.rateLimitOptions()).
 */
function rateLimitOptions() {
    return {
        windowMs: 60 * 1000,
        max: config.rateLimitPerMinute,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'too many requests, please retry later' },
    };
}

// ════════════════════════════════════════════════════════════════
//  HELPERS (canonical signing messages, on-chain format)
// ════════════════════════════════════════════════════════════════

/** little-endian u64 (matches device_message_to_sign in state/oracle.rs). */
function le8(value) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(Math.trunc(Number(value))), 0);
    return b;
}

/** OracleReport::device_message_to_sign(): device_id || nonce || device_timestamp || energy_wh */
function buildDeviceMessage(deviceIdPubkey, nonce, timestamp, energyWh) {
    return Buffer.concat([deviceIdPubkey.toBuffer(), le8(nonce), le8(timestamp), le8(energyWh)]);
}

/** OracleReport::oracle_message_to_sign(): device_id || nonce || device_timestamp || verified_at || energy_wh */
function buildOracleMessage(deviceIdPubkey, nonce, timestamp, verifiedAt, energyWh) {
    return Buffer.concat([deviceIdPubkey.toBuffer(), le8(nonce), le8(timestamp), le8(verifiedAt), le8(energyWh)]);
}

/** Prefix of the canonical key-rotation message (matches security/lifecycle.rs). */
const DEVICE_ROTATE_MESSAGE_PREFIX = Buffer.from('enrg:device:rotate', 'utf8');

/**
 * Key-rotation message (ADR-0007) signed by the device's NEW key
 * (a mirror of security/lifecycle.rs::device_rotate_message):
 *   b"enrg:device:rotate" || new_device_id(32) || owner(32)
 *                        || rotate_nonce(8 LE) || rotate_timestamp(8 LE)
 */
function buildDeviceRotateMessage(newDeviceIdPubkey, ownerPubkey, rotateNonce, rotateTimestamp) {
    return Buffer.concat([
        DEVICE_ROTATE_MESSAGE_PREFIX,
        newDeviceIdPubkey.toBuffer(),
        ownerPubkey.toBuffer(),
        le8(rotateNonce),
        le8(rotateTimestamp),
    ]);
}

/**
 * Parse device_id as a Solana Pubkey (32 bytes):
 *   - "0x" + 64 hex chars, or
 *   - a base58 string that decodes to exactly 32 bytes.
 * Returns a PublicKey or null.
 */
function parseDevicePubkey(device_id) {
    if (typeof device_id !== 'string' || !device_id) return null;
    try {
        if (/^0x[0-9a-fA-F]{64}$/.test(device_id)) return new PublicKey(Buffer.from(device_id.slice(2), 'hex'));
        const b = bs58.decode(device_id);
        if (b.length !== 32) return null;
        return new PublicKey(b);
    } catch (e) {
        return null;
    }
}



// ════════════════════════════════════════════════════════════════
//  DEVICE MANIFEST (ADR-0004) — canonical message and signatures
// ════════════════════════════════════════════════════════════════

/**
 * Canonical string for signing the Device Manifest (ADR-0004).
 *
 * Format (must match byte-for-byte in the oracle and the ESP32 firmware):
 *   `device_id|rated_power|oracle_url|public_key|timestamp`
 *   `|trust_level|heartbeat_interval|proof_threshold|policy_version|verifier_endpoint`
 *
 * ADR-0004 fields (trust_level, heartbeat_interval, proof_threshold,
 * policy_version, verifier_endpoint) were added on 2026-08-18 (audit, P1-12).
 *
 * Constraint: fields MUST NOT contain the '|' character. The oracle guarantees this
 * for oracle_url (validated in the endpoint); the other fields are base58/hex/
 * base64/number, where '|' is impossible.
 *
 * @param {object} m { device_id, rated_power, oracle_url, public_key, timestamp,
 *                     trust_level, heartbeat_interval, proof_threshold,
 *                     policy_version, verifier_endpoint }
 * @returns {string}
 */
function buildManifestMessage(m) {
    return `${m.device_id}|${m.rated_power}|${m.oracle_url}|${m.public_key}|${m.timestamp}|${m.trust_level}|${m.heartbeat_interval}|${m.proof_threshold}|${m.policy_version}|${m.verifier_endpoint}`;
}

/**
 * Sign the Device Manifest with the oracle key (FOUNDER_KEY, Ed25519).
 *
 * @param {object} manifest manifest fields (see buildManifestMessage)
 * @param {Uint8Array} secretKey Ed25519 secret key (64 bytes)
 * @returns {string} base64 signature (64 bytes)
 */
function signManifest(manifest, secretKey) {
    const msg = Buffer.from(buildManifestMessage(manifest), 'utf8');
    const sig = nacl.sign.detached(new Uint8Array(msg), secretKey);
    return Buffer.from(sig).toString('base64');
}

/**
 * Verify the Device Manifest signature with the oracle public key (Ed25519).
 * Mirrors the ESP32 firmware logic (verifyManifest in esp32_proof_sender_v3.ino).
 *
 * @param {object} manifest manifest fields (see buildManifestMessage)
 * @param {string} signature base64 signature
 * @param {Uint8Array|string} publicKey oracle public key (32 bytes) or base64
 * @returns {{ok: true} | {ok: false, error: string}}
 */
function verifyManifest(manifest, signature, publicKey) {
    if (!manifest || typeof manifest !== 'object') {
        return { ok: false, error: 'manifest_missing' };
    }
    const required = ['device_id', 'rated_power', 'oracle_url', 'public_key', 'timestamp', 'trust_level', 'heartbeat_interval', 'proof_threshold', 'policy_version', 'verifier_endpoint'];
    for (const f of required) {
        if (manifest[f] === undefined || manifest[f] === null || manifest[f] === '') {
            return { ok: false, error: `manifest_field_missing:${f}` };
        }
    }
    if (typeof signature !== 'string') {
        return { ok: false, error: 'signature_missing' };
    }
    let sigBytes;
    let pubBytes;
    try {
        sigBytes = Buffer.from(signature, 'base64');
        pubBytes = typeof publicKey === 'string' ? Buffer.from(publicKey, 'base64') : Buffer.from(publicKey);
        if (sigBytes.length !== 64 || pubBytes.length !== 32) {
            return { ok: false, error: 'bad_signature_or_key_length' };
        }
    } catch (e) {
        return { ok: false, error: 'bad_encoding' };
    }
    const msg = Buffer.from(buildManifestMessage(manifest), 'utf8');
    const valid = nacl.sign.detached.verify(
        new Uint8Array(msg),
        new Uint8Array(sigBytes),
        new Uint8Array(pubBytes)
    );
    if (!valid) return { ok: false, error: 'signature_invalid' };
    return { ok: true };
}

// ════════════════════════════════════════════════════════════════
//  FIRMWARE (ADR-0008) — canonical message and signatures for the OTA image
// ════════════════════════════════════════════════════════════════

/**
 * Canonical string for signing firmware metadata (ADR-0008).
 *   `version|image_hash|image_size`
 * Must match byte-for-byte in the oracle and the ESP32 firmware
 * (verify_firmware_signature in esp32_proof_sender_v3.ino).
 * Fields must not contain '|' (validated oracle-side).
 */
function buildFirmwareMessage(f) {
    return `${f.version}|${f.image_hash}|${f.image_size}`;
}

/**
 * Sign firmware metadata with the oracle/founder key (Ed25519).
 * The signature covers version + hash + size; the image's authenticity
 * is ensured by the device checking SHA-256(image) == image_hash.
 */
function signFirmware(firmware, secretKey) {
    const msg = Buffer.from(buildFirmwareMessage(firmware), 'utf8');
    const sig = nacl.sign.detached(new Uint8Array(msg), secretKey);
    return Buffer.from(sig).toString('base64');
}

/**
 * Verify the firmware metadata signature (mirrors the ESP32 firmware).
 *
 * @param {object} f { version, image_hash, image_size }
 * @param {string} signature base64 signature
 * @param {Uint8Array|string} publicKey oracle public key (32 bytes) or base64
 * @returns {{ok: true} | {ok: false, error: string}}
 */
function verifyFirmware(f, signature, publicKey) {
    if (!f || typeof f !== 'object') return { ok: false, error: 'firmware_missing' };
    const required = ['version', 'image_hash', 'image_size'];
    for (const k of required) {
        if (f[k] === undefined || f[k] === null || f[k] === '') {
            return { ok: false, error: `firmware_field_missing:${k}` };
        }
    }
    if (typeof f.image_hash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(f.image_hash)) {
        return { ok: false, error: 'invalid_image_hash' };
    }
    if (!Number.isInteger(Number(f.image_size)) || Number(f.image_size) <= 0) {
        return { ok: false, error: 'invalid_image_size' };
    }
    if (typeof signature !== 'string') return { ok: false, error: 'signature_missing' };
    let sigBytes;
    let pubBytes;
    try {
        sigBytes = Buffer.from(signature, 'base64');
        pubBytes = typeof publicKey === 'string' ? Buffer.from(publicKey, 'base64') : Buffer.from(publicKey);
        if (sigBytes.length !== 64 || pubBytes.length !== 32) {
            return { ok: false, error: 'bad_signature_or_key_length' };
        }
    } catch (e) {
        return { ok: false, error: 'bad_encoding' };
    }
    const msg = Buffer.from(buildFirmwareMessage(f), 'utf8');
    const valid = nacl.sign.detached.verify(
        new Uint8Array(msg),
        new Uint8Array(sigBytes),
        new Uint8Array(pubBytes)
    );
    if (!valid) return { ok: false, error: 'signature_invalid' };
    return { ok: true };
}


/** Short error-result factory. */
function fail(status, error) {
    return { ok: false, status, error };
}

/**
 * Load the ORACLE keypair for signing the OracleReport in mint (ADR-0003).
 *
 * Multi-owner mint: any oracle in the OracleRegistry may sign
 * reports WITHOUT being the founder. The oracle key is set separately from the founder:
 *   - ORACLE_KEY (env, JSON array of 64 bytes);
 *   - ORACLE_KEY_PATH (file) — recommended (no secret in /proc/<pid>/environ).
 * The oracle public key must be added to the on-chain OracleRegistry
 * (addOracle), otherwise the mint is rejected (UntrustedOracle).
 *
 * @returns {Keypair|null} the oracle keypair or null (minting unavailable)
 */
function getOracleKeypair() {
    if (process.env.ORACLE_KEY) {
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.ORACLE_KEY)));
    }
    if (process.env.ORACLE_KEY_PATH) {
        const raw = fs.readFileSync(process.env.ORACLE_KEY_PATH, 'utf8');
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    }
    return null;
}


// ════════════════════════════════════════════════════════════════
//  VALIDATIONS (one function per check)
// ════════════════════════════════════════════════════════════════

/**
 * device_id format check.
 * Allowed: base58 (alphabet without 0/O/I/l) or hex with a "0x" prefix (even length).
 * Rejects special chars, spaces, XSS payloads, and strings > 128 chars (M-5).
 *
 * @param {*} device_id value from the request
 * @returns {{ok: true, deviceIdPubkey: (PublicKey|null)} | {ok: false, status: number, error: string}}
 */
function validateDeviceId(device_id) {
    if (typeof device_id !== 'string' || device_id.length === 0 || device_id.length > 128) {
        return fail(400, 'invalid device_id format (base58 or hex only)');
    }
    const isBase58 = /^[1-9A-HJ-NP-Za-km-z]+$/.test(device_id);
    const isHex = /^0x[0-9a-fA-F]+$/.test(device_id) && device_id.length % 2 === 0;
    if (!isBase58 && !isHex) {
        return fail(400, 'invalid device_id format (base58 or hex only)');
    }
    return { ok: true, deviceIdPubkey: parseDevicePubkey(device_id) };
}

/**
 * energyWh validation: number/string type, finite value, string with only
 * digits with an optional fraction, positive, ≤ maxEnergyPerReportWh.
 * Rejects NaN/Infinity, null (Number(null)=0), negatives, zero and
 * values above the limit (CR-2).
 *
 * @param {*} energyWh value from the request
 * @returns {{ok: true, energyWhNum: number, energyWhInt: number} | {ok: false, status, error}}
 */
function validateEnergyWh(energyWh) {
    if (typeof energyWh !== 'number' && typeof energyWh !== 'string') {
        return fail(400, 'invalid energyWh (must be a number)');
    }
    const energyWhNum = Number(energyWh);
    if (!Number.isFinite(energyWhNum)) {
        return fail(400, 'invalid energyWh (must be a finite number)');
    }
    if (typeof energyWh === 'string' && !/^\d+(\.\d+)?$/.test(energyWh.trim())) {
        return fail(400, 'invalid energyWh format');
    }
    if (energyWhNum <= 0) {
        return fail(400, 'invalid energyWh (must be positive)');
    }
    if (energyWhNum > config.maxEnergyPerReportWh) {
        return fail(400, `energyWh exceeds maximum allowed per report (${config.maxEnergyPerReportWh} Wh)`);
    }
    return { ok: true, energyWhNum, energyWhInt: Math.round(energyWhNum) };
}

/**
 * timestamp validation: number/string type, finite value, freshness.
 *   - not more than maxTimestampSkewSec in the future (default 300 = 5 min);
 *   - not older than maxProofAgeSec (default 900 = 15 min).
 * Synced with the on-chain verify_timestamp() (M-3).
 *
 * @param {*} timestamp value from the request
 * @param {number} [nowSec] current time in seconds (for tests; default Date.now()/1000)
 * @returns {{ok: true, timestamp: number} | {ok: false, status, error}}
 */
function validateTimestamp(timestamp, nowSec) {
    if (typeof timestamp !== 'number' && typeof timestamp !== 'string') {
        return fail(400, 'invalid timestamp (must be a number)');
    }
    const timestampNum = Number(timestamp);
    if (!Number.isFinite(timestampNum)) {
        return fail(400, 'invalid timestamp (must be a finite number)');
    }
    const now = nowSec !== undefined ? nowSec : Math.floor(Date.now() / 1000);
    if (timestampNum > now + config.maxTimestampSkewSec) {
        return fail(400, 'FutureTimestamp');
    }
    if (now - timestampNum > config.maxProofAgeSec) {
        return fail(400, 'StaleProof');
    }
    return { ok: true, timestamp: timestampNum };
}

/**
 * nonce validation: a positive integer, strictly greater than the last accepted
 * device nonce (replay protection, CR-2). The last nonce is passed
 * as an argument or resolved in validateProof via ctx.getLastNonce.
 *
 * @param {*} nonce value from the request
 * @param {number} [lastNonce] the last accepted nonce (default 0)
 * @returns {{ok: true, nonce: number} | {ok: false, status, error}}
 */
function validateNonce(nonce, lastNonce = 0) {
    if (typeof nonce !== 'number' && typeof nonce !== 'string') {
        return fail(400, 'invalid nonce (must be a positive integer)');
    }
    const nonceNum = Number(nonce);
    if (!Number.isInteger(nonceNum) || nonceNum <= 0) {
        return fail(400, 'invalid nonce (must be a positive integer)');
    }
    if (nonceNum <= lastNonce) {
        return fail(400, 'InvalidNonce');
    }
    return { ok: true, nonce: nonceNum };
}


/**
 * Signature (proof-of-possession) check for a proof.
 *
 * Formats (CR-3):
 *   - 'binary' (on-chain compatible): Ed25519 over
 *       device_id(32) || nonce(le8) || device_timestamp(le8) || energy_wh(le8)
 *     — only this one can be used for on-chain mint;
 *   - 'legacy' (string format): Ed25519 over
 *       `${device_id}|${timestamp}|${energyWh}|${nonce}`
 *     — accepted, but minting is unavailable (accumulation only).
 *
 * Errors are backward compatible: 400 'invalid signature format' on broken base64,
 * 401 'invalid signature' on a wrong length/invalid signature.
 *
 * @param {object} p
 * @param {string} p.device_id
 * @param {PublicKey|null} p.deviceIdPubkey
 * @param {string} p.publicKeyB64 device base64 public key (from the registry)
 * @param {string} p.signature base64 signature
 * @param {*} p.rawNonce / p.rawTimestamp / p.rawEnergyWh — raw values (for the legacy format)
 * @param {number} p.nonce / p.timestamp / p.energyWhInt — validated numeric values (for the binary format)
 * @returns {{ok: true, sigMode: 'binary'|'legacy', sigBytes: Buffer, pubBytes: Buffer, deviceIdPubkey: PublicKey|null} | {ok: false, status, error}}
 */
function validateSignature(p) {
    let sigBytes;
    let pubBytes;
    try {
        if (typeof p.signature !== 'string') throw new Error('bad signature type');
        sigBytes = Buffer.from(p.signature, 'base64');
        pubBytes = Buffer.from(p.publicKeyB64, 'base64');
    } catch (e) {
        return fail(400, 'invalid signature format');
    }
    if (sigBytes.length !== 64 || pubBytes.length !== 32) {
        return fail(401, 'invalid signature');
    }

    let sigMode = null;
    try {
        if (p.deviceIdPubkey) {
            const bmsg = buildDeviceMessage(p.deviceIdPubkey, p.nonce, p.timestamp, p.energyWhInt);
            if (nacl.sign.detached.verify(new Uint8Array(bmsg), new Uint8Array(sigBytes), new Uint8Array(pubBytes))) {
                sigMode = 'binary';
            }
        }
        if (!sigMode) {
            const lmsg = Buffer.from(`${p.device_id}|${p.rawTimestamp}|${p.rawEnergyWh}|${p.rawNonce}`, 'utf8');
            if (nacl.sign.detached.verify(new Uint8Array(lmsg), new Uint8Array(sigBytes), new Uint8Array(pubBytes))) {
                sigMode = 'legacy';
            }
        }
    } catch (e) {
        return fail(400, 'invalid signature');
    }
    if (!sigMode) return fail(401, 'invalid signature');

    return { ok: true, sigMode, sigBytes, pubBytes, deviceIdPubkey: p.deviceIdPubkey };
}


/**
 * Aggregate: full validation of an incoming proof for /api/v1/proof/submit.
 *
 * The check order (and HTTP codes) match the previous server.js:
 *   missing fields(400) → device_id(400) → energyWh(400) → timestamp(400)
 *   → unknown device (400, via ctx.getPublicKey) → nonce(400) → signature(400/401).
 *
 * @param {object} proof the request body { device_id, timestamp, energyWh, nonce, signature, pool_id? }
 * @param {object} [ctx]
 * @param {(device_id: string) => string|null} [ctx.getPublicKey] resolver of the registry base64 public key
 * @param {(device_id: string) => number} [ctx.getLastNonce] resolver of the last accepted nonce
 * @param {number} [ctx.nowSec] current time (sec) for the freshness check; default Date.now()/1000
 * @returns {{ok: true, proof: object, pool_id?: string} | {ok: false, status, error}}
 */
function validateProof(proof, ctx = {}) {
    if (!proof || typeof proof !== 'object') {
        return fail(400, 'missing fields');
    }
    const { device_id, timestamp, energyWh, nonce, signature, pool_id } = proof;
    if (!device_id || timestamp === undefined || energyWh === undefined || nonce === undefined || !signature) {
        return fail(400, 'missing fields');
    }

    const d = validateDeviceId(device_id);
    if (!d.ok) return d;

    const e = validateEnergyWh(energyWh);
    if (!e.ok) return e;

    const t = validateTimestamp(timestamp, ctx.nowSec);
    if (!t.ok) return t;

    // Registry: the device must be known to the oracle (registry state).
    const publicKeyB64 = ctx.getPublicKey ? ctx.getPublicKey(device_id) : ctx.publicKeyB64;
    if (!publicKeyB64) return fail(400, 'unknown device');

    const lastNonce = ctx.getLastNonce ? ctx.getLastNonce(device_id) : ctx.lastNonce || 0;
    const n = validateNonce(nonce, lastNonce);
    if (!n.ok) return n;

    const s = validateSignature({
        device_id,
        deviceIdPubkey: d.deviceIdPubkey,
        publicKeyB64,
        signature,
        rawNonce: nonce,
        rawTimestamp: timestamp,
        rawEnergyWh: energyWh,
        nonce: n.nonce,
        timestamp: t.timestamp,
        energyWhInt: e.energyWhInt,
    });
    if (!s.ok) return s;

    return {
        ok: true,
        proof: {
            device_id,
            device_id_pubkey: s.deviceIdPubkey,
            nonce: n.nonce,
            device_timestamp: t.timestamp,
            energy_wh: e.energyWhInt,
            device_signature: s.sigBytes,
            sig_mode: s.sigMode,
        },
        pool_id,
    };
}

// ════════════════════════════════════════════════════════════════
// P2-1a (audit 2026-08-30): WebCrypto Ed25519 verification.
//
// tweetnacl (pure JS) measures ~15 ms/verify on some hosts (~65 proofs/s
// ceiling). node:crypto WebCrypto uses native Ed25519 (~0.05-0.2 ms).
// validateProofAsync is the drop-in async replacement for the hot path
// /api/v1/proof/submit; the sync validateProof (tweetnacl) stays for
// tests and non-critical callers.
// ════════════════════════════════════════════════════════════════
const { webcrypto } = require('crypto');
const subtle = webcrypto.subtle;

async function verifyEd25519WebCrypto(message, signature, publicKey) {
    try {
        const key = await subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']);
        return await subtle.verify({ name: 'Ed25519' }, key, signature, message);
    } catch (e) {
        return false;
    }
}

/**
 * Async equivalent of validateSignature (WebCrypto). Same contract.
 */
async function validateSignatureAsync(p) {
    let sigBytes;
    let pubBytes;
    try {
        if (typeof p.signature !== 'string') throw new Error('bad signature type');
        sigBytes = Buffer.from(p.signature, 'base64');
        pubBytes = Buffer.from(p.publicKeyB64, 'base64');
    } catch (e) {
        return fail(400, 'invalid signature format');
    }
    if (sigBytes.length !== 64 || pubBytes.length !== 32) {
        return fail(401, 'invalid signature');
    }

    let sigMode = null;
    try {
        if (p.deviceIdPubkey) {
            const bmsg = buildDeviceMessage(p.deviceIdPubkey, p.nonce, p.timestamp, p.energyWhInt);
            if (await verifyEd25519WebCrypto(new Uint8Array(bmsg), new Uint8Array(sigBytes), new Uint8Array(pubBytes))) {
                sigMode = 'binary';
            }
        }
        if (!sigMode) {
            const lmsg = Buffer.from(`${p.device_id}|${p.rawTimestamp}|${p.rawEnergyWh}|${p.rawNonce}`, 'utf8');
            if (await verifyEd25519WebCrypto(new Uint8Array(lmsg), new Uint8Array(sigBytes), new Uint8Array(pubBytes))) {
                sigMode = 'legacy';
            }
        }
    } catch (e) {
        return fail(400, 'invalid signature');
    }
    if (!sigMode) return fail(401, 'invalid signature');

    return { ok: true, sigMode, sigBytes, pubBytes, deviceIdPubkey: p.deviceIdPubkey };
}

/**
 * Async equivalent of validateProof (WebCrypto verification). Same contract,
 * same check order and HTTP codes.
 */
async function validateProofAsync(proof, ctx = {}) {
    if (!proof || typeof proof !== 'object') {
        return fail(400, 'missing fields');
    }
    const { device_id, timestamp, energyWh, nonce, signature, pool_id } = proof;
    if (!device_id || timestamp === undefined || energyWh === undefined || nonce === undefined || !signature) {
        return fail(400, 'missing fields');
    }

    const d = validateDeviceId(device_id);
    if (!d.ok) return d;

    const e = validateEnergyWh(energyWh);
    if (!e.ok) return e;

    const t = validateTimestamp(timestamp, ctx.nowSec);
    if (!t.ok) return t;

    const publicKeyB64 = ctx.getPublicKey ? ctx.getPublicKey(device_id) : ctx.publicKeyB64;
    if (!publicKeyB64) return fail(400, 'unknown device');

    const lastNonce = ctx.getLastNonce ? ctx.getLastNonce(device_id) : ctx.lastNonce || 0;
    const n = validateNonce(nonce, lastNonce);
    if (!n.ok) return n;

    const s = await validateSignatureAsync({
        device_id,
        deviceIdPubkey: d.deviceIdPubkey,
        publicKeyB64,
        signature,
        rawNonce: nonce,
        rawTimestamp: timestamp,
        rawEnergyWh: energyWh,
        nonce: n.nonce,
        timestamp: t.timestamp,
        energyWhInt: e.energyWhInt,
    });
    if (!s.ok) return s;

    return {
        ok: true,
        proof: {
            device_id,
            device_id_pubkey: s.deviceIdPubkey,
            nonce: n.nonce,
            device_timestamp: t.timestamp,
            energy_wh: e.energyWhInt,
            device_signature: s.sigBytes,
            sig_mode: s.sigMode,
        },
        pool_id,
    };
}


/**
 * Aggregate: full device-registration validation for /api/v1/device/register.
 * Errors are backward compatible: 400 for format/lengths, 403 for an invalid
 * proof-of-possession signature.
 *
 * @param {string} device_id
 * @param {string} public_key base64 (32 bytes)
 * @param {string} signature base64 (64 bytes) over the message `${device_id}|${public_key}`
 * @returns {{ok: true, pubBytes: Buffer, sigBytes: Buffer} | {ok: false, status, error}}
 */
function validateRegister(device_id, public_key, signature) {
    const d = validateDeviceId(device_id);
    if (!d.ok) return d;

    let pubBytes;
    try {
        pubBytes = Buffer.from(public_key, 'base64');
        if (pubBytes.length !== 32) {
            return fail(400, 'invalid public key (must be 32 bytes base64)');
        }
    } catch (e) {
        return fail(400, 'invalid public key format');
    }

    let sigBytes;
    try {
        sigBytes = Buffer.from(signature, 'base64');
        if (sigBytes.length !== 64) {
            return fail(400, 'invalid signature (must be 64 bytes base64)');
        }
    } catch (e) {
        return fail(400, 'invalid signature format');
    }

    // CR-1: proof-of-possession over the deterministic challenge.
    const msgBytes = Buffer.from(`${device_id}|${public_key}`, 'utf8');
    const verified = nacl.sign.detached.verify(
        new Uint8Array(msgBytes),
        new Uint8Array(sigBytes),
        new Uint8Array(pubBytes)
    );
    if (!verified) {
        return fail(403, 'invalid signature: proof of device key ownership required');
    }
    return { ok: true, pubBytes, sigBytes };
}

/**
 * P2-1a: WebCrypto equivalent of validateRegister (proof-of-possession).
 * Same contract and HTTP codes; used by /api/v1/device/register.
 */
async function validateRegisterAsync(device_id, public_key, signature) {
    const d = validateDeviceId(device_id);
    if (!d.ok) return d;

    let pubBytes;
    try {
        pubBytes = Buffer.from(public_key, 'base64');
        if (pubBytes.length !== 32) {
            return fail(400, 'invalid public key (must be 32 bytes base64)');
        }
    } catch (e) {
        return fail(400, 'invalid public key format');
    }

    let sigBytes;
    try {
        sigBytes = Buffer.from(signature, 'base64');
        if (sigBytes.length !== 64) {
            return fail(400, 'invalid signature (must be 64 bytes base64)');
        }
    } catch (e) {
        return fail(400, 'invalid signature format');
    }

    const msgBytes = Buffer.from(`${device_id}|${public_key}`, 'utf8');
    const verified = await verifyEd25519WebCrypto(
        new Uint8Array(msgBytes),
        new Uint8Array(sigBytes),
        new Uint8Array(pubBytes),
    );
    if (!verified) {
        return fail(403, 'invalid signature: proof of device key ownership required');
    }
    return { ok: true, pubBytes, sigBytes };
}

// Load the configuration when the module is imported (oracle startup).
loadConfig();

module.exports = {
    // config
    config,
    DEFAULT_CONFIG,
    loadConfig,
    reloadConfig,
    setConfig,
    rateLimitOptions,
    // helpers
    le8,
    buildDeviceMessage,
    buildOracleMessage,
    buildDeviceRotateMessage,
    parseDevicePubkey,
    // manifest (ADR-0004)
    buildManifestMessage,
    signManifest,
    verifyManifest,
    // firmware (ADR-0008)
    buildFirmwareMessage,
    signFirmware,
    verifyFirmware,
    // oracle key (ADR-0003, multi-oracle mint)
    getOracleKeypair,
    // validators
    validateDeviceId,
    validateEnergyWh,
    validateTimestamp,
    validateNonce,
    validateSignature,
    // aggregates
    validateProof,
    validateProofAsync,
    validateRegister,
    validateRegisterAsync,
    // webcrypto (P2-1a)
    verifyEd25519WebCrypto,
    validateSignatureAsync,
};

