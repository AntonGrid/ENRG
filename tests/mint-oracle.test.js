'use strict';

/**
 * Multi-owner mint tests (ADR-0003 / multi-oracle flow).
 *
 * On-chain authorization (mint_submitter_authorized) is covered by Rust unit tests.
 * Here — the oracle side at the cryptography level:
 *   - the OracleReport is signed with the ORACLE key (ORACLE_KEY), not the founder;
 *   - the signature is verified with the oracle public key from the report (like on-chain C-0/C-2);
 *   - a report signed with the founder key does NOT pass for another oracle;
 *   - mirror of mint_submitter_authorized: signer = owner OR report.oracle.
 */

const assert = require('assert');
const nacl = require('tweetnacl');
const { Keypair, PublicKey } = require('@solana/web3.js');

const policy = require('../policy');

/** Mirror of the on-chain mint_submitter_authorized (mint.rs). */
function mintSubmitterAuthorized(producerAuthority, submitter, reportOracle) {
    return producerAuthority === submitter || reportOracle === submitter;
}

describe('Multi-oracle mint (ADR-0003) — crypto/oracle side', function () {
    let oracleKp;      // oracle key (in the OracleRegistry)
    let founderKp;     // founder key (MUST NOT be used for minting)
    let deviceKp;
    let deviceIdPubkey;
    const nonce = 1;
    const deviceTimestamp = 1_700_000_000;
    const verifiedAt = 1_700_000_100;
    const energyWh = 1000;

    beforeEach(function () {
        oracleKp = Keypair.generate();
        founderKp = Keypair.generate();
        deviceKp = Keypair.generate();
        deviceIdPubkey = new PublicKey(deviceKp.publicKey.toBytes());
    });

    function buildReport(oraclePub, oracleSecret) {
        const deviceMsg = policy.buildDeviceMessage(deviceIdPubkey, nonce, deviceTimestamp, energyWh);
        const oracleMsg = policy.buildOracleMessage(deviceIdPubkey, nonce, deviceTimestamp, verifiedAt, energyWh);
        const deviceSig = nacl.sign.detached(deviceMsg, deviceKp.secretKey);
        const oracleSig = nacl.sign.detached(oracleMsg, oracleSecret);
        return {
            oracle: oraclePub,
            deviceMsg, oracleMsg, deviceSig, oracleSig,
        };
    }

    it('a report signed by the ORACLE verifies with its public key (like on-chain)', function () {
        const r = buildReport(oracleKp.publicKey, oracleKp.secretKey);
        const ok = nacl.sign.detached.verify(r.oracleMsg, r.oracleSig, oracleKp.publicKey.toBytes());
        assert.strictEqual(ok, true, 'the oracle signature must match');
        const devOk = nacl.sign.detached.verify(r.deviceMsg, r.deviceSig, deviceKp.publicKey.toBytes());
        assert.strictEqual(devOk, true, 'the device signature must match');
    });

    it('a report signed with the FOUNDER key does NOT pass for the oracle key (mint ≠ founder)', function () {
        const r = buildReport(oracleKp.publicKey, founderKp.secretKey); // oracle claimed, but signed by the founder
        const ok = nacl.sign.detached.verify(r.oracleMsg, r.oracleSig, oracleKp.publicKey.toBytes());
        assert.strictEqual(ok, false, 'the founder cannot sign for an oracle');
    });

    it('mint_submitter_authorized: owner or report.oracle → true', function () {
        const owner = Keypair.generate().publicKey.toBase58();
        const oracle = oracleKp.publicKey.toBase58();
        const stranger = Keypair.generate().publicKey.toBase58();
        // the owner signs the transaction
        assert.strictEqual(mintSubmitterAuthorized(owner, owner, oracle), true);
        // the oracle (report.oracle) signs the transaction — multi-owner flow
        assert.strictEqual(mintSubmitterAuthorized(owner, oracle, oracle), true);
        // a third party — not allowed
        assert.strictEqual(mintSubmitterAuthorized(owner, stranger, oracle), false);
    });

    it('getOracleKeypair loads the key from env (end-to-end: report signed with the oracle key)', function () {
        const saved = process.env.ORACLE_KEY;
        process.env.ORACLE_KEY = JSON.stringify(Array.from(oracleKp.secretKey));
        try {
            const loaded = policy.getOracleKeypair();
            assert.ok(loaded);
            const r = buildReport(loaded.publicKey, loaded.secretKey);
            const ok = nacl.sign.detached.verify(r.oracleMsg, r.oracleSig, loaded.publicKey.toBytes());
            assert.strictEqual(ok, true);
        } finally {
            if (saved === undefined) delete process.env.ORACLE_KEY; else process.env.ORACLE_KEY = saved;
        }
    });
});
