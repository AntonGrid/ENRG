'use strict';

/**
 * Unit-тесты Policy Engine (ADR-0003) — модуль policy.js.
 *
 * Запуск:  npx mocha tests/policy.test.js   (или npm run test:policy)
 * Покрытие: validateDeviceId / validateEnergyWh / validateTimestamp /
 *           validateNonce / validateSignature / validateRegister /
 *           validateProof + конфигурация политик.
 *
 * Проверяется, что policy.js возвращает те же коды HTTP и строки ошибок,
 * что и прежний server.js (обратная совместимость с клиентами ESP32/тестами).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nacl = require('tweetnacl');
const util = require('tweetnacl-util');
const bs58 = require('bs58').default;
const { PublicKey } = require('@solana/web3.js');

const policy = require('../policy');

// ── Утилиты ──
const nowSec = 1_700_000_000;

/** Генерирует device_id (base58 публичного ключа) + ключевую пару. */
function makeDevice() {
    const kp = nacl.sign.keyPair();
    const publicKeyB64 = util.encodeBase64(kp.publicKey);
    const device_id = bs58.encode(kp.publicKey);
    return { kp, publicKeyB64, device_id, pubkey: new PublicKey(kp.publicKey) };
}

function signBytes(kp, msg) {
    return util.encodeBase64(nacl.sign.detached(new Uint8Array(msg), kp.secretKey));
}

describe('policy.validateDeviceId', function () {
    it('accepts a valid base58 device_id', function () {
        const r = policy.validateDeviceId('11111111111111111111111111111111');
        assert.strictEqual(r.ok, true);
    });

    it('accepts a valid 0x-hex device_id (even length)', function () {
        const r = policy.validateDeviceId('0x' + 'ab'.repeat(32));
        assert.strictEqual(r.ok, true);
        assert.ok(r.deviceIdPubkey instanceof PublicKey);
    });

    it('rejects empty / too long / special characters', function () {
        assert.strictEqual(policy.validateDeviceId('').ok, false);
        assert.strictEqual(policy.validateDeviceId('a'.repeat(129)).ok, false);
        assert.strictEqual(policy.validateDeviceId('abc def').ok, false);
        assert.strictEqual(policy.validateDeviceId('0xabc').ok, false); // нечётная длина hex
        assert.strictEqual(policy.validateDeviceId(123).ok, false);     // не строка
    });

    it('returns 400 with backward-compatible error message', function () {
        const r = policy.validateDeviceId('<script>alert(1)</script>');
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, 'invalid device_id format (base58 or hex only)');
    });
});

describe('policy.validateEnergyWh', function () {
    it('accepts a positive integer and a numeric string', function () {
        assert.strictEqual(policy.validateEnergyWh(1000).energyWhInt, 1000);
        assert.strictEqual(policy.validateEnergyWh('1234.56').energyWhInt, 1235); // Math.round
    });

    it('rejects wrong types, NaN, Infinity, negative, zero, junk strings', function () {
        assert.strictEqual(policy.validateEnergyWh(null).status, 400);
        assert.strictEqual(policy.validateEnergyWh({}).status, 400);
        assert.strictEqual(policy.validateEnergyWh(NaN).error, 'invalid energyWh (must be a finite number)');
        assert.strictEqual(policy.validateEnergyWh(Infinity).status, 400);
        assert.strictEqual(policy.validateEnergyWh('0x10').error, 'invalid energyWh format');
        assert.strictEqual(policy.validateEnergyWh('12abc').error, 'invalid energyWh (must be a finite number)');
        assert.strictEqual(policy.validateEnergyWh(0).error, 'invalid energyWh (must be positive)');
        assert.strictEqual(policy.validateEnergyWh(-5).error, 'invalid energyWh (must be positive)');
    });


describe('policy.validateTimestamp', function () {
    it('accepts a fresh timestamp (now, within age, small future skew)', function () {
        assert.strictEqual(policy.validateTimestamp(nowSec, nowSec).ok, true);
        assert.strictEqual(policy.validateTimestamp(nowSec - 100, nowSec).ok, true);
        assert.strictEqual(policy.validateTimestamp(nowSec + 299, nowSec).ok, true);
    });

    it('rejects a timestamp in the future beyond maxTimestampSkewSec', function () {
        const r = policy.validateTimestamp(nowSec + policy.config.maxTimestampSkewSec + 1, nowSec);
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, 'FutureTimestamp');
    });

    it('rejects a stale timestamp older than maxProofAgeSec', function () {
        const r = policy.validateTimestamp(nowSec - policy.config.maxProofAgeSec - 1, nowSec);
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, 'StaleProof');
    });

    it('rejects non-finite and non-numeric timestamps', function () {
        assert.strictEqual(policy.validateTimestamp(NaN, nowSec).error, 'invalid timestamp (must be a finite number)');
        assert.strictEqual(policy.validateTimestamp(Infinity, nowSec).status, 400);
        assert.strictEqual(policy.validateTimestamp('abc', nowSec).error, 'invalid timestamp (must be a finite number)');
        assert.strictEqual(policy.validateTimestamp({}, nowSec).status, 400);
    });
});

describe('policy.validateNonce', function () {
    it('accepts a positive integer greater than the last nonce', function () {
        assert.strictEqual(policy.validateNonce(5, 0).nonce, 5);
        assert.strictEqual(policy.validateNonce('7', 5).nonce, 7);
    });

    it('rejects zero, negative, fractional and non-numeric nonces', function () {
        assert.strictEqual(policy.validateNonce(0).error, 'invalid nonce (must be a positive integer)');
        assert.strictEqual(policy.validateNonce(-1).error, 'invalid nonce (must be a positive integer)');
        assert.strictEqual(policy.validateNonce(1.5).error, 'invalid nonce (must be a positive integer)');
        assert.strictEqual(policy.validateNonce('abc').error, 'invalid nonce (must be a positive integer)');
    });

    it('rejects replay (nonce <= lastNonce) with InvalidNonce', function () {
        const r = policy.validateNonce(5, 5);
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, 'InvalidNonce');
        assert.strictEqual(policy.validateNonce(5, 10).error, 'InvalidNonce');
    });
});

    it('rejects values above maxEnergyPerReportWh', function () {
        const r = policy.validateEnergyWh(policy.config.maxEnergyPerReportWh + 1);
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, `energyWh exceeds maximum allowed per report (${policy.config.maxEnergyPerReportWh} Wh)`);
    });
});

describe('policy.validateSignature', function () {
    let dev;
    const nonce = 1;
    const timestamp = nowSec;
    const energyWhInt = 1000;

    beforeEach(function () {
        dev = makeDevice();
    });

    function sigParams(overrides) {
        return Object.assign({
            device_id: dev.device_id,
            deviceIdPubkey: dev.pubkey,
            publicKeyB64: dev.publicKeyB64,
            signature: '',
            rawNonce: nonce,
            rawTimestamp: timestamp,
            rawEnergyWh: energyWhInt,
            nonce,
            timestamp,
            energyWhInt,
        }, overrides);
    }

    it('accepts an on-chain binary signature (sig_mode=binary)', function () {
        const msg = policy.buildDeviceMessage(dev.pubkey, nonce, timestamp, energyWhInt);
        const r = policy.validateSignature(sigParams({ signature: signBytes(dev.kp, msg) }));
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.sigMode, 'binary');
    });

    it('accepts a legacy string signature (sig_mode=legacy)', function () {
        const lmsg = Buffer.from(`${dev.device_id}|${timestamp}|${energyWhInt}|${nonce}`, 'utf8');
        const r = policy.validateSignature(sigParams({ signature: signBytes(dev.kp, lmsg) }));
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.sigMode, 'legacy');
    });

    it('rejects a signature over a different message with 401', function () {
        const lmsg = Buffer.from(`${dev.device_id}|${timestamp}|9999|${nonce}`, 'utf8');
        const r = policy.validateSignature(sigParams({ signature: signBytes(dev.kp, lmsg) }));
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.status, 401);
        assert.strictEqual(r.error, 'invalid signature');
    });

    it('rejects a wrong-length signature with 401', function () {
        const r = policy.validateSignature(sigParams({ signature: util.encodeBase64(new Uint8Array(32)) }));
        assert.strictEqual(r.status, 401);
        assert.strictEqual(r.error, 'invalid signature');
    });

    it('rejects broken base64 with 401 (Node Buffer.from(base64) is lenient — как в прежнем server.js)', function () {
        const r = policy.validateSignature(sigParams({ signature: '!!!not-base64!!!' }));
        assert.strictEqual(r.status, 401);
        assert.strictEqual(r.error, 'invalid signature');
    });

    it('rejects broken publicKeyB64 with 401 (lenient base64 → длина 0 ≠ 32)', function () {
        const msg = policy.buildDeviceMessage(dev.pubkey, nonce, timestamp, energyWhInt);
        const r = policy.validateSignature(sigParams({
            publicKeyB64: '!!!not-base64!!!',
            signature: signBytes(dev.kp, msg),
        }));
        assert.strictEqual(r.status, 401);
        assert.strictEqual(r.error, 'invalid signature');
    });
});


describe('policy.validateRegister', function () {
    let dev;

    beforeEach(function () {
        dev = makeDevice();
    });

    function regSig() {
        const msg = Buffer.from(`${dev.device_id}|${dev.publicKeyB64}`, 'utf8');
        return signBytes(dev.kp, msg);
    }

    it('accepts a valid registration (proof-of-possession)', function () {
        const r = policy.validateRegister(dev.device_id, dev.publicKeyB64, regSig());
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.pubBytes.length, 32);
        assert.strictEqual(r.sigBytes.length, 64);
    });

    it('rejects an invalid device_id with 400', function () {
        const r = policy.validateRegister('<bad>', dev.publicKeyB64, regSig());
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, 'invalid device_id format (base58 or hex only)');
    });

    it('rejects a wrong-length public key with 400', function () {
        const r = policy.validateRegister(dev.device_id, util.encodeBase64(new Uint8Array(16)), regSig());
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, 'invalid public key (must be 32 bytes base64)');
    });

    it('rejects a non-base64 public key with 400 (lenient decode → длина 0 ≠ 32)', function () {
        const r = policy.validateRegister(dev.device_id, '!!!', regSig());
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, 'invalid public key (must be 32 bytes base64)');
    });

    it('rejects a wrong-length signature with 400', function () {
        const r = policy.validateRegister(dev.device_id, dev.publicKeyB64, util.encodeBase64(new Uint8Array(16)));
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, 'invalid signature (must be 64 bytes base64)');
    });

    it('rejects a signature over the wrong challenge with 403', function () {
        const msg = Buffer.from(`${dev.device_id}|other-public-key`, 'utf8');
        const r = policy.validateRegister(dev.device_id, dev.publicKeyB64, signBytes(dev.kp, msg));
        assert.strictEqual(r.status, 403);
        assert.strictEqual(r.error, 'invalid signature: proof of device key ownership required');
    });
});


describe('policy.validateProof', function () {
    let dev;
    const energyWh = 1000;

    beforeEach(function () {
        dev = makeDevice();
    });

    function ctx(overrides) {
        return Object.assign({
            nowSec,
            getPublicKey: () => dev.publicKeyB64,
            getLastNonce: () => 0,
        }, overrides);
    }

    function proofBody(overrides) {
        return Object.assign({
            device_id: dev.device_id,
            timestamp: nowSec,
            energyWh,
            nonce: 1,
            signature: '',
        }, overrides);
    }

    it('accepts a full valid binary proof and returns a normalized proof', function () {
        const msg = policy.buildDeviceMessage(dev.pubkey, 1, nowSec, energyWh);
        const body = proofBody({ signature: signBytes(dev.kp, msg) });
        const r = policy.validateProof(body, ctx());
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.proof.sig_mode, 'binary');
        assert.strictEqual(r.proof.energy_wh, energyWh);
        assert.strictEqual(r.proof.nonce, 1);
        assert.strictEqual(r.proof.device_timestamp, nowSec);
        assert.ok(Buffer.isBuffer(r.proof.device_signature));
    });

    it('accepts a legacy signature (sig_mode=legacy, no mint)', function () {
        const lmsg = Buffer.from(`${dev.device_id}|${nowSec}|${energyWh}|1`, 'utf8');
        const body = proofBody({ signature: signBytes(dev.kp, lmsg) });
        const r = policy.validateProof(body, ctx());
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.proof.sig_mode, 'legacy');
    });

    it('rejects missing fields with 400', function () {
        const r = policy.validateProof({}, ctx());
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, 'missing fields');
    });

    it('rejects an unknown device with 400 (registry check via ctx.getPublicKey)', function () {
        const msg = policy.buildDeviceMessage(dev.pubkey, 1, nowSec, energyWh);
        const body = proofBody({ signature: signBytes(dev.kp, msg) });
        const r = policy.validateProof(body, ctx({ getPublicKey: () => null }));
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, 'unknown device');
    });

    it('rejects invalid energyWh with 400', function () {
        const body = proofBody({ energyWh: 0, signature: 'AAAA' });
        const r = policy.validateProof(body, ctx());
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, 'invalid energyWh (must be positive)');
    });

    it('rejects a stale timestamp with 400 StaleProof', function () {
        const body = proofBody({ timestamp: nowSec - policy.config.maxProofAgeSec - 1, signature: 'AAAA' });
        const r = policy.validateProof(body, ctx());
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, 'StaleProof');
    });

    it('rejects a replayed nonce with 400 InvalidNonce', function () {
        const msg = policy.buildDeviceMessage(dev.pubkey, 5, nowSec, energyWh);
        const body = proofBody({ nonce: 5, signature: signBytes(dev.kp, msg) });
        const r = policy.validateProof(body, ctx({ getLastNonce: () => 5 }));
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, 'InvalidNonce');
    });

    it('rejects a bad signature with 401', function () {
        const badMsg = Buffer.from('wrong message', 'utf8');
        const body = proofBody({ signature: signBytes(dev.kp, badMsg) });
        const r = policy.validateProof(body, ctx());
        assert.strictEqual(r.status, 401);
        assert.strictEqual(r.error, 'invalid signature');
    });

    it('preserves check order: bad device_id is reported first', function () {
        const body = proofBody({ device_id: '0xabc', signature: 'AAAA' }); // нечётная длина hex; подпись непустая, чтобы пройти missing-fields
        const r = policy.validateProof(body, ctx());
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.error, 'invalid device_id format (base58 or hex only)');
    });

    it('passes pool_id through', function () {
        const msg = policy.buildDeviceMessage(dev.pubkey, 1, nowSec, energyWh);
        const body = proofBody({ signature: signBytes(dev.kp, msg), pool_id: 'pool-1' });
        const r = policy.validateProof(body, ctx());
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.pool_id, 'pool-1');
    });
});

describe('policy config', function () {
    afterEach(function () {
        delete process.env.MAX_ENERGY_PER_REPORT_WH;
        delete process.env.MAX_TIMESTAMP_SKEW_SEC;
        delete process.env.MAX_PROOF_AGE_SEC;
        delete process.env.RATE_LIMIT_PER_MINUTE;
        policy.reloadConfig(); // вернуть значения из policy-config.json / дефолты
    });

    it('rateLimitOptions uses rateLimitPerMinute', function () {
        const opts = policy.rateLimitOptions();
        assert.strictEqual(opts.max, policy.config.rateLimitPerMinute);
        assert.strictEqual(opts.windowMs, 60 * 1000);
    });

    it('setConfig overrides limits and validateEnergyWh respects them', function () {
        policy.setConfig({ maxEnergyPerReportWh: 5000 });
        assert.strictEqual(policy.config.maxEnergyPerReportWh, 5000);
        assert.strictEqual(policy.validateEnergyWh(6000).status, 400);
        assert.strictEqual(policy.validateEnergyWh(4000).ok, true);
    });

    it('environment variables override the config file', function () {
        process.env.MAX_ENERGY_PER_REPORT_WH = '42';
        policy.reloadConfig();
        assert.strictEqual(policy.config.maxEnergyPerReportWh, 42);
    });


describe('policy.getOracleKeypair (multi-oracle mint, ADR-0003)', function () {
    const savedEnv = {};

    before(function () {
        savedEnv.ORACLE_KEY = process.env.ORACLE_KEY;
        savedEnv.ORACLE_KEY_PATH = process.env.ORACLE_KEY_PATH;
    });

    after(function () {
        delete process.env.ORACLE_KEY;
        delete process.env.ORACLE_KEY_PATH;
        if (savedEnv.ORACLE_KEY !== undefined) process.env.ORACLE_KEY = savedEnv.ORACLE_KEY;
        if (savedEnv.ORACLE_KEY_PATH !== undefined) process.env.ORACLE_KEY_PATH = savedEnv.ORACLE_KEY_PATH;
    });

    it('loads oracle keypair from ORACLE_KEY env (JSON array)', function () {
        const kp = nacl.sign.keyPair();
        process.env.ORACLE_KEY = JSON.stringify(Array.from(kp.secretKey));
        delete process.env.ORACLE_KEY_PATH;
        const loaded = policy.getOracleKeypair();
        assert.ok(loaded, 'keypair должен загрузиться');
        assert.strictEqual(Buffer.from(loaded.publicKey.toBytes()).toString('hex'), Buffer.from(kp.publicKey).toString('hex'));
    });

    it('loads oracle keypair from ORACLE_KEY_PATH file', function () {
        const kp = nacl.sign.keyPair();
        const file = path.join(os.tmpdir(), `enrg-oracle-${Date.now()}.json`);
        fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
        delete process.env.ORACLE_KEY;
        process.env.ORACLE_KEY_PATH = file;
        const loaded = policy.getOracleKeypair();
        assert.ok(loaded);
        assert.strictEqual(Buffer.from(loaded.publicKey.toBytes()).toString('hex'), Buffer.from(kp.publicKey).toString('hex'));
        fs.unlinkSync(file);
    });

    it('returns null when no oracle key configured', function () {
        delete process.env.ORACLE_KEY;
        delete process.env.ORACLE_KEY_PATH;
        assert.strictEqual(policy.getOracleKeypair(), null);
    });
});

    it('loadConfig tolerates a missing config file', function () {
        const cfg = policy.loadConfig({ configPath: '/nonexistent/policy-config.json' });
        assert.strictEqual(cfg.maxEnergyPerReportWh, policy.DEFAULT_CONFIG.maxEnergyPerReportWh);
    });
});

