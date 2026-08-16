// Универсальное хранилище ENRG-оракула (M-2).
//
//   - Если задана DATABASE_URL (postgres://user:pass@host:5432/enrg) —
//     используется PostgreSQL (репликация/бэкапы на стороне кластера).
//   - Иначе — SQLite (better-sqlite3) для обратной совместимости
//     и локальной разработки.
//
// Интерфейс полностью асинхронный, чтобы один и тот же код работал с обоими
// бэкендами. Таблицы: devices, energy_store, pools (та же схема, что была у
// SQLite; числовые поля BIGINT, device_energy — JSON-строка).

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
            log('Postgres storage ready (DATABASE_URL)');
        } else {
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, public_key TEXT);
                CREATE TABLE IF NOT EXISTS energy_store (device_id TEXT PRIMARY KEY, energy_wh INTEGER, nonce INTEGER);
                CREATE TABLE IF NOT EXISTS pools (pool_id TEXT PRIMARY KEY, threshold INTEGER, total_energy INTEGER, device_energy TEXT, created_at INTEGER);
            `);
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
}

module.exports = new Storage();
