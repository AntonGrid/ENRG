'use strict';

/**
 * P0-2 (audit 2026-08-30): mint queue persistence.
 *
 * The /proof/submit handler now enqueues mints instead of awaiting them.
 * Proofs are persisted with mint_status='accepted' + proof_json so the queue
 * survives restarts (drain in bootstrap()). This suite tests the storage side:
 *  - the proofs table gains a proof_json column (SQLite migration path);
 *  - saveProof persists proof_json;
 *  - loadPendingProofs returns only 'accepted' rows (FIFO);
 *  - updateProofStatus moves a row to minted/deferred.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Fresh SQLite DB per run so migration (PRAGMA table_info) is exercised.
const tmpDb = path.join(os.tmpdir(), `enrg-queue-test-${process.pid}.db`);
process.env.ENRG_SQLITE_PATH = tmpDb;
delete process.env.DATABASE_URL;

const storage = require('../storage');

const PROOF_JSON = JSON.stringify({
    device_id: '0xdeadbeef',
    device_id_pubkey: 'abc',
    nonce: 7,
    device_timestamp: 1722000000,
    energy_wh: 1000,
    device_signature: [1, 2, 3],
    sig_mode: 'binary',
});

describe('Mint queue storage (P0-2)', function () {
    this.timeout(10000);

    before(async () => {
        await storage.init();
    });

    after(() => {
        try { fs.unlinkSync(tmpDb); } catch {}
    });

    it('proofs table has a proof_json column (migration applied)', async () => {
        const cols = storage.db.prepare('PRAGMA table_info(proofs)').all();
        assert.ok(cols.some((c) => c.name === 'proof_json'), 'proof_json column must exist');
    });

    it('saveProof persists proof_json; loadPendingProofs returns accepted rows FIFO', async () => {
        await storage.saveProof('dev-1', 1722000000, 500, 1, null, 'accepted', PROOF_JSON);
        await storage.saveProof('dev-1', 1722000001, 500, 2, null, 'accepted', '{"x":1}');

        const pending = await storage.loadPendingProofs();
        assert.strictEqual(pending.length, 2);
        // FIFO: oldest first.
        assert.strictEqual(pending[0].nonce, 1);
        assert.strictEqual(pending[1].nonce, 2);
        // proof_json round-trip.
        assert.deepStrictEqual(JSON.parse(pending[0].proof_json), JSON.parse(PROOF_JSON));
    });

    it('updateProofStatus moves a row out of the pending set', async () => {
        await storage.updateProofStatus('dev-1', 1, 'tx-abc', 'minted');
        const pending = await storage.loadPendingProofs();
        assert.strictEqual(pending.length, 1);
        assert.strictEqual(pending[0].nonce, 2);

        await storage.updateProofStatus('dev-1', 2, null, 'deferred');
        const pending2 = await storage.loadPendingProofs();
        assert.strictEqual(pending2.length, 0);
    });

    it('loadProofs exposes proof_json to consumers (/api/v1/proofs)', async () => {
        const rows = await storage.loadProofs('dev-1');
        assert.strictEqual(rows.length, 2);
        assert.ok('proof_json' in rows[0], 'loadProofs must include proof_json');
    });

    it('persists oracle_id and aggregates per-oracle stats (P3-5)', async () => {
        // Fresh oracle-attributed rows.
        await storage.saveProof('dev-ora-a', 1722000100, 1000, 11, null, 'accepted', '{}', 'ora-AAA');
        await storage.saveProof('dev-ora-a', 1722000101, 2000, 12, null, 'minted', '{}', 'ora-AAA');
        await storage.saveProof('dev-ora-b', 1722000102, 500, 13, null, 'minted', '{}', 'ora-BBB');

        const stats = await storage.loadOracleStats();
        const a = stats.find((s) => s.oracle_id === 'ora-AAA');
        const b = stats.find((s) => s.oracle_id === 'ora-BBB');

        assert.ok(a, 'oracle AAA present in stats');
        assert.strictEqual(a.total_proofs, 2);
        assert.strictEqual(a.minted_proofs, 1);
        assert.strictEqual(a.total_energy_wh, 3000);
        assert.strictEqual(a.minted_energy_wh, 2000);

        assert.ok(b, 'oracle BBB present in stats');
        assert.strictEqual(b.minted_proofs, 1);
        assert.strictEqual(b.total_energy_wh, 500);

        // loadProofs now carries oracle_id for per-proof attribution.
        const rows = await storage.loadProofs('dev-ora-a');
        assert.strictEqual(rows[0].oracle_id, 'ora-AAA');
    });
});
