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
app.use(express.json({ limit: '1mb' }));

// === ВКЛЮЧАЕМ CORS (для доступа с сайта) ===
app.use(cors({
    origin: [
        'https://enrg.network',
        'https://www.enrg.network',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'null'
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

const ENERGY_THRESHOLD = 1000000;

const mint = new PublicKey(MINT_ADDRESS);
let producerPda, vaultPda, buyback, staking, dao, emergency, destination;

if (founderKeypair) {
    [producerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('producer'), founderKeypair.publicKey.toBuffer()],
        PROGRAM_ID
    );
    [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from('vault')], PROGRAM_ID);
    [buyback] = PublicKey.findProgramAddressSync([Buffer.from('buyback'), mint.toBuffer()], PROGRAM_ID);
    [staking] = PublicKey.findProgramAddressSync([Buffer.from('staking'), mint.toBuffer()], PROGRAM_ID);
    [dao] = PublicKey.findProgramAddressSync([Buffer.from('dao'), mint.toBuffer()], PROGRAM_ID);
    [emergency] = PublicKey.findProgramAddressSync([Buffer.from('emergency'), mint.toBuffer()], PROGRAM_ID);
    destination = getAssociatedTokenAddressSync(mint, founderKeypair.publicKey, false);
} else {
    producerPda = PublicKey.default;
    vaultPda = PublicKey.default;
    buyback = PublicKey.default;
    staking = PublicKey.default;
    dao = PublicKey.default;
    emergency = PublicKey.default;
    destination = PublicKey.default;
}

const getDisc = (name) => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

async function createProducerIfNeeded() {
    if (!founderKeypair) return false;
    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    const accountInfo = await connection.getAccountInfo(producerPda);
    if (accountInfo) {
        logger.info('✅ Producer already exists:', producerPda.toBase58());
        return true;
    }
    logger.info('🔄 Creating producer...');
    const deviceIdPubkey = new PublicKey('11111111111111111111111111111111');
    const maxPowerW = 600_000_000n;
    const data = Buffer.alloc(48);
    getDisc('create_producer').copy(data, 0);
    deviceIdPubkey.toBuffer().copy(data, 8);
    data.writeBigUInt64LE(maxPowerW, 40);
    const instruction = new TransactionInstruction({
        keys: [
            { pubkey: producerPda, isWritable: true, isSigner: false },
            { pubkey: founderKeypair.publicKey, isWritable: true, isSigner: true },
            { pubkey: SystemProgram.programId, isWritable: false, isSigner: false }
        ],
        programId: PROGRAM_ID,
        data
    });
    const tx = new Transaction().add(instruction);
    const sig = await sendAndConfirmTransaction(connection, tx, [founderKeypair]);
    logger.info('✅ Producer created. TX:', sig);
    return true;
}

async function mintEnergy(device_id, amount) {
    if (!founderKeypair) return { success: false, error: 'founder_key_missing' };
    try {
        const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
        const nonce = BigInt(Date.now());
        const timestamp = BigInt(Math.floor(Date.now() / 1000));
        const energyWh = BigInt(amount);
        const signature = Buffer.alloc(64);
        const proofBuffer = Buffer.alloc(88);
        let offset = 0;
        proofBuffer.writeBigUInt64LE(nonce, offset); offset += 8;
        proofBuffer.writeBigInt64LE(timestamp, offset); offset += 8;
        proofBuffer.writeBigUInt64LE(energyWh, offset); offset += 8;
        signature.copy(proofBuffer, offset);
        const disc = getDisc('mint_energy');
        const data = Buffer.concat([disc, proofBuffer]);
        const keys = [
            { pubkey: producerPda, isWritable: true, isSigner: false },
            { pubkey: founderKeypair.publicKey, isWritable: true, isSigner: true },
            { pubkey: vaultPda, isWritable: false, isSigner: false },
            { pubkey: mint, isWritable: true, isSigner: false },
            { pubkey: destination, isWritable: true, isSigner: false },
            { pubkey: buyback, isWritable: true, isSigner: false },
            { pubkey: staking, isWritable: true, isSigner: false },
            { pubkey: dao, isWritable: true, isSigner: false },
            { pubkey: emergency, isWritable: true, isSigner: false },
            { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
            { pubkey: SystemProgram.programId, isWritable: false, isSigner: false }
        ];
        const instruction = new TransactionInstruction({ keys, programId: PROGRAM_ID, data });
        const tx = new Transaction().add(instruction);
        const sig = await sendAndConfirmTransaction(connection, tx, [founderKeypair]);
        logger.info('🎉 Mint successful! TX:', sig);
        return { success: true, tx: sig };
    } catch (e) {
        logger.error('❌ mintEnergy error:', e);
        return { success: false, error: e.message };
    }
}

// === Регистрация устройства ===
app.post('/api/v1/device/register', [
    body('device_id').isString().notEmpty().trim(),
    body('public_key').isString().isLength({ min: 44, max: 44 })
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { device_id, public_key } = req.body;
    if (devices[device_id]) {
        devices[device_id] = public_key;
        saveDevice(device_id, public_key);
        logger.info(`✅ Device updated: ${device_id}`);
        return res.json({ ok: true, message: 'Device updated successfully' });
    }
    try {
        const pubBytes = Buffer.from(public_key, 'base64');
        if (pubBytes.length !== 32) {
            return res.status(400).json({ error: 'invalid public key (must be 32 bytes base64)' });
        }
    } catch (e) {
        return res.status(400).json({ error: 'invalid public key format' });
    }
    devices[device_id] = public_key;
    saveDevice(device_id, public_key);
    logger.info(`✅ Device registered: ${device_id}`);
    res.json({ ok: true, message: 'Device registered successfully' });
});

// === СТАТУС УСТРОЙСТВА ===
app.get('/api/v1/device/:id/status', (req, res) => {
    const deviceId = req.params.id;
    if (!devices[deviceId]) {
        return res.status(404).json({ error: 'device not found' });
    }
    const entry = energyStore[deviceId] || { energy_wh: 0, nonce: 0 };
    res.json({
        device_id: deviceId,
        is_initialized: true,
        energy_wh: entry.energy_wh || 0,
        nonce: entry.nonce || 0
    });
});

// === БАЛАНС (заглушка) ===
app.get('/api/v1/device/:id/balance', (req, res) => {
    const deviceId = req.params.id;
    if (!devices[deviceId]) {
        return res.status(404).json({ error: 'device not found' });
    }
    // Здесь можно запросить реальный баланс с Solana, пока заглушка
    res.json({ balance: 0, device_id: deviceId });
});

// === СОЗДАНИЕ ПУЛА ===
app.post('/api/v1/pool/create', (req, res) => {
    const { pool_id, threshold } = req.body;
    if (!pool_id || !threshold) {
        return res.status(400).json({ error: 'missing pool_id or threshold' });
    }
    if (pools[pool_id]) {
        return res.status(400).json({ error: 'pool already exists' });
    }
    const pool = {
        threshold,
        devices: [],
        total_energy: 0,
        device_energy: {},
        created_at: Date.now()
    };
    pools[pool_id] = pool;
    savePool(pool_id, threshold, 0, {}, Date.now());
    res.json({ ok: true, pool });
});

// === ОТПРАВКА PROOF ===
app.post('/api/v1/proof/submit', async (req, res) => {
    try {
        const { device_id, timestamp, energyWh, nonce, signature, pool_id } = req.body;
        if (!device_id || !timestamp || energyWh === undefined || !nonce || !signature) {
            return res.status(400).json({ error: 'missing fields' });
        }

        const publicKeyB64 = devices[device_id];
        if (!publicKeyB64) return res.status(400).json({ error: 'unknown device' });

        const stored = energyStore[device_id] || { nonce: 0 };
        if (nonce <= stored.nonce) {
            return res.status(400).json({ error: 'InvalidNonce' });
        }

        const msg = `${device_id}|${timestamp}|${energyWh}|${nonce}`;
        const msgBytes = Buffer.from(msg, 'utf8');
        const sigBytes = Buffer.from(signature, 'base64');
        const pubBytes = Buffer.from(publicKeyB64, 'base64');

        const verified = nacl.sign.detached.verify(
            new Uint8Array(msgBytes), new Uint8Array(sigBytes), new Uint8Array(pubBytes)
        );
        if (!verified) return res.status(400).json({ error: 'invalid signature' });

        const newEnergy = (stored.energy_wh || 0) + Number(energyWh);
        energyStore[device_id] = { energy_wh: newEnergy, nonce: nonce };
        saveEnergy(device_id, newEnergy, nonce);

        if (pool_id && pools[pool_id]) {
            const pool = pools[pool_id];
            if (!pool.devices.includes(device_id)) pool.devices.push(device_id);
            if (!pool.device_energy) pool.device_energy = {};
            pool.device_energy[device_id] = (pool.device_energy[device_id] || 0) + Number(energyWh);
            pool.total_energy += Number(energyWh);
            savePool(pool_id, pool.threshold, pool.total_energy, pool.device_energy, pool.created_at);
            logger.info(`📊 Pool ${pool_id}: +${energyWh}Wh, total: ${pool.total_energy}Wh`);
            if (pool.total_energy >= pool.threshold) {
                logger.info(`🎯 Pool ${pool_id} threshold reached! Distributing tokens...`);
                pool.total_energy = 0;
                pool.device_energy = {};
                savePool(pool_id, pool.threshold, 0, {}, pool.created_at);
                return res.json({ ok: true, message: 'Pool threshold reached, tokens distributed' });
            }
            return res.json({ ok: true, pool_total: pool.total_energy });
        }

        logger.info(`📊 Device ${device_id} submitted ${energyWh}Wh (nonce=${nonce}). Accumulated: ${newEnergy}Wh`);
        if (newEnergy >= ENERGY_THRESHOLD) {
            logger.info(`🎯 Threshold reached for ${device_id}: minting ${newEnergy}`);
            await createProducerIfNeeded();
            const mintRes = await mintEnergy(device_id, newEnergy);
            if (mintRes.success) {
                energyStore[device_id].energy_wh = 0;
                saveEnergy(device_id, 0, nonce);
                return res.json({ ok: true, minted: newEnergy, tx: mintRes.tx });
            } else {
                return res.status(500).json({ error: 'mint_failed', reason: mintRes.error });
            }
        }
        return res.json({ ok: true, accumulated: newEnergy });
    } catch (e) {
        logger.error('❌ Error handling proof:', e);
        return res.status(500).json({ error: e.message });
    }
});

// === СТАТИСТИКА ДЛЯ САЙТА ===
app.get('/api/v1/stats', (req, res) => {
  try {
    const totalEnergyWh = Object.values(energyStore).reduce((sum, e) => sum + (e.energy_wh || 0), 0);
    const totalEnergyMwh = totalEnergyWh / 1000000;
    const activeProducers = Object.keys(devices).length;
    const totalSupply = 0; // заглушка
    const stats = {
      total_energy_mwh: Math.round(totalEnergyMwh * 100) / 100,
      active_producers: activeProducers,
      total_supply: totalSupply,
    };
    res.json(stats);
  } catch (e) {
    logger.error('❌ Error fetching stats:', e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 Oracle server listening on port ${PORT}`);
});