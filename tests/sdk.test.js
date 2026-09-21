/**
 * SDK tests (audit 2026-09-21).
 *
 * Two questions this suite answers:
 *   1. does the JavaScript client produce exactly the bytes the chain expects —
 *      including the language-independent fixtures in sdk/vectors/wire_format.json
 *      and byte-for-byte parity with `policy.js` (which the conformance suite
 *      checks against the Rust engine)?
 *   2. does the HTTP client speak the live API correctly — paths, query
 *      parameters, error mapping and the 503 retry that the free hosting tier
 *      makes necessary?
 *
 * The HTTP part runs against a local express mock of the real routes, so the
 * suite is hermetic (no network, no devnet).
 */
'use strict';

const assert = require('assert');
const express = require('express');
const nacl = require('tweetnacl');
const { PublicKey } = require('@solana/web3.js');

const sdk = require('../sdk/js/enrg-client.js');
const policy = require('../policy.js');
const vectors = require('../sdk/vectors/wire_format.json');

/** Start the mock oracle on an ephemeral port and return { url, close }. */
async function startMockOracle(flakyHandler) {
    const app = express();
    app.use(express.json());
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    app.get('/api/v1/stats', (_req, res) => res.json({ total_proofs: 28, minted_proofs: 15 }));
    app.get('/api/v1/oracles', (_req, res) =>
        res.json({ ok: true, count: 2, counts: { registered: 2, with_proofs: 2, idle: 0 }, oracles: [] })
    );
    app.get('/api/v1/proofs', (req, res) =>
        res.json({ ok: true, count: 1, device_id: req.query.device_id || null, proofs: [] })
    );
    app.get('/api/v1/device/:id/balance', (req, res) =>
        res.json({ device_id: req.params.id, balance: 0.000536313, balance_atomic: '536313' })
    );
    app.get('/api/v1/device/:id/history', (req, res) =>
        res.json({ device_id: req.params.id, count: 1, history: [{ mint_status: 'minted' }] })
    );
    app.get('/api/v1/device/:id/status', (req, res) =>
        res.status(404).json({ error: 'device not found', device_id: req.params.id })
    );
    if (flakyHandler) app.get('/flaky', flakyHandler);

    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

describe('SDK — wire format (sdk/js/enrg-client.js)', () => {
    it('reproduces every committed vector byte for byte', () => {
        for (const v of vectors.vectors) {
            const deviceBytes = new PublicKey(Buffer.from(v.device_id_hex, 'hex'));
            const deviceMsg = sdk.deviceMessageToSign(
                deviceBytes.toBuffer(),
                v.nonce,
                v.device_timestamp,
                v.energy_wh
            );
            const oracleMsg = sdk.oracleMessageToSign(
                deviceBytes.toBuffer(),
                v.nonce,
                v.device_timestamp,
                v.verified_at,
                v.energy_wh
            );
            const hash = sdk.proofHash(oracleMsg);
            const attest = sdk.attestMessage(deviceBytes.toBuffer(), v.nonce, hash);

            assert.strictEqual(deviceMsg.toString('hex'), v.device_message_hex, `${v.name}: device message`);
            assert.strictEqual(oracleMsg.toString('hex'), v.oracle_message_hex, `${v.name}: oracle message`);
            assert.strictEqual(hash.toString('hex'), v.proof_hash_hex, `${v.name}: proof hash`);
            assert.strictEqual(attest.toString('hex'), v.attest_message_hex, `${v.name}: attest message`);
        }
    });

    it('matches policy.js exactly (the Rust-validated mirror)', () => {
        const key = nacl.sign.keyPair.fromSeed(Buffer.alloc(32, 7));
        const devicePubkey = new PublicKey(Buffer.from(key.publicKey));
        const [nonce, ts, verifiedAt, energyWh] = [1234, 1700000123, 1700000124, 987654];

        assert.strictEqual(
            sdk.deviceMessageToSign(devicePubkey.toBuffer(), nonce, ts, energyWh).toString('hex'),
            policy.buildDeviceMessage(devicePubkey, nonce, ts, energyWh).toString('hex')
        );
        const oracleMsg = sdk.oracleMessageToSign(
            devicePubkey.toBuffer(),
            nonce,
            ts,
            verifiedAt,
            energyWh
        );
        assert.strictEqual(
            oracleMsg.toString('hex'),
            policy.buildOracleMessage(devicePubkey, nonce, ts, verifiedAt, energyWh).toString('hex')
        );
        assert.strictEqual(
            sdk.attestMessage(devicePubkey.toBuffer(), nonce, sdk.proofHash(oracleMsg)).toString('hex'),
            policy.buildAttestMessage(devicePubkey, nonce, policy.proofHashOf(oracleMsg)).toString('hex')
        );
    });

    it('refuses numbers that would silently lose bytes, and out-of-range u64s', () => {
        assert.throws(() => sdk.le8(Number.MAX_SAFE_INTEGER + 1), /MAX_SAFE_INTEGER/);
        assert.throws(() => sdk.le8(-1), /out of range/);
        assert.throws(() => sdk.le8(2n ** 64n), /out of range/);
        // A BigInt above 2^53 is exact and therefore allowed.
        assert.strictEqual(sdk.le8(2n ** 60n).toString('hex'), '0000000000000010');
    });

    it('builds a device proof that verifies — and fails after tampering', () => {
        const seed = Buffer.alloc(32, 9);
        const proof = sdk.buildDeviceProof({
            secretKey: seed,
            nonce: 5,
            deviceTimestamp: 1700000000,
            energyWh: 2500,
        });
        assert.strictEqual(proof.device_id.length, 44, 'base58 device id');
        assert.strictEqual(proof.device_signature.length, 64);
        assert.ok(sdk.verifyDeviceProof(proof), 'valid signature must verify');
        assert.ok(!sdk.verifyDeviceProof({ ...proof, energy_wh: 999999 }), 'tampered proof must fail');
        assert.ok(
            !sdk.verifyDeviceProof({ ...proof, device_signature: proof.device_signature.map(() => 0) }),
            'zero signature must fail'
        );
    });

    it('round-trips base58 device ids', () => {
        const seed = Buffer.alloc(32, 3);
        const proof = sdk.buildDeviceProof({ secretKey: seed, nonce: 1, deviceTimestamp: 1, energyWh: 1 });
        const decoded = sdk.base58Decode(proof.device_id);
        assert.strictEqual(decoded.length, 32);
        assert.strictEqual(sdk.base58Encode(decoded), proof.device_id);
    });
});

describe('SDK — HTTP client (EnrgClient)', () => {
    let mock;
    let client;
    let flakyCalls = 0;

    before(async () => {
        mock = await startMockOracle((_req, res) => {
            // The first request after "idle" answers 503 like the free hosting tier.
            flakyCalls += 1;
            return flakyCalls === 1
                ? res.status(503).json({ error: 'starting' })
                : res.json({ ok: true, calls: flakyCalls });
        });
        client = new sdk.EnrgClient({ baseUrl: mock.url, timeoutMs: 5000, retries: 1 });
    });

    after(async () => mock.close());

    it('reads the public metrics and the oracle network', async () => {
        const stats = await client.stats();
        assert.strictEqual(stats.minted_proofs, 15);
        const oracles = await client.oracles();
        assert.strictEqual(oracles.counts.registered, 2);
    });

    it('passes filter parameters through to /api/v1/proofs', async () => {
        const proofs = await client.proofs({ deviceId: 'EAv5NDihqp2JyH4JpZqg9QkMpqxDFBskWdt56YDRmFm2', limit: 5 });
        assert.strictEqual(proofs.device_id, 'EAv5NDihqp2JyH4JpZqg9QkMpqxDFBskWdt56YDRmFm2');
    });

    it('reads a real-looking balance and history for a device', async () => {
        const balance = await client.deviceBalance('EAv5NDihqp2JyH4JpZqg9QkMpqxDFBskWdt56YDRmFm2');
        assert.strictEqual(balance.balance, 0.000536313);
        const history = await client.deviceHistory('EAv5NDihqp2JyH4JpZqg9QkMpqxDFBskWdt56YDRmFm2', { limit: 5 });
        assert.strictEqual(history.count, 1);
    });

    it('maps a 404 to EnrgApiError carrying the status and the body', async () => {
        await assert.rejects(
            () => client.deviceStatus('11111111111111111111111111111111'),
            (e) => e instanceof sdk.EnrgApiError && e.status === 404 && /device not found/.test(e.body.error)
        );
    });

    it('retries a 503 (the free hosting tier wakes up slowly)', async () => {
        const result = await client.request('/flaky');
        assert.strictEqual(result.ok, true);
        assert.ok(flakyCalls >= 2, 'the client must have retried after the 503');
    });
});
