'use strict';

/**
 * API-тесты эндпоинтов отзыва/ротации ключа (ADR-0007).
 *
 * Тестируют слой валидации запросов оракула (без реального RPC):
 *  - формат device_id / new_device_id;
 *  - наличие подписей владельца и нового ключа;
 *  - путь «нет RPC» → понятная ошибка (не 500 Internal).
 * Реальная on-chain логика revoke/rotate покрыта tests/key-rotation.ts
 * (anchor, solana-test-validator).
 */

const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const nacl = require('tweetnacl');
const bs58 = require('bs58');

const PORT = 4040;
const BASE = `http://127.0.0.1:${PORT}`;

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function post(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty */ }
    return { status: res.status, data };
}

describe('Oracle revoke/rotate API (ADR-0007)', function () {
    this.timeout(30000);
    let server;
    let tmpDir;

    before(async function () {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrg-keyrot-'));
        const founder = nacl.sign.keyPair();
        const keyFile = path.join(tmpDir, 'founder.json');
        fs.writeFileSync(keyFile, JSON.stringify(Array.from(founder.secretKey)));

        // RPC недоступен (порт 1) — тестируем слой валидации запросов.
        server = spawn('node', ['server.js'], {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                PORT: String(PORT),
                FOUNDER_KEY_PATH: keyFile,
                ENRG_SQLITE_PATH: path.join(tmpDir, 'enrg.db'),
                RPC_ENDPOINT: 'http://127.0.0.1:1',
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
        throw new Error('server did not start');
    });

    after(function () {
        if (server) server.kill('SIGTERM');
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    });

    function validId() {
        return bs58.encode(nacl.sign.keyPair().publicKey);
    }

    it('revoke: invalid device_id format → 400', async function () {
        const r = await post(`${BASE}/api/v1/device/revoke/%3Cscript%3E`, {});
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.data.error, 'invalid device_id format (base58 or hex only)');
    });

    it('revoke: non-32-byte device_id → 400', async function () {
        const r = await post(`${BASE}/api/v1/device/revoke/0xab`, {}); // 1 байт, не 32
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.data.error, 'invalid device_id (must be a 32-byte key)');
    });

    it('revoke: RPC недоступен → понятная ошибка revoke_onchain_failed (не 500 Internal)', async function () {
        const r = await post(`${BASE}/api/v1/device/revoke/${validId()}`, {});
        assert.strictEqual(r.status, 500);
        assert.strictEqual(r.data.error, 'revoke_onchain_failed');
        assert.ok(r.data.reason, 'reason присутствует');
    });

    it('rotate: new_device_id совпадает с device_id → 400', async function () {
        const id = validId();
        const r = await post(`${BASE}/api/v1/device/rotate/${id}`, {
            new_device_id: id,
            owner_signature: 'AAAA',
            new_device_signature: 'BBBB',
        });
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.data.error, 'new_device_id must differ from device_id');
    });

    it('rotate: отсутствуют подписи → 400', async function () {
        const r = await post(`${BASE}/api/v1/device/rotate/${validId()}`, {
            new_device_id: validId(),
        });
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.data.error, 'owner_signature and new_device_signature are required');
    });

    it('rotate: RPC недоступен → device_not_registered_on_chain (404)', async function () {
        const r = await post(`${BASE}/api/v1/device/rotate/${validId()}`, {
            new_device_id: validId(),
            owner_signature: 'AAAA',
            new_device_signature: 'BBBB',
        });
        assert.strictEqual(r.status, 404);
        assert.strictEqual(r.data.error, 'device_not_registered_on_chain');
    });
});
