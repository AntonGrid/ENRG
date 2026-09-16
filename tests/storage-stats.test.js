'use strict';

/**
 * P1-10 / P1-11 (audit 2026-09-16): what the oracle tells the world about its proofs.
 *
 * P1-11 — the public stats must count PROOFS, not attestation rows. A proof attested
 * by several oracles is stored once per oracle (that is the attestation record, and
 * `/api/v1/oracles` reports it per oracle), but `/api/v1/stats` aggregated over the
 * rows: the live pilot served `total_energy_wh: 60015` while its 21 distinct proofs
 * carry 30015 Wh — a 2x overstatement on every dashboard.
 *
 * P1-10 — a deferred proof must say WHY. The reason lived only in the log buffer, so
 * 12 deferred proofs of the live pilot (60 kWh) were indistinguishable from a policy
 * denial, a missing producer or a dead RPC.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Fresh SQLite DB per run: exercises the CREATE TABLE path *and* the migration.
const tmpDb = path.join(os.tmpdir(), `enrg-stats-test-${process.pid}.db`);
process.env.ENRG_SQLITE_PATH = tmpDb;
delete process.env.DATABASE_URL;

// The whole node suite runs in ONE mocha process and `storage.js` exports a
// singleton, so an earlier test file has already bound it to its own database —
// `require` would hand that instance over (and writing to it fails once that file is
// gone: "attempt to write a readonly database"). Drop the cached module so this
// suite owns a Storage instance on its own file.
delete require.cache[require.resolve('../storage')];
const storage = require('../storage');

const ORACLE_A = 'Hm7Ym7EFhJXcYnsGimHRHrmbJyHzY2sZVgA7CHrrEs4C';
const ORACLE_B = 'HC8WasTjgWYtdqmo9CFMo4EFbxibxSXjXHsRyse2FX77';
const DEVICE = '42MDSSrT2NbUhGMTDwLGPFxiPiTVjgtbSi5bQHHpmhJN';
const TS = 1788612834;

describe('Oracle stats and mint diagnostics (P1-10/P1-11)', function () {
    this.timeout(10000);

    before(async () => {
        await storage.init();
    });

    after(() => {
        try { storage.db.close(); } catch { /* already closed */ }
        try { fs.unlinkSync(tmpDb); } catch { /* already removed */ }
    });

    beforeEach(() => {
        storage.db.prepare('DELETE FROM proofs').run();
    });

    it('the proofs table carries mint_error and mint_attempts', () => {
        const cols = storage.db.prepare('PRAGMA table_info(proofs)').all().map((c) => c.name);
        assert.ok(cols.includes('mint_error'), `missing mint_error in ${cols}`);
        assert.ok(cols.includes('mint_attempts'), `missing mint_attempts in ${cols}`);
    });

    it('counts a proof attested by two oracles once', async () => {
        await storage.saveProof(DEVICE, TS, 5000, 1, null, 'deferred', '{}', ORACLE_A);
        await storage.saveProof(DEVICE, TS, 5000, 1, null, 'deferred', '{}', ORACLE_B);

        const s = await storage.loadStats();

        assert.strictEqual(s.total_proofs, 1);
        assert.strictEqual(s.total_energy_wh, 5000);
        assert.strictEqual(s.deferred_proofs, 1);
        assert.strictEqual(s.active_producers, 1);
        assert.strictEqual(s.attestation_rows, 2, 'the row count stays visible');
    });

    it('keeps a proof minted when another oracle row lags behind', async () => {
        await storage.saveProof(DEVICE, TS, 5000, 1, null, 'accepted', '{}', ORACLE_A);
        await storage.updateProofStatus(DEVICE, 1, 'txSig', 'minted');
        // The second oracle stores its own row afterwards without knowing about the mint.
        await storage.saveProof(DEVICE, TS, 5000, 1, null, 'accepted', '{}', ORACLE_B);

        const s = await storage.loadStats();

        assert.strictEqual(s.total_proofs, 1);
        assert.strictEqual(s.minted_proofs, 1);
        assert.strictEqual(s.minted_energy_wh, 5000);
        assert.strictEqual(s.accepted_proofs, 0);
        assert.strictEqual(s.deferred_proofs, 0);
    });

    it('counts distinct nonces separately and keeps the newest timestamp', async () => {
        await storage.saveProof(DEVICE, TS, 5000, 1, null, 'minted', '{}', ORACLE_A);
        await storage.saveProof(DEVICE, TS + 60, 1000, 2, null, 'deferred', '{}', ORACLE_A);

        const s = await storage.loadStats();

        assert.strictEqual(s.total_proofs, 2);
        assert.strictEqual(s.total_energy_wh, 6000);
        assert.strictEqual(s.minted_energy_wh, 5000);
        assert.strictEqual(s.deferred_proofs, 1);
        assert.strictEqual(s.last_proof_ts, TS + 60);
    });

    it('persists the mint failure reason and clears it on success', async () => {
        await storage.saveProof(DEVICE, TS, 5000, 1, null, 'accepted', '{}', ORACLE_A);
        await storage.updateProofStatus(DEVICE, 1, null, 'deferred', 'custom program error: 0x1772', 8);

        let [row] = await storage.loadProofs(DEVICE, 1);
        assert.strictEqual(row.mint_status, 'deferred');
        assert.strictEqual(row.mint_error, 'custom program error: 0x1772');
        assert.strictEqual(Number(row.mint_attempts), 8);

        await storage.updateProofStatus(DEVICE, 1, 'txSig', 'minted');
        [row] = await storage.loadProofs(DEVICE, 1);
        assert.strictEqual(row.mint_status, 'minted');
        assert.strictEqual(row.mint_error, null, 'a successful mint clears the error');
    });
});
