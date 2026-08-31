'use strict';

/**
 * Unit tests for the oracle quorum message/hash helpers (P3-6) in policy.js.
 *
 * Run:  npx mocha tests/oracle-quorum.test.js
 * Coverage: SHA-256 proof hash of the oracle report message and the
 *           canonical attestation-vote message (byte layout must match
 *           state/oracle_attestation.rs / state/oracle.rs).
 */

const assert = require('assert');
const crypto = require('crypto');
const { PublicKey } = require('@solana/web3.js');

const policy = require('../policy');

const PREFIX = Buffer.from('enrg:oracle:attest', 'utf8');

describe('oracle quorum (P3-6)', () => {
  it('proofHashOf == SHA-256(oracle_message)', () => {
    const device = new PublicKey(Buffer.alloc(32, 2));
    const oracleMsg = policy.buildOracleMessage(device, 7, 1700000000, 1700000050, 1250);
    const expected = crypto.createHash('sha256').update(oracleMsg).digest();
    assert.deepStrictEqual(policy.proofHashOf(oracleMsg), expected);
    assert.strictEqual(policy.proofHashOf(oracleMsg).length, 32);
  });

  it('buildAttestMessage layout: prefix(18) || device(32) || nonce(8 LE) || hash(32)', () => {
    const device = new PublicKey(Buffer.alloc(32, 3));
    const hash = Buffer.alloc(32, 7);
    const msg = policy.buildAttestMessage(device, 9, hash);
    assert.strictEqual(msg.length, 18 + 32 + 8 + 32);
    assert.deepStrictEqual(msg.slice(0, 18), PREFIX);
    assert.deepStrictEqual(msg.slice(18, 50), Buffer.from(device.toBytes()));
    assert.deepStrictEqual(msg.slice(50, 58), Buffer.from([9, 0, 0, 0, 0, 0, 0, 0]));
    assert.deepStrictEqual(msg.slice(58, 90), hash);
  });

  it('attest message + proof hash are deterministic (cross-check)', () => {
    const device = new PublicKey(Buffer.alloc(32, 5));
    const oracleMsg = policy.buildOracleMessage(device, 42, 1, 2, 100);
    const proofHash = policy.proofHashOf(oracleMsg);
    const msg1 = policy.buildAttestMessage(device, 42, proofHash);
    const msg2 = policy.buildAttestMessage(device, 42, proofHash);
    assert.deepStrictEqual(msg1, msg2);
    // different nonce → different vote message (cannot be replayed across proofs)
    const msg3 = policy.buildAttestMessage(device, 43, proofHash);
    assert.ok(!msg1.equals(msg3));
  });
});
