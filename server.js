const express = require('express');
const path = require('path');
const nacl = require('tweetnacl');
const Database = require('better-sqlite3');
const winston = require('winston');
const { body, validationResult } = require('express-validator');
const { Connection, clusterApiUrl, Keypair, Transaction, TransactionInstruction, PublicKey, sendAndConfirmTransaction, SystemProgram } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token');
const crypto = require('crypto');
const cors = require('cors');

// Настройка winston
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

// Подключение к SQLite
const db = new Database('./enrg.db');

// Создание таблиц
db.exec(`
    CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, public_key TEXT);
    CREATE TABLE IF NOT EXISTS energy_store (device_id TEXT PRIMARY KEY, energy_wh INTEGER, nonce INTEGER);
    CREATE TABLE IF NOT EXISTS pools (pool_id TEXT PRIMARY KEY, threshold INTEGER, total_energy INTEGER, device_energy TEXT, created_at INTEGER);
`);

const PROGRAM_ID = new PublicKey('8JEw3eD7NgboNYcQQwoSsTG7UF8RrQpRnJzouDr6XQ8a');
const MINT_ADDRESS = 'HzAWLdrMZiS2wEsnZc6hHmg4CdAZM4CaYMYv53BYqw6G';
const FOUNDER_WALLET = '842fG4hkaVuNeaMLdrur4HZMjsgp8R8tMY6NDHrkYQod';

const DEVICES_FILE = path.join(__dirname, 'oracle', 'devices.json');
const ENERGY_STORE_FILE = path.join(__dirname, 'oracle', 'energy_store.json');
const POOLS_FILE = path.join(__dirname, 'oracle', 'pools.json');

let devices = {};
let energyStore = {};
let pools = {};

function loadJson(filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.warn('⚠️ Could not load', filePath, ':', e.message);
        return {};
    }
}

// Функции для работы с SQLite
function loadDevices() {
    const stmt = db.prepare('SELECT device_id, public_key FROM devices');
    const rows = stmt.all();
    return rows.reduce((acc, row) => {
        acc[row.device_id] = row.public_key;
        return acc;
    }, {});
}

function loadEnergyStore() {
    const stmt = db.prepare('SELECT device_id, energy_wh, nonce FROM energy_store');
    const rows = stmt.all();
    return rows.reduce((acc, row) => {
        acc[row.device_id] = { energy_wh: row.energy_wh, nonce: row.nonce };
        return acc;
    }, {});
}

function loadPools() {
    const stmt = db.prepare('SELECT pool_id, threshold, total_energy, device_energy, created_at FROM pools');
    const rows = stmt.all();
    return rows.reduce((acc, row) => {
        acc[row.pool_id] = {
            threshold: row.threshold,
            total_energy: row.total_energy,
            device_energy: row.device_energy ? JSON.parse(row.device_energy) : {},
            created_at: row.created_at
        };
        return acc;
    }, {});
}

function saveDevice(device_id, public_key) {
    const stmt = db.prepare('INSERT OR REPLACE INTO devices (device_id, public_key) VALUES (?, ?)');
    stmt.run(device_id, public_key);
}

function saveEnergy(device_id, energy_wh, nonce) {
    const stmt = db.prepare('INSERT OR REPLACE INTO energy_store (device_id, energy_wh, nonce) VALUES (?, ?, ?)');
    stmt.run(device_id, energy_wh, nonce);
}

function savePool(pool_id, threshold, total_energy, device_energy, created_at) {
    const stmt = db.prepare('INSERT OR REPLACE INTO pools (pool_id, threshold, total_energy, device_energy, created_at) VALUES (?, ?, ?, ?, ?)');
    stmt.run(pool_id, threshold, total_energy, JSON.stringify(device_energy), created_at);
}

let devices = loadDevices();
let energyStore = loadEnergyStore();
let pools = loadPools();

logger.info('✅ Loaded devices:', devices);
logger.info('✅ Loaded pools:', pools);

// Загрузка ключа основателя
let founderKeypair = null;
if (process.env.FOUNDER_KEY) {
    try {
        const arr = JSON.parse(process.env.FOUNDER_KEY);
        founderKeypair = Keypair.fromSecretKey(Uint8Array.from(arr));
        logger.info('✅ Loaded founder keypair from FOUNDER_KEY env var');
    } catch (e) {
        logger.warn('⚠️ Failed to parse FOUNDER_KEY:', e.message);
    }
}
if (!founderKeypair) {
    logger.warn('⚠️ Founder keypair not found. Minting will not work.');
}

const app = express();
app.use(express.json());
app.use(cors({
    origin: ['https://enrg.network', 'https://www.enrg.network', 'http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.static(path.join(__dirname, 'web')));

// Остальной код...