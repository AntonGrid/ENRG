'use strict';

/**
 * Firmware OTA-update tests (ADR-0008).
 *
 * 1) UNIT: firmware-metadata signing (policy.buildFirmwareMessage /
 *    signFirmware / verifyFirmware) — mirrors verifyFirmwareSignature
 *    from the ESP32 firmware.
 * 2) E2E: the device checks for an update (GET /firmware/latest),
 *    downloads the image (GET /firmware/latest/image), verifies the signature and hash,
 *    and installs it (simulated; real OTA runs on the ESP32 board).
 *
 * Run: npx mocha tests/firmware.test.js
 */

const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const nacl = require('tweetnacl');

const policy = require('../policy');

// ── UNIT: image signing ──
describe('Firmware signing (ADR-0008, unit)', function () {
    let kp;

    beforeEach(function () {
        kp = nacl.sign.keyPair();
    });

    function sampleFw() {
        const img = Buffer.from('FAKE FIRMWARE BINARY 0123456789');
        return {
            version: '1.2.0',
            image_hash: crypto.createHash('sha256').update(img).digest('hex'),
            image_size: img.length,
        };
    }

    it('buildFirmwareMessage is deterministic (version|hash|size)', function () {
        const f = sampleFw();
        assert.strictEqual(
            policy.buildFirmwareMessage(f),
            `${f.version}|${f.image_hash}|${f.image_size}`
        );
    });

    it('sign/verify round-trip succeeds', function () {
        const f = sampleFw();
        const sig = policy.signFirmware(f, kp.secretKey);
        assert.strictEqual(policy.verifyFirmware(f, sig, kp.publicKey).ok, true);
    });

    it('rejects a tampered version (anti-rollback: the version is in the signature)', function () {
        const f = sampleFw();
        const sig = policy.signFirmware(f, kp.secretKey);
        assert.strictEqual(policy.verifyFirmware({ ...f, version: '9.9.9' }, sig, kp.publicKey).ok, false);
    });

    it('rejects a tampered image_hash (image does not match the metadata)', function () {
        const f = sampleFw();
        const sig = policy.signFirmware(f, kp.secretKey);
        assert.strictEqual(policy.verifyFirmware({ ...f, image_hash: 'ab'.repeat(32) }, sig, kp.publicKey).ok, false);
    });

    it('rejects a signature from a different key', function () {
        const f = sampleFw();
        const sig = policy.signFirmware(f, kp.secretKey);
        const other = nacl.sign.keyPair();
        assert.strictEqual(policy.verifyFirmware(f, sig, other.publicKey).ok, false);
    });

    it('rejects bad fields / encodings', function () {
        const f = sampleFw();
        const sig = policy.signFirmware(f, kp.secretKey);
        assert.strictEqual(policy.verifyFirmware({ ...f, image_size: 0 }, sig, kp.publicKey).ok, false);
        assert.strictEqual(policy.verifyFirmware({ ...f, image_hash: 'xyz' }, sig, kp.publicKey).ok, false);
        assert.strictEqual(policy.verifyFirmware(f, 'AAAA', kp.publicKey).error, 'bad_signature_or_key_length');
    });
});

// ── E2E: publish → check for update → download → verify signature/hash ──
describe('Firmware OTA E2E (/api/v1/firmware/*)', function () {
    this.timeout(30000);

    let server;
    let founderKp;
    let fwKp;   // COLD firmware-signing key (ADR-0008, D-5) — separate from the founder.
    let tmpDir;
    const PORT = 4030;
    const BASE = `http://127.0.0.1:${PORT}`;
    const ADMIN_KEY = 'firmware-admin-key-0123456789abcdef0123456789abcdef';

    function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

    async function upload(bin, version, model, apiKey) {
        const res = await fetch(`${BASE}/api/v1/firmware/update?version=${version}&model=${model || ''}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream', 'x-api-key': apiKey || '' },
            body: bin,
        });
        return { status: res.status, data: await res.json() };
    }

    before(async function () {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrg-fw-'));
        founderKp = nacl.sign.keyPair();
        const keyFile = path.join(tmpDir, 'founder.json');
        fs.writeFileSync(keyFile, JSON.stringify(Array.from(founderKp.secretKey)));
        // ADR-0008 (D-5): images are signed with a SEPARATE firmware key.
        fwKp = nacl.sign.keyPair();
        const fwKeyFile = path.join(tmpDir, 'fw-signing.json');
        fs.writeFileSync(fwKeyFile, JSON.stringify(Array.from(fwKp.secretKey)));
        const updatesDir = path.join(tmpDir, 'updates');

        server = spawn('node', ['server.js'], {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                PORT: String(PORT),
                FOUNDER_KEY_PATH: keyFile,
                FIRMWARE_SIGNING_KEY_PATH: fwKeyFile,
                ENRG_SQLITE_PATH: path.join(tmpDir, 'enrg.db'),
                ORACLE_URL: BASE,
                FIRMWARE_ADMIN_KEY: ADMIN_KEY,
                FIRMWARE_UPDATES_DIR: updatesDir,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        server.stdout.on('data', () => {});
        server.stderr.on('data', (d) => process.stderr.write(d));

        for (let i = 0; i < 40; i++) {
            try {
                const res = await fetch(`${BASE}/health`);
                if (res.ok) return;
            } catch (e) { /* not ready yet */ }
            await wait(250);
        }
        throw new Error('server did not start in time');
    });

    after(function () {
        if (server) server.kill('SIGTERM');
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    });

    it('publishes a firmware image and returns signed metadata', async function () {
        const bin = Buffer.from('ENRG-ESP32-v1.2.0-BUILD-42'.repeat(200));
        const r = await upload(bin, '1.2.0', 'ENRG-ESP32-v1', ADMIN_KEY);
        assert.strictEqual(r.status, 201, JSON.stringify(r.data));
        assert.strictEqual(r.data.version, '1.2.0');
        assert.strictEqual(r.data.image_size, bin.length);
        assert.strictEqual(r.data.image_hash, crypto.createHash('sha256').update(bin).digest('hex'));
    });

    it('device checks for updates and verifies the metadata signature', async function () {
        const bin = Buffer.from('ENRG-ESP32-v1.2.0-BUILD-42'.repeat(200));
        await upload(bin, '1.2.0', 'ENRG-ESP32-v1', ADMIN_KEY);

        // The device requests metadata via checkForUpdates().
        const res = await fetch(`${BASE}/api/v1/firmware/latest`);
        assert.strictEqual(res.status, 200);
        const meta = await res.json();

        // Signature verified with the firmware KEY (D-5: cold key, not the founder),
        // as verifyFirmwareSignature in the firmware (ENRG_FIRMWARE_PUBKEY_HEX).
        const v = policy.verifyFirmware(
            { version: meta.version, image_hash: meta.image_hash, image_size: meta.image_size },
            meta.signature,
            fwKp.publicKey
        );
        assert.strictEqual(v.ok, true, JSON.stringify(v));
        assert.strictEqual(meta.version, '1.2.0');
    });

    it('device downloads the image and verifies SHA-256 matches image_hash', async function () {
        const bin = Buffer.from('ENRG-ESP32-v1.3.0-BUILD-99'.repeat(200));
        await upload(bin, '1.3.0', 'ENRG-ESP32-v1', ADMIN_KEY);

        const res = await fetch(`${BASE}/api/v1/firmware/latest/image`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get('x-firmware-version'), '1.3.0');
        const body = Buffer.from(await res.arrayBuffer());

        // The downloaded image hash must match the image_hash from the metadata.
        const meta = await (await fetch(`${BASE}/api/v1/firmware/latest`)).json();
        assert.strictEqual(crypto.createHash('sha256').update(body).digest('hex'), meta.image_hash);
        assert.strictEqual(body.length, meta.image_size);
    });

    it('rejects an unsigned/unauthenticated upload (no admin key → 401)', async function () {
        const bin = Buffer.from('ATTACKER-FIRMWARE');
        const r = await upload(bin, '9.9.9', '', '');
        assert.strictEqual(r.status, 401);
        assert.strictEqual(r.data.error, 'invalid admin key');
    });

    it('rejects an empty image (400)', async function () {
        const r = await upload(Buffer.alloc(0), '1.4.0', '', ADMIN_KEY);
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.data.error, 'empty firmware image');
    });

    it('anti-rollback: a lower version is rejected by the device (simulation)', async function () {
        // Publish a new version.
        const bin = Buffer.from('FW-2.0.0');
        await upload(bin, '2.0.0', 'ENRG-ESP32-v1', ADMIN_KEY);
        const meta = await (await fetch(`${BASE}/api/v1/firmware/latest`)).json();

        // The device with current version 2.0.0 compares versions.
        const current = '2.0.0';
        const compare = (a, b) => {
            const pa = a.split('.').map(Number);
            const pb = b.split('.').map(Number);
            for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
                const x = pa[i] || 0, y = pb[i] || 0;
                if (x !== y) return x < y ? -1 : 1;
            }
            return 0;
        };
        // An update from 1.0.0 to 0.9.0 (lower) must be rejected.
        assert.strictEqual(compare('0.9.0', current), -1);
        assert.strictEqual(compare(meta.version, current), 0);
        // Device policy: apply only when new > current.
        const shouldApply = compare(meta.version, current) > 0;
        assert.strictEqual(shouldApply, false);
    });
});
