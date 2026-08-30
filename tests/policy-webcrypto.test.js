'use strict';

/**
 * P2-1a (audit 2026-08-30): WebCrypto Ed25519 verification path.
 *
 * validateProofAsync must behave identically to validateProof (same check
 * order, same HTTP codes), but verify the device signature with native
 * node:crypto WebCrypto instead of tweetnacl — ~100x faster on the hot path.
 */

const assert = require('assert');
const nacl = require('tweetnacl');
const { Keypair, PublicKey } = require('@solana/web3.js');
const policy = require('../policy');

function makeDevice() {
    const kp = nacl.sign.keyPair();
    const deviceIdPubkey = new PublicKey(kp.publicKey);
    const base58 = deviceIdPubkey.toBase58();
    const ctx = {
        getPublicKey: () => Buffer.from(kp.publicKey).toString('base64'),
        getLastNonce: () => 0,
        nowSec: 1_700_000_000,
    };
    return { kp, deviceIdPubkey, base58, ctx };
}

function makeBinaryProof(device, nonce, ts, energyWh) {
    const msg = policy.buildDeviceMessage(device.deviceIdPubkey, nonce, ts, energyWh);
    const sig = nacl.sign.detached(msg, device.kp.secretKey);
    return {
        device_id: device.base58,
        timestamp: ts,
        energyWh,
        nonce,
        signature: Buffer.from(sig).toString('base64'),
    };
}

describe('Policy Engine — WebCrypto validation (P2-1a)', function () {
    it('accepts a valid binary proof (same result as tweetnacl path)', async () => {
        const device = makeDevice();
        const proof = makeBinaryProof(device, 1, device.ctx.nowSec - 5, 100);

        const sync = policy.validateProof(proof, device.ctx);
        const asyncRes = await policy.validateProofAsync(proof, device.ctx);

        assert.ok(sync.ok);
        assert.ok(asyncRes.ok);
        assert.strictEqual(asyncRes.proof.sig_mode, 'binary');
        assert.strictEqual(asyncRes.proof.energy_wh, 100);
    });

    it('rejects an invalid signature (tampered proof)', async () => {
        const device = makeDevice();
        const proof = makeBinaryProof(device, 1, device.ctx.nowSec - 5, 100);
        proof.energyWh = 999; // invalidates the signature

        const sync = policy.validateProof(proof, device.ctx);
        const asyncRes = await policy.validateProofAsync(proof, device.ctx);
        assert.strictEqual(sync.status, 401);
        assert.strictEqual(asyncRes.status, 401);
    });

    it('rejects a stale timestamp (same codes)', async () => {
        const device = makeDevice();
        const proof = makeBinaryProof(device, 1, device.ctx.nowSec - 5000, 100); // older than 900s
        const asyncRes = await policy.validateProofAsync(proof, device.ctx);
        assert.strictEqual(asyncRes.status, 400);
        assert.strictEqual(asyncRes.error, 'StaleProof');
    });

    it('rejects a replayed nonce', async () => {
        const device = makeDevice();
        const proof = makeBinaryProof(device, 5, device.ctx.nowSec - 5, 100);
        const ctx = { ...device.ctx, getLastNonce: () => 5 }; // nonce not strictly greater
        const asyncRes = await policy.validateProofAsync(proof, ctx);
        assert.strictEqual(asyncRes.status, 400);
        assert.strictEqual(asyncRes.error, 'InvalidNonce');
    });

    it('rejects a missing public key (unknown device)', async () => {
        const device = makeDevice();
        const proof = makeBinaryProof(device, 1, device.ctx.nowSec - 5, 100);
        const ctx = { ...device.ctx, getPublicKey: () => null };
        const asyncRes = await policy.validateProofAsync(proof, ctx);
        assert.strictEqual(asyncRes.status, 400);
        assert.strictEqual(asyncRes.error, 'unknown device');
    });

    it('accepts an aggregated proof (P3-2, firmware aggregation window)', async () => {
        // A device running P3-1 signs ONE proof per window with energy_wh =
        // the accumulated value (e.g. 0.5 MWh). The oracle mints it directly.
        const device = makeDevice();
        const aggWh = 500_000; // 0.5 MWh aggregated
        const proof = makeBinaryProof(device, 7, device.ctx.nowSec - 5, aggWh);
        const res = await policy.validateProofAsync(proof, device.ctx);
        assert.ok(res.ok, `aggregated proof must pass: ${JSON.stringify(res)}`);
        assert.strictEqual(res.proof.energy_wh, aggWh);
    });
});
