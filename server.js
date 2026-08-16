const express = require('express');
const path = require('path');
const nacl = require('tweetnacl');
const storage = require('./storage');
const winston = require('winston');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { Connection, clusterApiUrl, Keypair, Transaction, TransactionInstruction, PublicKey, TransactionMessage, VersionedTransaction, Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY, AddressLookupTableProgram, sendAndConfirmTransaction, SystemProgram } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token');
const anchor = require('@coral-xyz/anchor');
const bs58 = require('bs58');
const crypto = require('crypto');
const fs = require('fs');
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

// Хранилище (M-2): Postgres при DATABASE_URL, иначе SQLite — см. storage.js.
// Таблицы создаются в storage.init() при старте (bootstrap).

const PROGRAM_ID = new PublicKey('HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb');
const MINT_ADDRESS = '3PDsZUDQwgx1SV4dSTtyKDEoL9HYCdt4GN63UBYpLvwB';
const FOUNDER_WALLET = '6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8';

// CR-3: RPC-эндпоинт (env RPC_ENDPOINT, по умолчанию devnet) и enrg-profile program id
// (см. programs/enrg-profile/src/lib.rs, declare_id).
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || clusterApiUrl('devnet');
const PROFILE_PROGRAM_ID = new PublicKey('78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt');

// Функции load*/save* вынесены в storage.js (M-2: Postgres/SQLite).
// В памяти держим копии (devices/energyStore/pools) для быстрого доступа,
// персистентность — через storage.save*() в каждом эндпоинте.

let devices = {};
let energyStore = {};
let pools = {};

// Загрузка ключа основателя (H-1).
// Приоритет: FOUNDER_KEY (env) → FOUNDER_KEY_PATH (файл с правами 0600).
// Рекомендуется FOUNDER_KEY_PATH: секрет не попадает в окружение (/proc/<pid>/environ).
let founderKeypair = null;
function loadFounderKeypair() {
    if (process.env.FOUNDER_KEY) {
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.FOUNDER_KEY)));
    }
    if (process.env.FOUNDER_KEY_PATH) {
        const raw = fs.readFileSync(process.env.FOUNDER_KEY_PATH, 'utf8');
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    }
    return null;
}
try {
    founderKeypair = loadFounderKeypair();
    if (founderKeypair) {
        logger.info('✅ Loaded founder keypair from ' + (process.env.FOUNDER_KEY ? 'FOUNDER_KEY env var' : 'FOUNDER_KEY_PATH file'));
    }
} catch (e) {
    logger.warn('⚠️ Failed to parse founder keypair:', e.message);
}
if (!founderKeypair) {
    logger.warn('⚠️ Founder keypair not found. Minting will not work.');
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// M-6: доверяем заголовкам reverse proxy (TLS-терминация на прокси),
// чтобы rate-limit корректно считал реальные IP клиентов.
app.set('trust proxy', 1);

// M-6: глобальный rate-limit — 100 запросов в минуту на IP (защита от DoS).
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 минута
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many requests, please retry later' },
});
app.use(limiter);

// L-1: health-эндпоинт (используется для проверки живости оракула).
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// === ВКЛЮЧАЕМ CORS (для доступа с сайта) ===
// M-6: origin 'null' удалён — разрешены только явные источники.
app.use(cors({
    origin: [
        'https://enrg.network',
        'https://www.enrg.network',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5500',
        'http://127.0.0.1:5500'
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

// ════════════════════════════════════════════════════════════════
//  CR-3: on-chain mint (Anchor-клиент) — хелперы
// ════════════════════════════════════════════════════════════════

// Чинит IDL Anchor 1.x для @coral-xyz/anchor 0.32.x: подставляет type.fields
// аккаунтам и вычисляет size (по образцу tests/helpers/patch-idl.ts).
const SIZE_OF = { u8: 1, i8: 1, bool: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8, f64: 8, publicKey: 8, u128: 16, i128: 16 };
function computeSpace(fields, defs) {
    let total = 0;
    for (const f of fields) {
        if (!f || !f.type) return null;
        const t = f.type;
        if (typeof t === 'string') { const s = SIZE_OF[t]; if (s === null || s === undefined) return null; total += s; continue; }
        if (Array.isArray(t)) { const s = SIZE_OF[t[0]]; if (s === null || s === undefined) return null; total += s * t[1]; continue; }
        if (typeof t === 'object') {
            const keys = Object.keys(t);
            if (keys.includes('vec')) return null;
            if (keys.includes('option')) { const s = SIZE_OF[t.option]; if (s === null || s === undefined) return null; total += 1 + s; continue; }
            if (keys.includes('array')) { const s = SIZE_OF[t.array[0]]; if (s === null || s === undefined) return null; total += s * t.array[1]; continue; }
            if (keys.includes('defined')) {
                const def = defs.find((x) => x.name === t.defined);
                if (!def || !def.type || !Array.isArray(def.type.fields)) return null;
                const n = computeSpace(def.type.fields, defs);
                if (n === null) return null;
                total += n; continue;
            }
            return null;
        }
        return null;
    }
    return total;
}
function patchIdl(idl) {
    if (!idl || !Array.isArray(idl.accounts) || !Array.isArray(idl.types)) return idl;
    const defs = idl.types;
    const typeByName = new Map(defs.map((t) => [t.name, t]));
    for (const acc of idl.accounts) {
        const t = typeByName.get(acc.name);
        if (!t || !t.type || !Array.isArray(t.type.fields)) continue;
        acc.type = { kind: 'struct', fields: t.type.fields };
        const fieldsSize = computeSpace(t.type.fields, defs);
        acc.size = fieldsSize !== null ? 8 + fieldsSize : 0;
    }
    return idl;
}

// IDL enrg_mvp (по умолчанию target/idl/enrg_mvp.json, override через ENRG_IDL_PATH).
// target/ в .gitignore — при деплое нужно положить IDL рядом с server.js (или указать ENRG_IDL_PATH).
const ENRG_IDL_PATH =
    process.env.ENRG_IDL_PATH ||
    path.join(__dirname, 'target', 'idl', 'enrg_mvp.json');
let IDL = null;
try {
    IDL = patchIdl(JSON.parse(fs.readFileSync(ENRG_IDL_PATH, 'utf8')));
    // Anchor 0.32: programId берётся из idl.address (форма вызова new Program(idl, provider)).
    IDL.address = PROGRAM_ID.toBase58();
    IDL.metadata = IDL.metadata || {};
    IDL.metadata.address = PROGRAM_ID.toBase58();
    logger.info('✅ Loaded enrg_mvp IDL from', ENRG_IDL_PATH);
} catch (e) {
    logger.warn('⚠️ Cannot load enrg_mvp IDL (' + ENRG_IDL_PATH + '):', e.message);
}

// device_id в on-chain — это Solana Pubkey (32 байта): base58 или 0x-hex.
function parseDevicePubkey(device_id) {
    if (typeof device_id !== 'string' || !device_id) return null;
    try {
        if (/^0x[0-9a-fA-F]{64}$/.test(device_id)) return new PublicKey(Buffer.from(device_id.slice(2), 'hex'));
        const b = bs58.decode(device_id);
        if (b.length !== 32) return null;
        return new PublicKey(b);
    } catch (e) { return null; }
}

// little-endian u64 (совпадает с state/oracle.rs device_message_to_sign).
function le8(value) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(Math.trunc(Number(value))), 0);
    return b;
}

// OracleReport::device_message_to_sign(): device_id || nonce || device_timestamp || energy_wh
function buildDeviceMessage(deviceIdPubkey, nonce, timestamp, energyWh) {
    return Buffer.concat([deviceIdPubkey.toBuffer(), le8(nonce), le8(timestamp), le8(energyWh)]);
}

// OracleReport::oracle_message_to_sign(): device_id || nonce || device_timestamp || verified_at || energy_wh
function buildOracleMessage(deviceIdPubkey, nonce, timestamp, verifiedAt, energyWh) {
    return Buffer.concat([deviceIdPubkey.toBuffer(), le8(nonce), le8(timestamp), le8(verifiedAt), le8(energyWh)]);
}

async function accountExists(connection, pk) {
    const info = await connection.getAccountInfo(pk);
    return info !== null;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function withTimeout(p, ms, label) {
    return Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label} (>${ms}ms)`)), ms)),
    ]);
}
function rpc(p, label, ms = 10_000) { return withTimeout(p, ms, label); }

async function sendAndConfirmLegacy(connection, signer, tx, label) {
    const latest = await rpc(connection.getLatestBlockhash('confirmed'), 'latest blockhash');
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = latest.blockhash;
    tx.sign(signer);
    const sig = await withTimeout(
        connection.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed', maxRetries: 2 }),
        15_000, `${label}: send`
    );
    await withTimeout(
        connection.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed'),
        15_000, `${label}: confirm`
    );
    return sig;
}

// Address Lookup Table: mint-транзакция (2× ed25519 + 16 аккаунтов) не помещается
// в legacy-лимит (1232 байта) — используем v0-транзакцию (как devnet_e2e_lifecycle.ts).
async function ensureLookupTable(connection, signer, addresses) {
    const offsets = [0, -50, -100, -150, -250, -400, -600];
    for (let attempt = 0; attempt < 4; attempt++) {
        const baseSlot = await rpc(connection.getSlot('confirmed'), 'getSlot');
        for (const offset of offsets) {
            const recentSlot = Math.max(1, baseSlot + offset);
            const [createIx, lut] = AddressLookupTableProgram.createLookupTable({
                authority: signer.publicKey, payer: signer.publicKey, recentSlot,
            });
            try {
                await sendAndConfirmLegacy(connection, signer, new Transaction().add(createIx), 'LUT create');
            } catch (e) {
                const msg = (e && e.message) ? e.message.toString() : '';
                if (msg.includes('not a recent slot') || msg.includes('timeout') || msg.includes('blockheight exceeded')) {
                    continue;
                }
                throw e;
            }
            const extendIx = AddressLookupTableProgram.extendLookupTable({
                payer: signer.publicKey, authority: signer.publicKey, lookupTable: lut, addresses,
            });
            await sendAndConfirmLegacy(connection, signer, new Transaction().add(extendIx), 'LUT extend');

            let lutAccount = null;
            for (let i = 0; i < 15 && !lutAccount; i++) {
                const { value } = await rpc(
                    connection.getAddressLookupTable(lut, { commitment: 'confirmed' }),
                    'getAddressLookupTable'
                );
                if (value && value.state.addresses.length >= addresses.length) lutAccount = value;
                else await sleep(400);
            }
            if (!lutAccount) {
                throw new Error(`Address Lookup Table ${lut.toBase58()} не содержит всех адресов после extend`);
            }
            return lutAccount;
        }
    }
    throw new Error('Не удалось создать Address Lookup Table');
}

async function sendVersioned(connection, signer, instructions, lut) {
    let currentLut = lut;
    for (let attempt = 0; attempt < 5; attempt++) {
        await sleep(1200);
        const latest = await rpc(connection.getLatestBlockhash('confirmed'), 'latest blockhash');
        const message = new TransactionMessage({
            payerKey: signer.publicKey,
            recentBlockhash: latest.blockhash,
            instructions,
        }).compileToV0Message([currentLut]);
        const tx = new VersionedTransaction(message);
        tx.sign([signer]);
        try {
            const sig = await withTimeout(
                connection.sendTransaction(tx, { preflightCommitment: 'confirmed', maxRetries: 3 }),
                20_000, 'v0 mint: send'
            );
            await withTimeout(
                connection.confirmTransaction(
                    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
                    'confirmed'
                ),
                20_000, 'v0 mint: confirm'
            );
            return sig;
        } catch (e) {
            const msg = (e && e.message) ? e.message.toString() : '';
            if (msg.includes('invalid index') || msg.includes('address table lookup') ||
                msg.includes('timeout') || msg.includes('blockheight exceeded')) {
                const { value } = await rpc(
                    connection.getAddressLookupTable(currentLut.key, { commitment: 'confirmed' }),
                    'getAddressLookupTable (retry)'
                );
                if (value && value.state.addresses.length >= currentLut.state.addresses.length) {
                    currentLut = value;
                }
                continue;
            }
            throw e;
        }
    }
    throw new Error('v0-транзакция с LUT не прошла после повторных попыток');
}



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

// CR-3: on-chain mint через Anchor-клиент.
// Принимает proof (уже верифицированную подпись УСТРОЙСТВА в on-chain бинарном
// формате) и подписывает OracleReport ключом основателя (оракул = FOUNDER_KEY).
// Образец: scripts/devnet_e2e_lifecycle.ts (oracleMint, v0+LUT, 2× ed25519).
async function mintEnergy(proof) {
    if (!founderKeypair) return { success: false, error: 'founder_key_missing' };
    if (!proof || proof.sig_mode !== 'binary') return { success: false, error: 'device_signature_not_onchain_compatible' };
    const deviceIdPubkey = proof.device_id_pubkey;
    if (!deviceIdPubkey) return { success: false, error: 'device_id_not_a_pubkey' };
    if (!IDL) return { success: false, error: 'idl_missing' };
    try {
        const connection = new Connection(RPC_ENDPOINT, 'confirmed');
        const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(founderKeypair), {
            commitment: 'confirmed',
            preflightCommitment: 'confirmed',
        });
        const program = new anchor.Program(IDL, provider);

        const nowSec = Math.floor(Date.now() / 1000);
        const nonce = new anchor.BN(proof.nonce);
        const deviceTimestamp = new anchor.BN(proof.device_timestamp);
        const verifiedAt = new anchor.BN(nowSec);
        const energyWh = new anchor.BN(proof.energy_wh);

        // Сообщения для ed25519-precompile (совпадают с state/oracle.rs).
        const deviceMsg = buildDeviceMessage(deviceIdPubkey, proof.nonce, proof.device_timestamp, proof.energy_wh);
        const oracleMsg = buildOracleMessage(deviceIdPubkey, proof.nonce, proof.device_timestamp, nowSec, proof.energy_wh);
        const oracleSignature = nacl.sign.detached(new Uint8Array(oracleMsg), founderKeypair.secretKey);

        // OracleReport (borsh, как в state/oracle.rs): oracle(32) device_id(32) nonce(8)
        // device_timestamp(8) verified_at(8) energy_wh(8) device_signature(64) oracle_signature(64).
        const report = {
            oracle: founderKeypair.publicKey,
            deviceId: deviceIdPubkey,
            nonce,
            deviceTimestamp,
            verifiedAt,
            energyWh,
            deviceSignature: Array.from(proof.device_signature),
            oracleSignature: Array.from(oracleSignature),
        };

        // ── PDA (как pdas() в devnet_e2e_lifecycle.ts) ──
        const find = (seed) => PublicKey.findProgramAddressSync([Buffer.from(seed)], PROGRAM_ID)[0];
        const vaultPda = find('vault');
        const tokenMintPda = find('token-mint');
        const srcMintPda = find('src-mint');
        const mintAuthorityPda = find('mint-authority');
        const buybackAuthorityPda = find('fund-buyback');
        const fundStakingPda = find('fund-staking');
        const fundDaoPda = find('fund-dao');
        const fundEmergencyPda = find('fund-emergency');
        const oracleRegistryPda = find('oracle-registry');
        const [producerPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('producer'), deviceIdPubkey.toBuffer()], PROGRAM_ID
        );
        const [profilePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('profile'), founderKeypair.publicKey.toBuffer()], PROFILE_PROGRAM_ID
        );
        const userAta = getAssociatedTokenAddressSync(srcMintPda, founderKeypair.publicKey, false);
        const fundAtas = {
            buyback: getAssociatedTokenAddressSync(srcMintPda, buybackAuthorityPda, true),
            staking: getAssociatedTokenAddressSync(srcMintPda, fundStakingPda, true),
            dao: getAssociatedTokenAddressSync(srcMintPda, fundDaoPda, true),
            emergency: getAssociatedTokenAddressSync(srcMintPda, fundEmergencyPda, true),
        };

        // Пре-проверки: без on-chain аккаунтов транзакция заведомо упадёт.
        if (!(await accountExists(connection, producerPda))) {
            return { success: false, error: 'producer_not_registered_on_chain' };
        }
        if (!(await accountExists(connection, profilePda))) {
            return { success: false, error: 'energy_profile_missing_on_chain' };
        }

        // ── mint_energy через Anchor-клиент ──
        const mintIx = await program.methods.mintEnergy(report).accounts({
            producer: producerPda,
            vault: vaultPda,
            tokenMint: tokenMintPda,
            mint: srcMintPda,
            mintAuthority: mintAuthorityPda,
            userTokenAccount: userAta,
            buybackAccount: fundAtas.buyback,
            stakingAccount: fundAtas.staking,
            daoAccount: fundAtas.dao,
            emergencyAccount: fundAtas.emergency,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            oracleRegistry: oracleRegistryPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            profileProgram: PROFILE_PROGRAM_ID,
            authority: founderKeypair.publicKey,
            profile: profilePda,
            reputation: null,
            pool: null,
            poolShare: null,
        }).instruction();

        // ── Две ed25519-precompile-инструкции ПЕРЕД mint_energy ──
        const edDeviceIx = Ed25519Program.createInstructionWithPublicKey({
            publicKey: deviceIdPubkey.toBytes(),
            message: deviceMsg,
            signature: Buffer.from(proof.device_signature),
        });
        const edOracleIx = Ed25519Program.createInstructionWithPublicKey({
            publicKey: founderKeypair.publicKey.toBytes(),
            message: oracleMsg,
            signature: Buffer.from(oracleSignature),
        });

        // v0-транзакция с Address Lookup Table (2× ed25519 + 16 аккаунтов > legacy-лимит).
        const lutAddresses = [
            producerPda, vaultPda, tokenMintPda, srcMintPda, mintAuthorityPda, userAta,
            fundAtas.buyback, fundAtas.staking, fundAtas.dao, fundAtas.emergency,
            SYSVAR_INSTRUCTIONS_PUBKEY, oracleRegistryPda, TOKEN_PROGRAM_ID, PROFILE_PROGRAM_ID,
            founderKeypair.publicKey, profilePda, Ed25519Program.programId,
        ];
        const lut = await ensureLookupTable(connection, founderKeypair, lutAddresses);
        const sig = await sendVersioned(connection, founderKeypair, [edDeviceIx, edOracleIx, mintIx], lut);
        logger.info('🎉 Mint successful! TX:', sig);
        return { success: true, tx: sig };
    } catch (e) {
        logger.error('❌ mintEnergy error:', e);
        return { success: false, error: e.message };
    }
}

// Валидация device_id: только base58 (алфавит без 0/O/I/l) или hex (с префиксом 0x).
// Отклоняет спецсимволы, пробелы, XSS-пейлоады и т.п.
function isValidDeviceId(id) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) return false;
    if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(id)) return true;         // base58
    if (/^0x[0-9a-fA-F]+$/.test(id)) return id.length % 2 === 0;  // hex (чётное число hex-цифр)
    return false;
}

// === Регистрация устройства ===
app.post('/api/v1/device/register', [
    body('device_id').isString().notEmpty().trim(),
    body('public_key').isString().isLength({ min: 44, max: 44 }),
    body('signature').isString().notEmpty()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { device_id, public_key, signature } = req.body;

    // CR-1: только base58/hex — без спецсимволов и мусорных строк.
    if (!isValidDeviceId(device_id)) {
        return res.status(400).json({ error: 'invalid device_id format (base58 or hex only)' });
    }

    // Публичный ключ: ровно 32 байта base64.
    let pubBytes;
    try {
        pubBytes = Buffer.from(public_key, 'base64');
        if (pubBytes.length !== 32) {
            return res.status(400).json({ error: 'invalid public key (must be 32 bytes base64)' });
        }
    } catch (e) {
        return res.status(400).json({ error: 'invalid public key format' });
    }

    // CR-1: proof-of-possession. Подпись сделана приватным ключом, соответствующим
    // public_key, по сообщению `device_id|public_key` (детерминированный challenge).
    let sigBytes;
    try {
        sigBytes = Buffer.from(signature, 'base64');
        if (sigBytes.length !== 64) {
            return res.status(400).json({ error: 'invalid signature (must be 64 bytes base64)' });
        }
    } catch (e) {
        return res.status(400).json({ error: 'invalid signature format' });
    }
    const msgBytes = Buffer.from(`${device_id}|${public_key}`, 'utf8');
    const verified = nacl.sign.detached.verify(
        new Uint8Array(msgBytes), new Uint8Array(sigBytes), new Uint8Array(pubBytes)
    );
    if (!verified) {
        logger.warn(`⛔ Register denied (bad signature) for device ${device_id}`);
        return res.status(403).json({ error: 'invalid signature: proof of device key ownership required' });
    }

    // CR-1: запрет перезаписи чужого device_id. Если устройство существует,
    // ключ обязан совпадать с сохранённым; иначе — 403 Forbidden.
    if (devices[device_id]) {
        if (devices[device_id] !== public_key) {
            logger.warn(`⛔ Register blocked: device ${device_id} already registered with a different public key`);
            return res.status(403).json({ error: 'device already registered with a different public key' });
        }
        logger.info(`✅ Device already registered (same key): ${device_id}`);
        return res.json({ ok: true, message: 'Device already registered with the same key' });
    }

    devices[device_id] = public_key;
    await storage.saveDevice(device_id, public_key);
    logger.info(`✅ Device registered: ${device_id}`);
    res.json({ ok: true, message: 'Device registered successfully' });
});

// M-5: валидация формата device_id во всех read-эндпоинтах
// (/status, /balance, /history) — только base58/hex, без спецсимволов и XSS.
app.param('id', (req, res, next, id) => {
    if (!isValidDeviceId(id)) {
        return res.status(400).json({ error: 'invalid device_id format (base58 or hex only)' });
    }
    next();
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

// === ИСТОРИЯ (заглушка) ===
app.get('/api/v1/device/:id/history', (req, res) => {
    const deviceId = req.params.id;
    if (!devices[deviceId]) {
        return res.status(404).json({ error: 'device not found' });
    }
    // Пока возвращаем пустой массив, позже можно добавить историю минтов
    res.json({ history: [] });
});

// === СОЗДАНИЕ ПУЛА ===
app.post('/api/v1/pool/create', async (req, res) => {
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
    await storage.savePool(pool_id, threshold, 0, {}, Date.now());
    res.json({ ok: true, pool });
});

// === ОТПРАВКА PROOF ===
// CR-2: лимит энергии в одном отчёте (1 ГВт·ч) — защита от инфляции.
const MAX_ENERGY_PER_REPORT_WH = 1_000_000_000;
// M-3: константы свежести СИНХРОНИЗИРОВАНЫ с on-chain
// (programs/enrg-mvp/src/constants.rs MAX_CLOCK_SKEW=300,
//  programs/enrg-mvp/src/security/validation.rs MAX_PROOF_AGE=900).
const MAX_CLOCK_SKEW_SEC = 300;  // метка не в будущем более чем на 5 минут
const MAX_PROOF_AGE_SEC = 900;   // доказательство не старше 15 минут

app.post('/api/v1/proof/submit', async (req, res) => {
    try {
        const { device_id, timestamp, energyWh, nonce, signature, pool_id } = req.body;
        if (!device_id || timestamp === undefined || energyWh === undefined || nonce === undefined || !signature) {
            return res.status(400).json({ error: 'missing fields' });
        }

        // M-5: строгий формат device_id (base58/hex) — как в /register.
        if (typeof device_id !== 'string' || !isValidDeviceId(device_id)) {
            return res.status(400).json({ error: 'invalid device_id format (base58 or hex only)' });
        }

        // ── CR-2: валидация energyWh ──
        // Отклоняем NaN/Infinity, строки-«мусор», null (Number(null)=0), отрицательные,
        // нуль и значения выше лимита.
        if (typeof energyWh !== 'number' && typeof energyWh !== 'string') {
            return res.status(400).json({ error: 'invalid energyWh (must be a number)' });
        }
        const energyWhNum = Number(energyWh);
        if (!Number.isFinite(energyWhNum)) {
            return res.status(400).json({ error: 'invalid energyWh (must be a finite number)' });
        }
        if (typeof energyWh === 'string' && !/^\d+(\.\d+)?$/.test(energyWh.trim())) {
            return res.status(400).json({ error: 'invalid energyWh format' });
        }
        if (energyWhNum <= 0) {
            return res.status(400).json({ error: 'invalid energyWh (must be positive)' });
        }
        if (energyWhNum > MAX_ENERGY_PER_REPORT_WH) {
            return res.status(400).json({ error: `energyWh exceeds maximum allowed per report (${MAX_ENERGY_PER_REPORT_WH} Wh)` });
        }

        // ── CR-2: валидация timestamp (свежесть ±5 минут) ──
        if (typeof timestamp !== 'number' && typeof timestamp !== 'string') {
            return res.status(400).json({ error: 'invalid timestamp (must be a number)' });
        }
        const timestampNum = Number(timestamp);
        if (!Number.isFinite(timestampNum)) {
            return res.status(400).json({ error: 'invalid timestamp (must be a finite number)' });
        }
        const nowSec = Math.floor(Date.now() / 1000);
        // M-3: проверки синхронизированы с on-chain verify_timestamp():
        // - метка не в будущем более чем на MAX_CLOCK_SKEW (5 мин);
        // - доказательство не старше MAX_PROOF_AGE (15 мин).
        if (timestampNum > nowSec + MAX_CLOCK_SKEW_SEC) {
            return res.status(400).json({ error: 'FutureTimestamp' });
        }
        if (nowSec - timestampNum > MAX_PROOF_AGE_SEC) {
            return res.status(400).json({ error: 'StaleProof' });
        }

        const publicKeyB64 = devices[device_id];
        if (!publicKeyB64) return res.status(400).json({ error: 'unknown device' });

        // ── CR-2: монотонный nonce — повторное использование отклоняется ──
        // Последний принятый nonce хранится в energy_store для каждого device_id.
        if (typeof nonce !== 'number' && typeof nonce !== 'string') {
            return res.status(400).json({ error: 'invalid nonce (must be a positive integer)' });
        }
        const nonceNum = Number(nonce);
        if (!Number.isInteger(nonceNum) || nonceNum <= 0) {
            return res.status(400).json({ error: 'invalid nonce (must be a positive integer)' });
        }
        const stored = energyStore[device_id] || { nonce: 0 };
        if (nonceNum <= stored.nonce) {
            return res.status(400).json({ error: 'InvalidNonce' });
        }

        // ── CR-2 + CR-3: проверка подписи ──
        // CR-3: подпись принимается в on-chain бинарном формате
        // device_id(32) || nonce(le8) || device_timestamp(le8) || energy_wh(le8)  → sig_mode='binary',
        // либо в legacy строковом формате device_id|timestamp|energyWh|nonce     → sig_mode='legacy'.
        // Только 'binary' можно использовать в OracleReport для on-chain mint.
        // L-3: весь блок в try/catch — битые/неожиданные входные данные
        // дают 400/401 (Bad Request), а не 500 Internal Server Error.
        let sigBytes;
        let pubBytes;
        try {
            if (typeof signature !== 'string') throw new Error('bad signature type');
            sigBytes = Buffer.from(signature, 'base64');
            pubBytes = Buffer.from(publicKeyB64, 'base64');
        } catch (e) {
            return res.status(400).json({ error: 'invalid signature format' });
        }
        if (sigBytes.length !== 64 || pubBytes.length !== 32) {
            return res.status(401).json({ error: 'invalid signature' });
        }
        const energyWhInt = Math.round(energyWhNum);
        const deviceIdPubkey = parseDevicePubkey(device_id);
        let sigMode = null;
        try {
            if (deviceIdPubkey) {
                const bmsg = buildDeviceMessage(deviceIdPubkey, nonceNum, timestampNum, energyWhInt);
                if (nacl.sign.detached.verify(new Uint8Array(bmsg), new Uint8Array(sigBytes), new Uint8Array(pubBytes))) {
                    sigMode = 'binary';
                }
            }
            if (!sigMode) {
                const lmsg = Buffer.from(`${device_id}|${timestamp}|${energyWh}|${nonce}`, 'utf8');
                if (nacl.sign.detached.verify(new Uint8Array(lmsg), new Uint8Array(sigBytes), new Uint8Array(pubBytes))) {
                    sigMode = 'legacy';
                }
            }
        } catch (e) {
            return res.status(400).json({ error: 'invalid signature' });
        }
        if (!sigMode) return res.status(401).json({ error: 'invalid signature' });

        // ── Накопление энергии (целые Wh) + сохранение proof для on-chain mint ──
        const newEnergy = (stored.energy_wh || 0) + energyWhInt;
        const proof = {
            device_id,
            device_id_pubkey: deviceIdPubkey,
            nonce: nonceNum,
            device_timestamp: timestampNum,
            energy_wh: energyWhInt,
            device_signature: sigBytes,
            sig_mode: sigMode,
        };
        energyStore[device_id] = { energy_wh: newEnergy, nonce: nonceNum, last_proof: proof };
        await storage.saveEnergy(device_id, newEnergy, nonceNum);

        if (pool_id && pools[pool_id]) {
            const pool = pools[pool_id];
            if (!pool.devices.includes(device_id)) pool.devices.push(device_id);
            if (!pool.device_energy) pool.device_energy = {};
            pool.device_energy[device_id] = (pool.device_energy[device_id] || 0) + energyWhInt;
            pool.total_energy += energyWhInt;
            await storage.savePool(pool_id, pool.threshold, pool.total_energy, pool.device_energy, pool.created_at);
            logger.info(`📊 Pool ${pool_id}: +${energyWhInt}Wh, total: ${pool.total_energy}Wh`);
            if (pool.total_energy >= pool.threshold) {
                logger.info(`🎯 Pool ${pool_id} threshold reached! Distributing tokens...`);
                pool.total_energy = 0;
                pool.device_energy = {};
                await storage.savePool(pool_id, pool.threshold, 0, {}, pool.created_at);
                return res.json({ ok: true, message: 'Pool threshold reached, tokens distributed' });
            }
            return res.json({ ok: true, pool_total: pool.total_energy });
        }

        logger.info(`📊 Device ${device_id} submitted ${energyWhInt}Wh (nonce=${nonceNum}, sig=${sigMode}). Accumulated: ${newEnergy}Wh`);

        // CR-3: on-chain-совместимая (binary) подпись → каждый proof минтится
        // отдельной транзакцией mint_energy (как в devnet_e2e_lifecycle.ts).
        if (sigMode === 'binary') {
            const mintRes = await mintEnergy(proof);
            if (mintRes.success) {
                return res.json({ ok: true, minted: proof.energy_wh, tx: mintRes.tx, accumulated: newEnergy });
            }
            return res.status(500).json({ error: 'mint_failed', reason: mintRes.error });
        }

        // legacy-подпись (строковый формат) несовместима с on-chain mint — только накопление.
        if (newEnergy >= ENERGY_THRESHOLD) {
            logger.warn(`⚠️ Device ${device_id} reached threshold but mint requires on-chain-compatible (binary) device signature`);
            return res.json({ ok: true, accumulated: newEnergy, note: 'mint_requires_binary_signature' });
        }
        return res.json({ ok: true, accumulated: newEnergy });
    } catch (e) {
        // L-3: логируем только сообщение, без stacktrace с путями хоста.
        logger.error('❌ Error handling proof:', e && e.message);
        return res.status(500).json({ error: (e && e.message) || 'internal error' });
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

// M-2: асинхронный старт — инициализация хранилища (Postgres при DATABASE_URL,
// иначе SQLite) и загрузка персистентного состояния в память.
async function bootstrap() {
    await storage.init();
    devices = await storage.loadDevices();
    energyStore = await storage.loadEnergyStore();
    pools = await storage.loadPools();
    logger.info(`✅ Storage=${storage.name}: loaded ${Object.keys(devices).length} devices, ${Object.keys(pools).length} pools`);
    app.listen(PORT, '0.0.0.0', () => {
        logger.info(`🚀 Oracle server listening on port ${PORT} (storage: ${storage.name})`);
    });
}

bootstrap().catch((e) => {
    logger.error('❌ FATAL startup error:', e);
    process.exit(1);
});
