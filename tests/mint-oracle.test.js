'use strict';

/**
 * Тесты мульти-владельческого mint (ADR-0003 / мульти-оракульный flow).
 *
 * On-chain авторизация (mint_submitter_authorized) покрыта Rust-юнит-тестами.
 * Здесь — оракульная сторона на уровне криптографии:
 *   - OracleReport подписывается ключом ОРАКУЛА (ORACLE_KEY), а не founder;
 *   - подпись проверяется публичным ключом оракула из отчёта (как on-chain C-0/C-2);
 *   - отчёт, подписанный founder-ключом, НЕ проходит для чужого оракула;
 *   - зеркало mint_submitter_authorized: подписант = владелец ИЛИ report.oracle.
 */

const assert = require('assert');
const nacl = require('tweetnacl');
const { Keypair, PublicKey } = require('@solana/web3.js');

const policy = require('../policy');

/** Зеркало on-chain mint_submitter_authorized (mint.rs). */
function mintSubmitterAuthorized(producerAuthority, submitter, reportOracle) {
    return producerAuthority === submitter || reportOracle === submitter;
}

describe('Multi-oracle mint (ADR-0003) — crypto/oracle side', function () {
    let oracleKp;      // ключ оракула (в OracleRegistry)
    let founderKp;     // ключ основателя (НЕ должен использоваться для mint)
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

    it('отчёт, подписанный ОРАКУЛОМ, верифицируется его публичным ключом (как on-chain)', function () {
        const r = buildReport(oracleKp.publicKey, oracleKp.secretKey);
        const ok = nacl.sign.detached.verify(r.oracleMsg, r.oracleSig, oracleKp.publicKey.toBytes());
        assert.strictEqual(ok, true, 'подпись оракула должна сходиться');
        const devOk = nacl.sign.detached.verify(r.deviceMsg, r.deviceSig, deviceKp.publicKey.toBytes());
        assert.strictEqual(devOk, true, 'подпись устройства должна сходиться');
    });

    it('отчёт, подписанный FOUNDER-ключом, НЕ проходит для ключа оракула (mint ≠ founder)', function () {
        const r = buildReport(oracleKp.publicKey, founderKp.secretKey); // оракул заявлен, но подписано founder
        const ok = nacl.sign.detached.verify(r.oracleMsg, r.oracleSig, oracleKp.publicKey.toBytes());
        assert.strictEqual(ok, false, 'founder не может подписать за оракула');
    });

    it('mint_submitter_authorized: владелец или report.oracle → true', function () {
        const owner = Keypair.generate().publicKey.toBase58();
        const oracle = oracleKp.publicKey.toBase58();
        const stranger = Keypair.generate().publicKey.toBase58();
        // владелец подписывает транзакцию
        assert.strictEqual(mintSubmitterAuthorized(owner, owner, oracle), true);
        // оракул (report.oracle) подписывает транзакцию — мульти-владельческий flow
        assert.strictEqual(mintSubmitterAuthorized(owner, oracle, oracle), true);
        // посторонний — нет
        assert.strictEqual(mintSubmitterAuthorized(owner, stranger, oracle), false);
    });

    it('getOracleKeypair загружает ключ из env (end-to-end: подпись отчёта ключом оракула)', function () {
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
