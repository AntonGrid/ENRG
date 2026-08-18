const express = require('express');
const path = require('path');
const nacl = require('tweetnacl');
const util = require('tweetnacl-util'); // encodeBase64/decodeBase64 (манифесты, подписи)
const storage = require('./storage');
const policy = require('./policy'); // Policy Engine (ADR-0003)
const winston = require('winston');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { Connection, clusterApiUrl, Keypair, Transaction, TransactionInstruction, PublicKey, TransactionMessage, VersionedTransaction, Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY, AddressLookupTableProgram, sendAndConfirmTransaction, SystemProgram } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');
const anchor = require('@coral-xyz/anchor');
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

// ── OTA (ADR-0008) ──
// Директория для образов прошивки (по умолчанию firmware/updates/).
const FIRMWARE_UPDATES_DIR =
    process.env.FIRMWARE_UPDATES_DIR || path.join(__dirname, 'firmware', 'updates');
// Админ-ключ для публикации прошивки (POST /api/v1/firmware/update).
// Обязателен: публикация образа без аутентификации = подпись оракулом
// произвольного (возможно враждебного) контента.
const FIRMWARE_ADMIN_KEY = process.env.FIRMWARE_ADMIN_KEY;

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

// ХОЛОДНЫЙ ключ подписи прошивок (ADR-0008, D-5): ОТДЕЛЬНЫЙ от founder.
// Образы OTA подписываются ЭТИМ ключом; приватный ключ хранится в
// офлайн-хранилище (HSM/холодный кошелёк). Публичный ключ вшит в прошивку
// как ENRG_FIRMWARE_PUBKEY_HEX. Dev-копия: firmware/firmware-signing-keypair.json.
let firmwareSigningKeypair = null;
function loadFirmwareSigningKeypair() {
    const p = process.env.FIRMWARE_SIGNING_KEY_PATH ||
        path.join(__dirname, 'firmware', 'firmware-signing-keypair.json');
    const raw = fs.readFileSync(p, 'utf8');
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}
try {
    firmwareSigningKeypair = loadFirmwareSigningKeypair();
    if (firmwareSigningKeypair) {
        logger.info('✅ Loaded firmware-signing keypair (cold key): ' + firmwareSigningKeypair.publicKey.toBase58());
    }
} catch (e) {
    firmwareSigningKeypair = null;
    logger.warn('⚠️ Firmware-signing keypair not found (' +
        'set FIRMWARE_SIGNING_KEY_PATH) — FALLBACK to founder key for OTA signing.');
}

// Мульти-владельческий mint (ADR-0003): для подписи OracleReport используется
// ОТДЕЛЬНЫЙ ключ оракула (ORACLE_KEY / ORACLE_KEY_PATH), а не founder.
// Публичный ключ оракула обязан быть в on-chain OracleRegistry (addOracle).
// Транзакцию mint подписывает сам оракул; награда идёт владельцу устройства.
let oracleKeypair = null;
try {
    oracleKeypair = policy.getOracleKeypair();
    if (oracleKeypair) {
        logger.info('✅ Loaded oracle keypair: ' + oracleKeypair.publicKey.toBase58());
    }
} catch (e) {
    logger.warn('⚠️ Failed to parse oracle keypair:', e.message);
}
if (!oracleKeypair) {
    logger.warn('⚠️ Oracle keypair not found. Minting will not work (set ORACLE_KEY_PATH / ORACLE_KEY).');
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// M-6: доверяем заголовкам reverse proxy (TLS-терминация на прокси),
// чтобы rate-limit корректно считал реальные IP клиентов.
app.set('trust proxy', 1);

// M-6: глобальный rate-limit (защита от DoS). Лимит задаётся в Policy Engine:
// policy-config.json / RATE_LIMIT_PER_MINUTE (по умолчанию 100 запросов/мин на IP).
const limiter = rateLimit(policy.rateLimitOptions());
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

// Канонические сообщения подписи (buildDeviceMessage/buildOracleMessage) и
// разбор device_id (parseDevicePubkey) вынесены в Policy Engine (policy.js,
// ADR-0003) — единый источник правды для server.js и policy.js.

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
async function mintEnergy(proof, producerOverride = null) {
    if (!oracleKeypair) return { success: false, error: 'oracle_key_missing' };
    if (!proof || proof.sig_mode !== 'binary') return { success: false, error: 'device_signature_not_onchain_compatible' };
    const deviceIdPubkey = proof.device_id_pubkey;
    if (!deviceIdPubkey) return { success: false, error: 'device_id_not_a_pubkey' };
    if (!IDL) return { success: false, error: 'idl_missing' };
    try {
        const connection = new Connection(RPC_ENDPOINT, 'confirmed');
        const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(oracleKeypair), {
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
        const deviceMsg = policy.buildDeviceMessage(deviceIdPubkey, proof.nonce, proof.device_timestamp, proof.energy_wh);
        const oracleMsg = policy.buildOracleMessage(deviceIdPubkey, proof.nonce, proof.device_timestamp, nowSec, proof.energy_wh);
        // Мульти-владельческий mint: отчёт подписывает ОРАКУЛ (ORACLE_KEY), не founder.
        const oracleSignature = nacl.sign.detached(new Uint8Array(oracleMsg), oracleKeypair.secretKey);

        // OracleReport (borsh, как в state/oracle.rs): oracle(32) device_id(32) nonce(8)
        // device_timestamp(8) verified_at(8) energy_wh(8) device_signature(64) oracle_signature(64).
        const report = {
            oracle: oracleKeypair.publicKey,
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
        const policyRegistryPda = find('policy-registry');
        const [producerPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('producer'), deviceIdPubkey.toBuffer()], PROGRAM_ID
        );

        // Пре-проверка: producer существует; из него берём ВЛАДЕЛЬЦА (authority).
        // P0-2 (ADR-0002): если producer уже получен из on-chain Registry в
        // /proof/submit — переиспользуем его (одна RPC-проверка на запрос),
        // иначе читаем реестр здесь.
        let producer;
        if (producerOverride) {
            producer = producerOverride;
        } else {
            try {
                producer = await program.account.energyProducer.fetch(producerPda);
            } catch (e) {
                return { success: false, error: 'producer_not_registered_on_chain' };
            }
        }
        const ownerPubkey = new PublicKey(producer.authority.toBytes());

        // Награда идёт ВЛАДЕЛЬЦУ устройства: profile/reputation/ATA привязаны к
        // producer.authority (а не к подписанту-оракулу).
        const [profilePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('profile'), ownerPubkey.toBuffer()], PROFILE_PROGRAM_ID
        );
        const [reputationPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('reputation'), ownerPubkey.toBuffer()], PROGRAM_ID
        );
        const userAta = (await getOrCreateAssociatedTokenAccount(
            connection, oracleKeypair, srcMintPda, ownerPubkey
        )).address;
        const fundAtas = {
            buyback: getAssociatedTokenAddressSync(srcMintPda, buybackAuthorityPda, true),
            staking: getAssociatedTokenAddressSync(srcMintPda, fundStakingPda, true),
            dao: getAssociatedTokenAddressSync(srcMintPda, fundDaoPda, true),
            emergency: getAssociatedTokenAddressSync(srcMintPda, fundEmergencyPda, true),
        };

        // Пре-проверка: без profile транзакция заведомо упадёт.
        if (!(await accountExists(connection, profilePda))) {
            return { success: false, error: 'energy_profile_missing_on_chain' };
        }

        // ADR-0003: Policy Registry (PDA [b"policy-registry"]). Если реестр
        // не инициализирован — передаём null (дефолтные политики протокола,
        // полная обратная совместимость). После инициализации политики
        // управляются через update_policy (authority реестра).
        const policyRegistryExists = await accountExists(connection, policyRegistryPda);
        const policyRegistry = policyRegistryExists ? policyRegistryPda : null;

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
            authority: oracleKeypair.publicKey,
            profile: profilePda,
            reputation: reputationPda,
            pool: null,
            poolShare: null,
            policyRegistry,
        }).instruction();

        // ── Две ed25519-precompile-инструкции ПЕРЕД mint_energy ──
        const edDeviceIx = Ed25519Program.createInstructionWithPublicKey({
            publicKey: deviceIdPubkey.toBytes(),
            message: deviceMsg,
            signature: Buffer.from(proof.device_signature),
        });
        const edOracleIx = Ed25519Program.createInstructionWithPublicKey({
            publicKey: oracleKeypair.publicKey.toBytes(),
            message: oracleMsg,
            signature: Buffer.from(oracleSignature),
        });

        // v0-транзакция с Address Lookup Table (2× ed25519 + 16 аккаунтов > legacy-лимит).
        const lutAddresses = [
            producerPda, vaultPda, tokenMintPda, srcMintPda, mintAuthorityPda, userAta,
            fundAtas.buyback, fundAtas.staking, fundAtas.dao, fundAtas.emergency,
            SYSVAR_INSTRUCTIONS_PUBKEY, oracleRegistryPda, TOKEN_PROGRAM_ID, PROFILE_PROGRAM_ID,
            oracleKeypair.publicKey, profilePda, Ed25519Program.programId,
            // Policy Registry — только если инициализирован (ADR-0003).
            ...(policyRegistry ? [policyRegistry] : []),
        ];
        const lut = await ensureLookupTable(connection, oracleKeypair, lutAddresses);
        const sig = await sendVersioned(connection, oracleKeypair, [edDeviceIx, edOracleIx, mintIx], lut);
        logger.info('🎉 Mint successful! TX:', sig);
        return { success: true, tx: sig };
    } catch (e) {
        logger.error('❌ mintEnergy error:', e);
        return { success: false, error: e.message };
    }
}

// Формат device_id (base58/hex) и все проверки входящих данных вынесены
// в Policy Engine — policy.validateDeviceId() / policy.validateProof() (ADR-0003).

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

    // CR-1: Policy Engine — формат device_id, длины ключа/подписи и
    // proof-of-possession по сообщению `${device_id}|${public_key}` (ADR-0003).
    const v = policy.validateRegister(device_id, public_key, signature);
    if (!v.ok) {
        if (v.status === 403) {
            logger.warn(`⛔ Register denied (bad signature) for device ${device_id}`);
        }
        return res.status(v.status).json({ error: v.error });
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
// (/status, /balance, /history) — Policy Engine (ADR-0003).
app.param('id', (req, res, next, id) => {
    if (!policy.validateDeviceId(id).ok) {
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

// === ПОДПИСАННЫЙ DEVICE MANIFEST (ADR-0004) ===
// Устройство запрашивает конфигурацию (rated_power, oracle_url) у оракула и
// проверяет подпись ключом основателя (FOUNDER_KEY) перед использованием.
// Каноническое сообщение подписи — policy.buildManifestMessage() (policy.js),
// оно же воспроизводится в прошивке ESP32 (verifyManifest).
app.get('/api/v1/manifest/:device_id', (req, res) => {
    const deviceId = req.params.device_id;

    // Формат device_id (base58/hex) — через Policy Engine.
    const d = policy.validateDeviceId(deviceId);
    if (!d.ok) {
        return res.status(d.status).json({ error: d.error });
    }
    if (!d.deviceIdPubkey) {
        return res.status(400).json({ error: 'invalid device_id (must be a 32-byte key)' });
    }
    if (!founderKeypair) {
        return res.status(500).json({ error: 'founder_key_missing' });
    }

    // public_key: ключ из реестра, либо (для незарегистрированных устройств)
    // сам device_id (обратная совместимость с flow «манифест до регистрации»).
    const public_key =
        devices[deviceId] ||
        util.encodeBase64(d.deviceIdPubkey.toBytes());

    // rated_power: опциональный query-параметр (только доверенный вызывающий),
    // иначе — defaultRatedPowerW из конфигурации политик.
    let rated_power = policy.config.defaultRatedPowerW;
    if (req.query.rated_power !== undefined) {
        const rp = Number(req.query.rated_power);
        if (!Number.isFinite(rp) || rp <= 0 || rp > 1_000_000_000) {
            return res.status(400).json({ error: 'invalid rated_power (positive number <= 1e9 W)' });
        }
        rated_power = Math.round(rp);
    }

    // oracle_url: публичный URL оракула (куда устройству слать proof'ы).
    const oracle_url = policy.config.oracleUrl;
    if (typeof oracle_url !== 'string' || !/^https?:\/\//.test(oracle_url) || oracle_url.includes('|')) {
        return res.status(500).json({ error: 'oracle_url misconfigured' });
    }

    const manifest = {
        device_id: deviceId,
        rated_power,
        oracle_url,
        public_key,
        timestamp: Math.floor(Date.now() / 1000),
        // ADR-0004 (аудит 2026-08-18, P1-12): обязательные поля манифеста.
        trust_level: 'basic',
        heartbeat_interval: 60, // сек
        proof_threshold: 1,     // Wh, порог формирования proof
        policy_version: 1,
        verifier_endpoint: oracle_url,
    };

    const signature = policy.signManifest(manifest, founderKeypair.secretKey);
    logger.info(`📋 Manifest issued for ${deviceId} (rated_power=${rated_power}W, oracle=${oracle_url})`);
    res.json({ ...manifest, signature });
});

// === OTA-ОБНОВЛЕНИЯ ПРОШИВКИ (ADR-0008) ===
// Образ подписывается ключом основателя (FOUNDER_KEY) по схеме
//   version|image_hash|image_size  (policy.buildFirmwareMessage)
// Устройство проверяет подпись + SHA-256(образ) перед установкой.

/** Санитизировать имя файла версии (без путей и спецсимволов). */
function sanitizeVersion(v) {
    return String(v).replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Загрузить latest.json (метаданные текущей прошивки) или null. */
function loadFirmwareMeta() {
    try {
        const p = path.join(FIRMWARE_UPDATES_DIR, 'latest.json');
        if (!fs.existsSync(p)) return null;
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        logger.error('❌ firmware metadata read failed:', e && e.message);
        return null;
    }
}

// POST /api/v1/firmware/update?version=1.2.0[&model=ENRG-ESP32-v1]
// Body: raw binary образ прошивки. Требует x-api-key == FIRMWARE_ADMIN_KEY.
app.post('/api/v1/firmware/update', express.raw({
    type: ['application/octet-stream', 'application/json', '*/*'],
    limit: String(policy.config.maxFirmwareSizeBytes),
}), async (req, res) => {
    try {
        if (!FIRMWARE_ADMIN_KEY) {
            return res.status(503).json({ error: 'firmware_admin_key_missing' });
        }
        if (req.headers['x-api-key'] !== FIRMWARE_ADMIN_KEY) {
            return res.status(401).json({ error: 'invalid admin key' });
        }
        if (!founderKeypair) {
            return res.status(500).json({ error: 'founder_key_missing' });
        }

        const version = req.query.version;
        const model = req.query.model || '';
        if (typeof version !== 'string' || !version.trim() || version.includes('|') || version.includes('..')) {
            return res.status(400).json({ error: 'invalid firmware version' });
        }

        const buf = req.body;
        if (!Buffer.isBuffer(buf) || buf.length === 0) {
            return res.status(400).json({ error: 'empty firmware image' });
        }
        if (buf.length > policy.config.maxFirmwareSizeBytes) {
            return res.status(400).json({ error: `firmware image too large (max ${policy.config.maxFirmwareSizeBytes} bytes)` });
        }

        const image_hash = crypto.createHash('sha256').update(buf).digest('hex');
        const image_size = buf.length;

        await fs.promises.mkdir(FIRMWARE_UPDATES_DIR, { recursive: true });
        const binPath = path.join(FIRMWARE_UPDATES_DIR, `${sanitizeVersion(version)}.bin`);
        await fs.promises.writeFile(binPath, buf);

        const firmware = { version, image_hash, image_size };
        const signature = policy.signFirmware(firmware, (firmwareSigningKeypair || founderKeypair).secretKey);
        const meta = {
            ...firmware,
            model,
            image_url: '/api/v1/firmware/latest/image',
            signature,
            signed_by: founderKeypair.publicKey.toBase58(),
            issued_at: Math.floor(Date.now() / 1000),
        };
        await fs.promises.writeFile(path.join(FIRMWARE_UPDATES_DIR, 'latest.json'), JSON.stringify(meta, null, 2));

        logger.info(`🔄 Firmware ${version} published (${image_size} bytes, sha256=${image_hash.slice(0, 12)}…)`);
        res.status(201).json({ ok: true, version, image_size, image_hash, signature });
    } catch (e) {
        logger.error('❌ firmware update failed:', e && e.message);
        return res.status(500).json({ error: (e && e.message) || 'internal error' });
    }
});

// GET /api/v1/firmware/latest — метаданные текущей прошивки (подпись + хеш).
app.get('/api/v1/firmware/latest', (req, res) => {
    const meta = loadFirmwareMeta();
    if (!meta) return res.status(404).json({ error: 'no firmware published' });
    res.json(meta);
});

// GET /api/v1/firmware/latest/image — бинарный образ текущей прошивки.
app.get('/api/v1/firmware/latest/image', (req, res) => {
    const meta = loadFirmwareMeta();
    if (!meta) return res.status(404).json({ error: 'no firmware published' });
    const binPath = path.join(FIRMWARE_UPDATES_DIR, `${sanitizeVersion(meta.version)}.bin`);
    if (!fs.existsSync(binPath)) return res.status(404).json({ error: 'firmware image missing' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Firmware-Version', meta.version);
    res.setHeader('X-Firmware-Hash', meta.image_hash);
    res.sendFile(binPath);
});


// === ОТЗЫВ / РОТАЦИЯ КЛЮЧА УСТРОЙСТВА (ADR-0007) ===
// Оба эндпоинта вызывают on-chain инструкции программы enrg_mvp.
// Транзакции подписываются ключом основателя (founder), который является
// vault.authority (протокольный админ) — on-chain это разрешено.

/** PDA producer'а: [b"producer", device_id]. */
function findProducerPda(deviceIdPubkey) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('producer'), deviceIdPubkey.toBuffer()], PROGRAM_ID
    )[0];
}

/** PDA Vault: [b"vault"]. */
function findVaultPda() {
    return PublicKey.findProgramAddressSync([Buffer.from('vault')], PROGRAM_ID)[0];
}

/** Поднять Anchor-клиент (как в mintEnergy). */
function anchorProgram(connection) {
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(founderKeypair), {
        commitment: 'confirmed',
        preflightCommitment: 'confirmed',
    });
    return new anchor.Program(IDL, provider);
}

/** Read-only Anchor-клиент для fetch аккаунтов без подписи транзакций. */
function readOnlyProgram(connection) {
    const wallet = new anchor.Wallet(Keypair.generate());
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: 'confirmed',
    });
    return new anchor.Program(IDL, provider);
}

// POST /api/v1/device/revoke/:device_id — отзыв устройства (только основатель).
app.post('/api/v1/device/revoke/:device_id', async (req, res) => {
    const deviceId = req.params.device_id;
    const d = policy.validateDeviceId(deviceId);
    if (!d.ok) return res.status(400).json({ error: d.error });
    if (!d.deviceIdPubkey) return res.status(400).json({ error: 'invalid device_id (must be a 32-byte key)' });
    if (!founderKeypair) return res.status(500).json({ error: 'founder_key_missing' });
    if (!IDL) return res.status(500).json({ error: 'idl_missing' });

    try {
        const connection = new Connection(RPC_ENDPOINT, 'confirmed');
        const program = anchorProgram(connection);

        const producerPda = findProducerPda(d.deviceIdPubkey);
        // owner_devices — Option-аккаунт; передаём null (админ-отзыв не обязан
        // иметь owner_devices). on-chain корректно обрабатывает None.
        const tx = await program.methods
            .revokeDevice()
            .accounts({
                authority: founderKeypair.publicKey,
                producer: producerPda,
                ownerDevices: null,
                vault: findVaultPda(),
            })
            .rpc();
        logger.warn(`⛔ Device revoked (admin): ${deviceId}, tx=${tx}`);
        res.json({ ok: true, device_id: deviceId, tx });
    } catch (e) {
        logger.error('❌ revoke on-chain failed:', e && e.message);
        res.status(500).json({ error: 'revoke_onchain_failed', reason: (e && e.message) || 'rpc error' });
    }
});


// POST /api/v1/device/rotate/:device_id
// Body: { new_device_id, owner_signature, new_device_signature }
//   owner_signature — Ed25519 подпись владельца (authority producer'а) над
//     `${device_id}|${new_device_id}` — подтверждение намерения владельца;
//   new_device_signature — Ed25519 подпись НОВОГО ключа над бинарным сообщением
//     b"enrg:device:rotate" || new(32) || owner(32) || nonce(8) || ts(8)
//     (зеркало on-chain rotate_device_key).
app.post('/api/v1/device/rotate/:device_id', async (req, res) => {
    const deviceId = req.params.device_id;
    const { new_device_id, owner_signature, new_device_signature } = req.body || {};

    const d = policy.validateDeviceId(deviceId);
    if (!d.ok) return res.status(400).json({ error: d.error });
    if (!d.deviceIdPubkey) return res.status(400).json({ error: 'invalid device_id (must be a 32-byte key)' });
    const nd = policy.validateDeviceId(new_device_id);
    if (!nd.ok || !nd.deviceIdPubkey) return res.status(400).json({ error: 'invalid new_device_id' });
    if (nd.deviceIdPubkey.equals(d.deviceIdPubkey)) {
        return res.status(400).json({ error: 'new_device_id must differ from device_id' });
    }
    if (typeof owner_signature !== 'string' || typeof new_device_signature !== 'string') {
        return res.status(400).json({ error: 'owner_signature and new_device_signature are required' });
    }
    if (!founderKeypair) return res.status(500).json({ error: 'founder_key_missing' });
    if (!IDL) return res.status(500).json({ error: 'idl_missing' });

    try {
        const connection = new Connection(RPC_ENDPOINT, 'confirmed');
        const program = anchorProgram(connection);
        const producerPda = findProducerPda(d.deviceIdPubkey);

        // 1) Владелец устройства — из on-chain producer (authority).
        let producer;
        try {
            producer = await program.account.energyProducer.fetch(producerPda);
        } catch (e) {
            return res.status(404).json({ error: 'device_not_registered_on_chain', reason: (e && e.message) || '' });
        }
        const ownerPubkey = new PublicKey(producer.authority.toBytes());

        // 2) Подпись владельца над `${device_id}|${new_device_id}`.
        const authMsg = Buffer.from(`${deviceId}|${new_device_id}`, 'utf8');
        const ownerOk = nacl.sign.detached.verify(
            new Uint8Array(authMsg),
            new Uint8Array(Buffer.from(owner_signature, 'base64')),
            new Uint8Array(ownerPubkey.toBytes())
        );
        if (!ownerOk) return res.status(403).json({ error: 'invalid owner signature' });

        // 3) Подпись нового ключа (PoP) над бинарным rotate-сообщением.
        const nowSec = Math.floor(Date.now() / 1000);
        const rotateNonce = nowSec; // монотонный nonce (unixtime) — > claim_nonce
        const rotateTimestamp = nowSec;
        const rmsg = policy.buildDeviceRotateMessage(
            nd.deviceIdPubkey, ownerPubkey, rotateNonce, rotateTimestamp
        );
        const newKeyOk = nacl.sign.detached.verify(
            new Uint8Array(rmsg),
            new Uint8Array(Buffer.from(new_device_signature, 'base64')),
            new Uint8Array(nd.deviceIdPubkey.toBytes())
        );
        if (!newKeyOk) return res.status(403).json({ error: 'invalid new device signature (proof-of-possession)' });

        // 4) On-chain rotate (подписывает founder как протокольный админ).
        const newProducerPda = findProducerPda(nd.deviceIdPubkey);
        const tx = await program.methods
            .rotateDeviceKey(
                nd.deviceIdPubkey,
                Array.from(Buffer.from(new_device_signature, 'base64')),
                new anchor.BN(rotateNonce),
                new anchor.BN(rotateTimestamp),
            )
            .accounts({
                authority: founderKeypair.publicKey,
                oldProducer: producerPda,
                newDeviceId: nd.deviceIdPubkey,
                newProducer: newProducerPda,
                vault: findVaultPda(),
                instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
        logger.warn(`🔄 Device key rotated: ${deviceId} -> ${new_device_id}, tx=${tx}`);
        res.json({ ok: true, device_id: deviceId, new_device_id, tx });
    } catch (e) {
        logger.error('❌ rotate on-chain failed:', e && e.message);
        res.status(500).json({ error: 'rotate_onchain_failed', reason: (e && e.message) || 'rpc error' });
    }
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
// CR-2 / M-3: лимиты (energyWh, timestamp-свежесть, nonce, подпись) задаются
// в Policy Engine (policy-config.json, ADR-0003) и синхронизированы с on-chain
// (constants.rs::MAX_CLOCK_SKEW=300, security/validation.rs::MAX_PROOF_AGE=900).

app.post('/api/v1/proof/submit', async (req, res) => {
    try {
        // P0-2 (ADR-0002): источник истины для верификации proof — on-chain
        // Device Registry (EnergyProducer PDA), а НЕ локальная БД оракула.
        // Локальные таблицы (devices/energyStore) остаются только для
        // статистики/истории и не определяют доверие.
        const device_id = req.body && req.body.device_id;
        const d = policy.validateDeviceId(device_id);
        if (!d.ok) return res.status(d.status).json({ error: d.error });
        if (!d.deviceIdPubkey) {
            return res.status(400).json({ error: 'device_id must be a 32-byte Ed25519 public key (base58)' });
        }
        if (!IDL) return res.status(500).json({ error: 'idl_missing' });

        // Читаем устройство из on-chain Registry.
        let producer;
        try {
            const connection = new Connection(RPC_ENDPOINT, 'confirmed');
            const program = readOnlyProgram(connection);
            producer = await program.account.energyProducer.fetch(findProducerPda(d.deviceIdPubkey));
        } catch (e) {
            return res.status(404).json({
                error: 'device_not_registered_on_chain',
                reason: (e && e.message) || '',
            });
        }

        // ADR-0007: отозванное устройство не принимает proof'ы.
        if (producer.revoked) {
            return res.status(403).json({ error: 'device_revoked_on_chain' });
        }
        const devicePubkey = new PublicKey(producer.device_id.toBytes());
        if (!devicePubkey.equals(d.deviceIdPubkey)) {
            return res.status(400).json({ error: 'device_id mismatch with on-chain registry' });
        }

        // CR-1/CR-2/CR-3/M-3/M-5: ВСЕ проверки входящего proof выполняет Policy
        // Engine — policy.validateProof(): формат device_id, energyWh, свежесть
        // timestamp, unknown device, монотонный nonce и Ed25519-подпись.
        // Ключ и nonce берём из on-chain Registry (единый источник истины).
        const onChainNonce = producer.nonce ? producer.nonce.toNumber() : 0;
        const localNonce = (energyStore[device_id] || { nonce: 0 }).nonce;
        const v = policy.validateProof(req.body, {
            getPublicKey: () => Buffer.from(devicePubkey.toBytes()).toString('base64'),
            getLastNonce: () => Math.max(onChainNonce, localNonce),
        });
        if (!v.ok) {
            return res.status(v.status).json({ error: v.error });
        }

        // ── Накопление энергии (целые Wh) + сохранение proof для on-chain mint ──
        const proof = v.proof;
        const pool_id = v.pool_id;
        const energyWhInt = proof.energy_wh;
        const stored = energyStore[device_id] || { energy_wh: 0, nonce: 0 };
        const newEnergy = (stored.energy_wh || 0) + energyWhInt;
        energyStore[device_id] = { energy_wh: newEnergy, nonce: proof.nonce, last_proof: proof };
        await storage.saveEnergy(device_id, newEnergy, proof.nonce);

        if (pool_id && pools[pool_id]) {
            const pool = pools[pool_id];
            if (!pool.devices.includes(device_id)) pool.devices.push(device_id);
            if (!pool.device_energy) pool.device_energy = {};
            pool.device_energy[device_id] = (pool.device_energy[device_id] || 0) + energyWhInt;
            pool.total_energy += energyWhInt;
            await storage.savePool(pool_id, pool.threshold, pool.total_energy, pool.device_energy, pool.created_at);
            logger.info(`📊 Pool ${pool_id}: +${energyWhInt}Wh, total: ${pool.total_energy}Wh`);
            if (pool.total_energy >= pool.threshold) {
                // P1 (аудит 2026-08-18): off-chain пул НЕ распределяет токены —
                // прежний код «сбросил счётчик и ответил tokens distributed» был
                // заглушкой. Реальное распределение выполняется on-chain
                // (instructions/pool.rs::distribute_pool); оракул передаёт pool=null
                // в mintEnergy. Накопление продолжаем, но не выдаём ложь.
                logger.warn(`⚠️ Pool ${pool_id}: threshold reached, но off-chain распределение НЕ реализовано (требуется on-chain distribute_pool)`);
                return res.json({
                    ok: true,
                    pool_total: pool.total_energy,
                    warning: 'pool_threshold_reached_offchain_distribution_not_implemented',
                });
            }
            return res.json({ ok: true, pool_total: pool.total_energy });
        }

        logger.info(`📊 Device ${device_id} submitted ${energyWhInt}Wh (nonce=${proof.nonce}, sig=${proof.sig_mode}). Accumulated: ${newEnergy}Wh`);

        // CR-3: on-chain-совместимая (binary) подпись → каждый proof минтится
        // отдельной транзакцией mint_energy (как в devnet_e2e_lifecycle.ts).
        // Если mint временно невозможен (не задан ORACLE_KEY, устройство ещё не
        // зарегистрировано on-chain, профиль не создан, RPC недоступен) — proof
        // ПРИНИМАЕТСЯ, энергия накапливается, mint откладывается. Это деградация,
        // а не отказ: proof'ы не должны теряться из-за недоступности mint.
        if (proof.sig_mode === 'binary') {
            const mintRes = await mintEnergy(proof, producer);
            if (mintRes.success) {
                return res.json({ ok: true, minted: proof.energy_wh, tx: mintRes.tx, accumulated: newEnergy });
            }
            logger.warn(`⚠️ mint_energy отложен для ${device_id}: ${mintRes.error}. Энергия накоплена: ${newEnergy}Wh`);
            return res.json({
                ok: true,
                accumulated: newEnergy,
                mint: 'deferred',
                mint_reason: mintRes.error,
            });
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
