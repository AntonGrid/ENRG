'use strict';
/**
 * ENRG JavaScript client (reference SDK).
 *
 * Two things live here:
 *   1. the **wire format** — the exact bytes a device signs and an oracle hashes
 *      (little-endian u64s, documented in `sdk/README.md` and pinned by
 *      `sdk/vectors/wire_format.json`);
 *   2. a thin **HTTP client** for the live oracle API (`server.js`).
 *
 * The wire-format functions are deliberately standalone (no dependency on
 * `policy.js`), so this file can be copied into an application or published as a
 * package. `tests/sdk.test.js` asserts byte-for-byte equality with `policy.js`,
 * which the conformance suite validates against the Rust engine — so the copy
 * cannot drift silently.
 *
 * Node 18+ (global fetch). No build step, CommonJS, mirroring the style of
 * `policy.js` / `server.js` in this repository.
 */

const crypto = require('crypto');
const nacl = require('tweetnacl');

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Decode base58 (device ids and keys arrive as base58 in the API). */
function base58Decode(str) {
    let num = 0n;
    for (const ch of str) {
        const idx = B58_ALPHABET.indexOf(ch);
        if (idx === -1) throw new Error(`invalid base58 character: ${ch}`);
        num = num * 58n + BigInt(idx);
    }
    let hex = num.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    const leadingZeros = str.match(/^1*/)[0].length;
    return Buffer.concat([Buffer.alloc(leadingZeros), Buffer.from(hex, 'hex')]);
}

/** Encode base58 (for producing device ids from raw keys). */
function base58Encode(buf) {
    let num = 0n;
    for (const byte of buf) num = num * 256n + BigInt(byte);
    let out = '';
    while (num > 0n) {
        out = B58_ALPHABET[Number(num % 58n)] + out;
        num /= 58n;
    }
    for (const byte of buf) {
        if (byte !== 0) break;
        out = '1' + out;
    }
    return out;
}

/**
 * Little-endian u64, exactly as the on-chain program reads it
 * (`OracleReport::device_message_to_sign`).
 *
 * ⚠️ Values above `Number.MAX_SAFE_INTEGER` (2^53-1) cannot be represented
 * exactly as a JS number. Pass a BigInt for such values; a plain number that is
 * too large throws instead of silently truncating.
 */
function le8(value) {
    const big = typeof value === 'bigint' ? value : BigInt(value);
    if (big < 0n || big > 0xffffffffffffffffn) {
        throw new RangeError(`u64 out of range: ${value}`);
    }
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
        throw new RangeError(
            `value ${value} exceeds Number.MAX_SAFE_INTEGER — pass a BigInt to keep the bytes exact`
        );
    }
    const out = Buffer.alloc(8);
    out.writeBigUInt64LE(big, 0);
    return out;
}

/** device_id(32) ‖ nonce(8 LE) ‖ device_timestamp(8 LE) ‖ energy_wh(8 LE) */
function deviceMessageToSign(deviceIdBytes, nonce, deviceTimestamp, energyWh) {
    return Buffer.concat([to32Bytes(deviceIdBytes), le8(nonce), le8(deviceTimestamp), le8(energyWh)]);
}

/** device_id(32) ‖ nonce(8 LE) ‖ device_timestamp(8 LE) ‖ verified_at(8 LE) ‖ energy_wh(8 LE) */
function oracleMessageToSign(deviceIdBytes, nonce, deviceTimestamp, verifiedAt, energyWh) {
    return Buffer.concat([
        to32Bytes(deviceIdBytes),
        le8(nonce),
        le8(deviceTimestamp),
        le8(verifiedAt),
        le8(energyWh),
    ]);
}

/** SHA-256(oracle_message_to_sign) — the hash oracles vote on. */
function proofHash(oracleMessage) {
    return crypto.createHash('sha256').update(oracleMessage).digest();
}

/** b"enrg:oracle:attest" ‖ device_id(32) ‖ nonce(8 LE) ‖ proof_hash(32) */
function attestMessage(deviceIdBytes, nonce, hash) {
    if (!Buffer.isBuffer(hash) || hash.length !== 32) {
        throw new Error('proof_hash must be a 32-byte buffer');
    }
    return Buffer.concat([
        Buffer.from('enrg:oracle:attest', 'utf8'),
        to32Bytes(deviceIdBytes),
        le8(nonce),
        hash,
    ]);
}

function to32Bytes(value) {
    const buf = Buffer.isBuffer(value) ? value : base58Decode(String(value));
    if (buf.length !== 32) throw new Error(`expected 32 bytes, got ${buf.length}`);
    return buf;
}

/**
 * Build a device-signed proof payload ready for `POST /api/v1/proof/submit`.
 *
 * @param {object} params
 * @param {Uint8Array} params.secretKey 32-byte Ed25519 secret key (or 64-byte keypair secret)
 * @param {number|bigint} params.nonce
 * @param {number|bigint} params.deviceTimestamp
 * @param {number|bigint} params.energyWh
 * @returns {object} JSON body: device_id, nonce, device_timestamp, energy_wh, device_signature
 */
function buildDeviceProof({ secretKey, nonce, deviceTimestamp, energyWh }) {
    const keyPair =
        secretKey.length === 64
            ? nacl.sign.keyPair.fromSecretKey(secretKey)
            : nacl.sign.keyPair.fromSeed(secretKey.slice(0, 32));
    const deviceIdBytes = Buffer.from(keyPair.publicKey);
    const message = deviceMessageToSign(deviceIdBytes, nonce, deviceTimestamp, energyWh);
    const signature = nacl.sign.detached(message, keyPair.secretKey);
    return {
        device_id: base58Encode(deviceIdBytes),
        nonce: Number(nonce),
        device_timestamp: Number(deviceTimestamp),
        energy_wh: Number(energyWh),
        device_signature: Array.from(signature),
    };
}

/** Verify a device signature the way the oracle and the chain do. */
function verifyDeviceProof(proof, publicKeyBytes) {
    const deviceIdBytes = publicKeyBytes
        ? to32Bytes(publicKeyBytes)
        : base58Decode(proof.device_id);
    const message = deviceMessageToSign(
        deviceIdBytes,
        proof.nonce,
        proof.device_timestamp,
        proof.energy_wh
    );
    const signature = Buffer.from(proof.device_signature);
    return nacl.sign.detached.verify(message, signature, deviceIdBytes);
}

/** Error thrown for a non-2xx API response, carrying the status and the body. */
class EnrgApiError extends Error {
    constructor(status, body, path) {
        const detail = body && (body.error || body.reason);
        super(`${path} → HTTP ${status}${detail ? `: ${detail}` : ''}`);
        this.name = 'EnrgApiError';
        this.status = status;
        this.body = body;
    }
}

/**
 * Client for the live oracle API (`server.js`).
 *
 * @param {object} [options]
 * @param {string} [options.baseUrl] default https://enrg-oracle.onrender.com
 *   (free instance: the first request after idle can be 503 while it wakes —
 *   `retries` handles that)
 * @param {number} [options.timeoutMs] default 20000
 * @param {number} [options.retries] default 2 (only for 503 / network errors)
 */
class EnrgClient {
    constructor({ baseUrl = 'https://enrg-oracle.onrender.com', timeoutMs = 20000, retries = 2 } = {}) {
        this.baseUrl = String(baseUrl).replace(/\/$/, '');
        this.timeoutMs = timeoutMs;
        this.retries = retries;
    }

    async request(path, { method = 'GET', body, headers = {} } = {}) {
        let lastError;
        for (let attempt = 0; attempt <= this.retries; attempt += 1) {
            try {
                const res = await fetch(`${this.baseUrl}${path}`, {
                    method,
                    headers: body ? { 'content-type': 'application/json', ...headers } : headers,
                    body: body ? JSON.stringify(body) : undefined,
                    signal: AbortSignal.timeout(this.timeoutMs),
                });
                const text = await res.text();
                let parsed = null;
                try {
                    parsed = text ? JSON.parse(text) : null;
                } catch {
                    parsed = { raw: text };
                }
                if (res.ok) return parsed;
                // 503 is how the oracle reports "RPC unavailable / instance asleep".
                if (res.status === 503 && attempt < this.retries) {
                    lastError = new EnrgApiError(res.status, parsed, path);
                    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
                    continue;
                }
                throw new EnrgApiError(res.status, parsed, path);
            } catch (e) {
                if (e instanceof EnrgApiError && e.status !== 503) throw e;
                lastError = e;
                if (attempt < this.retries) {
                    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
                    continue;
                }
            }
        }
        throw lastError;
    }

    /** Liveness. */
    health() {
        return this.request('/health');
    }

    /** Protocol metrics (proofs, minted, energy, producers). */
    stats() {
        return this.request('/api/v1/stats');
    }

    /** Oracle network: on-chain trusted set + per-oracle attribution. */
    oracles() {
        return this.request('/api/v1/oracles');
    }

    /** Stored proofs, newest first. */
    proofs({ deviceId, limit } = {}) {
        const params = new URLSearchParams();
        if (deviceId) params.set('device_id', deviceId);
        if (limit) params.set('limit', String(limit));
        const qs = params.toString();
        return this.request(`/api/v1/proofs${qs ? `?${qs}` : ''}`);
    }

    /** On-chain device state as the oracle sees it. */
    deviceStatus(deviceId) {
        return this.request(`/api/v1/device/${encodeURIComponent(deviceId)}/status`);
    }

    /** SRC balance of the device owner (read from its token account). */
    deviceBalance(deviceId) {
        return this.request(`/api/v1/device/${encodeURIComponent(deviceId)}/balance`);
    }

    /** Proof/mint history of one device from oracle storage. */
    deviceHistory(deviceId, { limit } = {}) {
        const qs = limit ? `?limit=${encodeURIComponent(limit)}` : '';
        return this.request(`/api/v1/device/${encodeURIComponent(deviceId)}/history${qs}`);
    }

    /** Submit a signed proof (see `buildDeviceProof`). */
    submitProof(proof) {
        return this.request('/api/v1/proof/submit', { method: 'POST', body: proof });
    }

    /** Register a device (the device signs its registration message). */
    registerDevice(payload) {
        return this.request('/api/v1/device/register', { method: 'POST', body: payload });
    }

    /** Founder-signed device manifest (ADR-0004). */
    manifest(deviceId) {
        return this.request(`/api/v1/manifest/${encodeURIComponent(deviceId)}`);
    }

    /** Latest signed firmware metadata (ADR-0008). */
    firmwareLatest() {
        return this.request('/api/v1/firmware/latest');
    }
}

module.exports = {
    // wire format
    base58Decode,
    base58Encode,
    le8,
    deviceMessageToSign,
    oracleMessageToSign,
    proofHash,
    attestMessage,
    buildDeviceProof,
    verifyDeviceProof,
    // client
    EnrgClient,
    EnrgApiError,
};
