'use strict';

/**
 * Тесты Device Manifest (ADR-0004).
 *
 * 1) UNIT: подпись/проверка манифеста (policy.buildManifestMessage /
 *    signManifest / verifyManifest) — зеркалирует verifyManifest прошивки ESP32.
 * 2) E2E: устройство регистрируется → запрашивает подписанный манифест
 *    GET /api/v1/manifest/:device_id → проверяет подпись ключом основателя →
 *    отправляет proof на oracle_url из манифеста.
 *
 * Запуск: npx mocha tests/manifest.test.js
 */

const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const nacl = require('tweetnacl');
const util = require('tweetnacl-util');
const bs58 = require('bs58');

const policy = require('../policy');

// ── UNIT: подпись манифеста ──
describe('Device Manifest signing (ADR-0004, unit)', function () {
    let kp;

    beforeEach(function () {
        kp = nacl.sign.keyPair();
    });

    function sampleManifest() {
        return {
            device_id: 'D123',
            rated_power: 5000,
            oracle_url: 'https://oracle.example.com',
            public_key: util.encodeBase64(new Uint8Array(32).fill(7)),
            timestamp: 1700000000,
        };
    }

    it('buildManifestMessage is deterministic and pipe-separated', function () {
        const m = sampleManifest();
        const msg = policy.buildManifestMessage(m);
        const expected = `${m.device_id}|${m.rated_power}|${m.oracle_url}|${m.public_key}|${m.timestamp}`;
        assert.strictEqual(msg, expected);
    });

    it('sign/verify round-trip succeeds', function () {
        const m = sampleManifest();
        const sig = policy.signManifest(m, kp.secretKey);
        const r = policy.verifyManifest(m, sig, kp.publicKey);
        assert.strictEqual(r.ok, true);
    });

    it('rejects a manifest with a tampered rated_power', function () {
        const m = sampleManifest();
        const sig = policy.signManifest(m, kp.secretKey);
        const r = policy.verifyManifest({ ...m, rated_power: 9999 }, sig, kp.publicKey);
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.error, 'signature_invalid');
    });

    it('rejects a manifest with a tampered oracle_url', function () {
        const m = sampleManifest();
        const sig = policy.signManifest(m, kp.secretKey);
        const r = policy.verifyManifest({ ...m, oracle_url: 'https://evil.example.com' }, sig, kp.publicKey);
        assert.strictEqual(r.ok, false);
    });

    it('rejects a manifest signed by a different key', function () {
        const m = sampleManifest();
        const sig = policy.signManifest(m, kp.secretKey);
        const other = nacl.sign.keyPair();
        assert.strictEqual(policy.verifyManifest(m, sig, other.publicKey).ok, false);
    });

    it('rejects missing fields / bad signature encoding', function () {
        const m = sampleManifest();
        const sig = policy.signManifest(m, kp.secretKey);
        assert.strictEqual(policy.verifyManifest({ ...m, public_key: '' }, sig, kp.publicKey).ok, false);
        assert.strictEqual(policy.verifyManifest(m, 'AAAA', kp.publicKey).error, 'bad_signature_or_key_length');
        assert.strictEqual(policy.verifyManifest(m, sig, new Uint8Array(16)).error, 'bad_signature_or_key_length');
    });
});

// ── E2E: манифест → проверка подписи → proof ──
describe('Device Manifest E2E (GET /api/v1/manifest/:device_id)', function () {
    this.timeout(30000);

    let server;
    let founderKp;
    let tmpDir;
    const PORT = 4020;
    const BASE = `http://127.0.0.1:${PORT}`;

    function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

    async function get(pathname) {
        const res = await fetch(BASE + pathname);
        return { status: res.status, data: await res.json() };
    }

    async function post(pathname, body) {
        const res = await fetch(BASE + pathname, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return { status: res.status, data: await res.json() };
    }

    before(async function () {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrg-manifest-'));
        founderKp = nacl.sign.keyPair();
        const keyFile = path.join(tmpDir, 'founder.json');
        fs.writeFileSync(keyFile, JSON.stringify(Array.from(founderKp.secretKey)));
        const dbFile = path.join(tmpDir, 'enrg.db');

        server = spawn('node', ['server.js'], {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                PORT: String(PORT),
                FOUNDER_KEY_PATH: keyFile,
                ENRG_SQLITE_PATH: dbFile,
                ORACLE_URL: BASE,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        server.stdout.on('data', () => {});
        server.stderr.on('data', (d) => process.stderr.write(d));

        for (let i = 0; i < 40; i++) {
            try {
                const res = await fetch(`${BASE}/health`);
                if (res.ok) return;
            } catch (e) { /* ещё не готов */ }
            await wait(250);
        }
        throw new Error('server did not start in time');
    });

    after(function () {
        if (server) server.kill('SIGTERM');
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    });

    it('registers a device, fetches a signed manifest and verifies it', async function () {
        const dev = nacl.sign.keyPair();
        const device_id = bs58.encode(dev.publicKey);
        const publicKeyB64 = util.encodeBase64(dev.publicKey);

        const regMsg = Buffer.from(`${device_id}|${publicKeyB64}`, 'utf8');
        const regSig = util.encodeBase64(nacl.sign.detached(regMsg, dev.secretKey));
        const reg = await post('/api/v1/device/register', { device_id, public_key: publicKeyB64, signature: regSig });
        assert.strictEqual(reg.status, 200, JSON.stringify(reg.data));

        const m = await get(`/api/v1/manifest/${device_id}`);
        assert.strictEqual(m.status, 200, JSON.stringify(m.data));

        const manifest = {
            device_id: m.data.device_id,
            rated_power: m.data.rated_power,
            oracle_url: m.data.oracle_url,
            public_key: m.data.public_key,
            timestamp: m.data.timestamp,
        };
        assert.strictEqual(manifest.device_id, device_id);
        assert.strictEqual(manifest.public_key, publicKeyB64);
        assert.strictEqual(manifest.oracle_url, BASE);
        assert.strictEqual(manifest.rated_power, policy.config.defaultRatedPowerW);

        const v = policy.verifyManifest(manifest, m.data.signature, founderKp.publicKey);
        assert.strictEqual(v.ok, true, JSON.stringify(v));
    });

    it('rejects a tampered manifest (устройство отклоняет невалидный манифест)', async function () {
        const dev = nacl.sign.keyPair();
        const device_id = bs58.encode(dev.publicKey);
        const m = await get(`/api/v1/manifest/${device_id}`);
        assert.strictEqual(m.status, 200);

        const tampered = {
            device_id: m.data.device_id,
            rated_power: m.data.rated_power + 1,
            oracle_url: m.data.oracle_url,
            public_key: m.data.public_key,
            timestamp: m.data.timestamp,
        };
        const v = policy.verifyManifest(tampered, m.data.signature, founderKp.publicKey);
        assert.strictEqual(v.ok, false);
    });

    it('device uses oracle_url from the manifest to submit a proof', async function () {
        const dev = nacl.sign.keyPair();
        const device_id = bs58.encode(dev.publicKey);
        const publicKeyB64 = util.encodeBase64(dev.publicKey);
        const regMsg = Buffer.from(`${device_id}|${publicKeyB64}`, 'utf8');
        const regSig = util.encodeBase64(nacl.sign.detached(regMsg, dev.secretKey));
        await post('/api/v1/device/register', { device_id, public_key: publicKeyB64, signature: regSig });

        const m = await get(`/api/v1/manifest/${device_id}`);
        assert.strictEqual(m.status, 200);
        assert.strictEqual(m.data.oracle_url, BASE);

        const now = Math.floor(Date.now() / 1000);
        const lmsg = Buffer.from(`${device_id}|${now}|1000|1`, 'utf8');
        const lsig = util.encodeBase64(nacl.sign.detached(lmsg, dev.secretKey));
        const proof = await post('/api/v1/proof/submit', {
            device_id, timestamp: now, energyWh: 1000, nonce: 1, signature: lsig,
        });
        assert.strictEqual(proof.status, 200, JSON.stringify(proof.data));
        assert.strictEqual(proof.data.accumulated, 1000);
    });

    it('supports rated_power override and works for unregistered devices (backward compat)', async function () {
        const dev = nacl.sign.keyPair();
        const device_id = bs58.encode(dev.publicKey);

        const m = await get(`/api/v1/manifest/${device_id}?rated_power=5000`);
        assert.strictEqual(m.status, 200);
        assert.strictEqual(m.data.rated_power, 5000);
        assert.strictEqual(m.data.public_key, util.encodeBase64(dev.publicKey));
        const v = policy.verifyManifest(
            {
                device_id: m.data.device_id,
                rated_power: m.data.rated_power,
                oracle_url: m.data.oracle_url,
                public_key: m.data.public_key,
                timestamp: m.data.timestamp,
            },
            m.data.signature,
            founderKp.publicKey
        );
        assert.strictEqual(v.ok, true);
    });

    it('rejects an invalid device_id format with 400', async function () {
        const m = await get('/api/v1/manifest/%3Cscript%3E');
        assert.strictEqual(m.status, 400);
        assert.strictEqual(m.data.error, 'invalid device_id format (base58 or hex only)');
    });
});
