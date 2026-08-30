// Universal storage for the ENRG oracle (M-2).
//
//   - When DATABASE_URL is set (postgres://user:pass@host:5432/enrg) —
//     PostgreSQL is used (replication/backups handled by the cluster).
//   - Otherwise — SQLite (better-sqlite3) for backward compatibility
//     and local development.
//
// The interface is fully async so the same code works with both
// backends. Tables: devices, energy_store, pools (the same schema as
// SQLite; numeric fields BIGINT, device_energy — JSON string).

const { Pool } = require('pg');
const Database = require('better-sqlite3');

function log(...a) { console.log('[storage]', ...a); }
function warn(...a) { console.warn('[storage]', ...a); }
function error(...a) { console.error('[storage]', ...a); }

class Storage {
    constructor() {
        this.backend = process.env.DATABASE_URL ? 'postgres' : 'sqlite';
        if (this.backend === 'postgres') {
            this.pg = new Pool({ connectionString: process.env.DATABASE_URL });
        } else {
            this.sqlitePath = process.env.ENRG_SQLITE_PATH || './enrg.db';
            this.db = new Database(this.sqlitePath);
        }
    }

    get name() { return this.backend; }

    async init() {
        if (this.backend === 'postgres') {
            await this.pg.query(
                'CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, public_key TEXT)'
            );
            await this.pg.query(
                'CREATE TABLE IF NOT EXISTS energy_store (device_id TEXT PRIMARY KEY, energy_wh BIGINT, nonce BIGINT)'
            );
            await this.pg.query(
                'CREATE TABLE IF NOT EXISTS pools (pool_id TEXT PRIMARY KEY, threshold BIGINT, total_energy BIGINT, device_energy TEXT, created_at BIGINT)'
            );
            await this.pg.query(
                'CREATE TABLE IF NOT EXISTS proofs (id BIGSERIAL PRIMARY KEY, device_id TEXT, ts BIGINT, energy_wh BIGINT, nonce BIGINT, mint_tx TEXT, mint_status TEXT, proof_json TEXT)'
            );
            // P0-2 (audit 2026-08-30): migration for pre-existing deployments —
            // add proof_json for the mint queue recovery (drain after restart).
            await this.pg.query(
                "ALTER TABLE proofs ADD COLUMN IF NOT EXISTS proof_json TEXT"
            ).catch(() => {});
            log('Postgres storage ready (DATABASE_URL)');
        } else {
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, public_key TEXT);
                CREATE TABLE IF NOT EXISTS energy_store (device_id TEXT PRIMARY KEY, energy_wh INTEGER, nonce INTEGER);
                CREATE TABLE IF NOT EXISTS pools (pool_id TEXT PRIMARY KEY, threshold INTEGER, total_energy INTEGER, device_energy TEXT, created_at INTEGER);
                CREATE TABLE IF NOT EXISTS proofs (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT, ts INTEGER, energy_wh INTEGER, nonce INTEGER, mint_tx TEXT, mint_status TEXT, proof_json TEXT);
            `);
            // P0-2: SQLite migration for pre-existing databases.
            const cols = this.db.prepare("PRAGMA table_info(proofs)").all();
            if (!cols.some((c) => c.name === 'proof_json')) {
                this.db.exec('ALTER TABLE proofs ADD COLUMN proof_json TEXT');
            }
            log(`SQLite storage ready (${this.sqlitePath})`);
        }
    }

    async loadDevices() {
        if (this.backend === 'postgres') {
            const { rows } = await this.pg.query('SELECT device_id, public_key FROM devices');
            return rows.reduce((acc, r) => { acc[r.device_id] = r.public_key; return acc; }, {});
        }
        const rows = this.db.prepare('SELECT device_id, public_key FROM devices').all();
        return rows.reduce((acc, r) => { acc[r.device_id] = r.public_key; return acc; }, {});
    }

    async loadEnergyStore() {
        if (this.backend === 'postgres') {
            const { rows } = await this.pg.query('SELECT device_id, energy_wh, nonce FROM energy_store');
            return rows.reduce((acc, r) => {
                acc[r.device_id] = { energy_wh: Number(r.energy_wh) || 0, nonce: Number(r.nonce) || 0 };
                return acc;
            }, {});
        }
        const rows = this.db.prepare('SELECT device_id, energy_wh, nonce FROM energy_store').all();
        return rows.reduce((acc, r) => {
            acc[r.device_id] = { energy_wh: r.energy_wh, nonce: r.nonce };
            return acc;
        }, {});
    }

    async loadPools() {
        if (this.backend === 'postgres') {
            const { rows } = await this.pg.query(
                'SELECT pool_id, threshold, total_energy, device_energy, created_at FROM pools'
            );
            return rows.reduce((acc, r) => {
                acc[r.pool_id] = {
                    threshold: Number(r.threshold) || 0,
                    total_energy: Number(r.total_energy) || 0,
                    device_energy: r.device_energy ? JSON.parse(r.device_energy) : {},
                    created_at: Number(r.created_at) || 0,
                };
                return acc;
            }, {});
        }
        const rows = this.db.prepare('SELECT pool_id, threshold, total_energy, device_energy, created_at FROM pools').all();
        return rows.reduce((acc, r) => {
            acc[r.pool_id] = {
                threshold: r.threshold,
                total_energy: r.total_energy,
                device_energy: r.device_energy ? JSON.parse(r.device_energy) : {},
                created_at: r.created_at,
            };
            return acc;
        }, {});
    }

    async saveDevice(device_id, public_key) {
        if (this.backend === 'postgres') {
            await this.pg.query(
                'INSERT INTO devices (device_id, public_key) VALUES ($1, $2) ON CONFLICT (device_id) DO UPDATE SET public_key = EXCLUDED.public_key',
                [device_id, public_key]
            );
            return;
        }
        this.db.prepare('INSERT OR REPLACE INTO devices (device_id, public_key) VALUES (?, ?)').run(device_id, public_key);
    }

    async saveEnergy(device_id, energy_wh, nonce) {
        if (this.backend === 'postgres') {
            await this.pg.query(
                'INSERT INTO energy_store (device_id, energy_wh, nonce) VALUES ($1, $2, $3) ON CONFLICT (device_id) DO UPDATE SET energy_wh = EXCLUDED.energy_wh, nonce = EXCLUDED.nonce',
                [device_id, energy_wh, nonce]
            );
            return;
        }
        this.db.prepare('INSERT OR REPLACE INTO energy_store (device_id, energy_wh, nonce) VALUES (?, ?, ?)').run(device_id, energy_wh, nonce);
    }

    async savePool(pool_id, threshold, total_energy, device_energy, created_at) {
        if (this.backend === 'postgres') {
            await this.pg.query(
                'INSERT INTO pools (pool_id, threshold, total_energy, device_energy, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (pool_id) DO UPDATE SET threshold = EXCLUDED.threshold, total_energy = EXCLUDED.total_energy, device_energy = EXCLUDED.device_energy, created_at = EXCLUDED.created_at',
                [pool_id, threshold, total_energy, JSON.stringify(device_energy), created_at]
            );
            return;
        }
        this.db.prepare('INSERT OR REPLACE INTO pools (pool_id, threshold, total_energy, device_energy, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(pool_id, threshold, total_energy, JSON.stringify(device_energy), created_at);
    }

    async saveProof(device_id, ts, energy_wh, nonce, mint_tx, mint_status, proof_json = null) {
        if (this.backend === 'postgres') {
            await this.pg.query(
                'INSERT INTO proofs (device_id, ts, energy_wh, nonce, mint_tx, mint_status, proof_json) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [device_id, ts, energy_wh, nonce, mint_tx, mint_status, proof_json]
            );
            return;
        }
        this.db.prepare('INSERT INTO proofs (device_id, ts, energy_wh, nonce, mint_tx, mint_status, proof_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(device_id, ts, energy_wh, nonce, mint_tx, mint_status, proof_json);
    }

    async updateProofStatus(device_id, nonce, mint_tx, mint_status) {
        if (this.backend === 'postgres') {
            await this.pg.query(
                'UPDATE proofs SET mint_tx = $3, mint_status = $4 WHERE device_id = $1 AND nonce = $2',
                [device_id, nonce, mint_tx, mint_status]
            );
            return;
        }
        this.db.prepare('UPDATE proofs SET mint_tx = ?, mint_status = ? WHERE device_id = ? AND nonce = ?')
            .run(mint_tx, mint_status, device_id, nonce);
    }

    async loadProofs(device_id = null, limit = 100) {
        if (this.backend === 'postgres') {
            const params = [];
            let sql = 'SELECT device_id, ts, energy_wh, nonce, mint_tx, mint_status, proof_json FROM proofs';
            if (device_id) { sql += ' WHERE device_id = $1'; params.push(device_id); }
            sql += ' ORDER BY id DESC LIMIT ' + Math.min(limit, 1000);
            const { rows } = await this.pg.query(sql, params);
            return rows;
        }
        if (device_id) {
            return this.db.prepare(
                'SELECT device_id, ts, energy_wh, nonce, mint_tx, mint_status, proof_json FROM proofs WHERE device_id = ? ORDER BY id DESC LIMIT ?'
            ).all(device_id, Math.min(limit, 1000));
        }
        return this.db.prepare(
            'SELECT device_id, ts, energy_wh, nonce, mint_tx, mint_status, proof_json FROM proofs ORDER BY id DESC LIMIT ?'
        ).all(Math.min(limit, 1000));
    }

    /**
     * P0-2 (audit 2026-08-30): proofs accepted by the verifier but not yet
     * minted on-chain. Used by the mint queue to resume after a restart.
     * Oldest first (FIFO), capped to avoid unbounded memory on startup.
     */
    async loadPendingProofs(limit = 10000) {
        const cap = Math.min(limit, 50000);
        if (this.backend === 'postgres') {
            const { rows } = await this.pg.query(
                "SELECT device_id, ts, energy_wh, nonce, mint_tx, mint_status, proof_json FROM proofs WHERE mint_status = 'accepted' ORDER BY id ASC LIMIT $1",
                [cap]
            );
            return rows;
        }
        return this.db.prepare(
            "SELECT device_id, ts, energy_wh, nonce, mint_tx, mint_status, proof_json FROM proofs WHERE mint_status = 'accepted' ORDER BY id ASC LIMIT ?"
        ).all(cap);
    }

    // Ecosystem stats aggregated from the proofs table — the single source of
    // truth for verified energy (ADR-0010 data bridge). Used by /api/v1/stats.
    async loadStats() {
        if (this.backend === 'postgres') {
            const { rows } = await this.pg.query(`
                SELECT
                    COUNT(*) AS total_proofs,
                    COUNT(*) FILTER (WHERE mint_status = 'minted') AS minted_proofs,
                    COUNT(*) FILTER (WHERE mint_status = 'deferred') AS deferred_proofs,
                    COUNT(*) FILTER (WHERE mint_status = 'accepted') AS accepted_proofs,
                    COALESCE(SUM(energy_wh), 0) AS total_energy_wh,
                    COALESCE(SUM(energy_wh) FILTER (WHERE mint_status = 'minted'), 0) AS minted_energy_wh,
                    COUNT(DISTINCT device_id) AS active_producers,
                    COALESCE(MAX(ts), 0) AS last_proof_ts
                FROM proofs
            `);
            const r = rows[0] || {};
            return {
                total_proofs: Number(r.total_proofs) || 0,
                minted_proofs: Number(r.minted_proofs) || 0,
                deferred_proofs: Number(r.deferred_proofs) || 0,
                accepted_proofs: Number(r.accepted_proofs) || 0,
                total_energy_wh: Number(r.total_energy_wh) || 0,
                minted_energy_wh: Number(r.minted_energy_wh) || 0,
                active_producers: Number(r.active_producers) || 0,
                last_proof_ts: Number(r.last_proof_ts) || 0,
            };
        }
        const row = this.db.prepare(`
            SELECT
                COUNT(*) AS total_proofs,
                SUM(CASE WHEN mint_status = 'minted' THEN 1 ELSE 0 END) AS minted_proofs,
                SUM(CASE WHEN mint_status = 'deferred' THEN 1 ELSE 0 END) AS deferred_proofs,
                SUM(CASE WHEN mint_status = 'accepted' THEN 1 ELSE 0 END) AS accepted_proofs,
                COALESCE(SUM(energy_wh), 0) AS total_energy_wh,
                COALESCE(SUM(CASE WHEN mint_status = 'minted' THEN energy_wh ELSE 0 END), 0) AS minted_energy_wh,
                COUNT(DISTINCT device_id) AS active_producers,
                COALESCE(MAX(ts), 0) AS last_proof_ts
            FROM proofs
        `).get();
        return {
            total_proofs: Number(row.total_proofs) || 0,
            minted_proofs: Number(row.minted_proofs) || 0,
            deferred_proofs: Number(row.deferred_proofs) || 0,
            accepted_proofs: Number(row.accepted_proofs) || 0,
            total_energy_wh: Number(row.total_energy_wh) || 0,
            minted_energy_wh: Number(row.minted_energy_wh) || 0,
            active_producers: Number(row.active_producers) || 0,
            last_proof_ts: Number(row.last_proof_ts) || 0,
        };
    }
}

module.exports = new Storage();
