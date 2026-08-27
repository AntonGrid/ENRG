const express = require('express');
const path = require('path');
const nacl = require('tweetnacl');
const util = require('tweetnacl-util'); // encodeBase64/decodeBase64 (manifests, signatures)
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

// winston configuration
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

// Storage (M-2): Postgres when DATABASE_URL is set, otherwise SQLite — see storage.js.
// Tables are created in storage.init() at startup (bootstrap).

const PROGRAM_ID = new PublicKey('HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb');
const MINT_ADDRESS = '3PDsZUDQwgx1SV4dSTtyKDEoL9HYCdt4GN63UBYpLvwB';
const FOUNDER_WALLET = '6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8';

// CR-3: RPC endpoint (env RPC_ENDPOINT, devnet by default) and enrg-profile program id
// (see programs/enrg-profile/src/lib.rs, declare_id).
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || clusterApiUrl('devnet');
const PROFILE_PROGRAM_ID = new PublicKey('78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt');

// ── OTA (ADR-0008) ──
// Directory for firmware images (default firmware/updates/).
const FIRMWARE_UPDATES_DIR =
    process.env.FIRMWARE_UPDATES_DIR || path.join(__dirname, 'firmware', 'updates');
// Admin key for publishing firmware (POST /api/v1/firmware/update).
// Required: publishing an image without authentication = signing
// arbitrary (potentially hostile) content.
const FIRMWARE_ADMIN_KEY = process.env.FIRMWARE_ADMIN_KEY;

// The load*/save* functions live in storage.js (M-2: Postgres/SQLite).
// In-memory copies (devices/energyStore/pools) for fast access,
// persistence — via storage.save*() in each endpoint.

let devices = {};
let energyStore = {};
let pools = {};

// Founder key loading (H-1).
// Priority: FOUNDER_KEY (env) → FOUNDER_KEY_PATH (file with 0600 perms).
// FOUNDER_KEY_PATH is recommended: the secret never enters the environment (/proc/<pid>/environ).
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

// COLD firmware-signing key (ADR-0008, D-5): SEPARATE from the founder.
// OTA images are signed with THIS key; the private key lives in
// offline storage (HSM/cold wallet). The public key is baked into the firmware
// as ENRG_FIRMWARE_PUBKEY_HEX. Dev copy: firmware/firmware-signing-keypair.json.
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

// Multi-owner mint (ADR-0003): the OracleReport is signed with
// a SEPARATE oracle key (ORACLE_KEY / ORACLE_KEY_PATH), not the founder.
// The oracle public key must be in the on-chain OracleRegistry (addOracle).
// The mint transaction is signed by the oracle; the reward goes to the device owner.
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

// M-6: we trust reverse proxy headers (TLS termination at the proxy)
// so the rate limit sees real client IPs.
app.set('trust proxy', 1);

// M-6: global rate limit (DoS protection). The limit is set in the Policy Engine:
// policy-config.json / RATE_LIMIT_PER_MINUTE (default 100 requests/min per IP).
const limiter = rateLimit(policy.rateLimitOptions());
app.use(limiter);

// L-1: health endpoint (used to probe oracle liveness).
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// === ENABLE CORS (for website access) ===
// M-6: origin 'null' removed — only explicit origins are allowed.
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
//  CR-3: on-chain mint (Anchor client) — helpers
// ════════════════════════════════════════════════════════════════

// Patches Anchor 1.x IDLs for @coral-xyz/anchor 0.32.x: fills in type.fields
// for accounts and computes size (modeled on tests/helpers/patch-idl.ts).
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

// enrg_mvp IDL (default idls/enrg_mvp.json — kept in git and always current,
// override via ENRG_IDL_PATH for advanced setups).
const ENRG_IDL_PATH =
    process.env.ENRG_IDL_PATH ||
    path.join(__dirname, 'idls', 'enrg_mvp.json');
let IDL = null;
try {
    IDL = patchIdl(JSON.parse(fs.readFileSync(ENRG_IDL_PATH, 'utf8')));
    // Anchor 0.32: programId comes from idl.address (new Program(idl, provider) call form).
    IDL.address = PROGRAM_ID.toBase58();
    IDL.metadata = IDL.metadata || {};
    IDL.metadata.address = PROGRAM_ID.toBase58();
    logger.info('✅ Loaded enrg_mvp IDL from', ENRG_IDL_PATH);
} catch (e) {
    logger.warn('⚠️ Cannot load enrg_mvp IDL (' + ENRG_IDL_PATH + '):', e.message);
}

// Canonical signing messages (buildDeviceMessage/buildOracleMessage) and
// device_id parsing (parseDevicePubkey) live in the Policy Engine (policy.js,
// ADR-0003) — a single source of truth for server.js and policy.js.

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

// Address Lookup Table: the mint transaction (2× ed25519 + 16 accounts) does not fit
// in the legacy limit (1232 bytes) — we use a v0 transaction (like devnet_e2e_lifecycle.ts).
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
                throw new Error(`Address Lookup Table ${lut.toBase58()} does not contain all addresses after extend`);
            }
            return lutAccount;
        }
    }
    throw new Error('Failed to create Address Lookup Table');
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
    throw new Error('v0 transaction with LUT did not pass after retries');
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

// CR-3: on-chain mint via the Anchor client.
// Takes a proof (an already verified DEVICE signature in the on-chain binary
// format) and signs the OracleReport with the founder key (oracle = FOUNDER_KEY).
// Reference: scripts/devnet_e2e_lifecycle.ts (oracleMint, v0+LUT, 2× ed25519).
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

        // Messages for the ed25519 precompile (match state/oracle.rs).
        const deviceMsg = policy.buildDeviceMessage(deviceIdPubkey, proof.nonce, proof.device_timestamp, proof.energy_wh);
        const oracleMsg = policy.buildOracleMessage(deviceIdPubkey, proof.nonce, proof.device_timestamp, nowSec, proof.energy_wh);
        // Multi-owner mint: the report is signed by the ORACLE (ORACLE_KEY), not the founder.
        const oracleSignature = nacl.sign.detached(new Uint8Array(oracleMsg), oracleKeypair.secretKey);

        // OracleReport (borsh, as in state/oracle.rs): oracle(32) device_id(32) nonce(8)
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

        // ── PDA (as in pdas() in devnet_e2e_lifecycle.ts) ──
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

        // Pre-check: the producer exists; take the OWNER (authority) from it.
        // P0-2 (ADR-0002): if the producer was already fetched from the on-chain Registry in
        // /proof/submit — reuse it (one RPC check per request)
        // otherwise read the registry here.
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

        const [profilePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('profile'), ownerPubkey.toBuffer()], PROFILE_PROGRAM_ID
        );
        const [reputationPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('reputation'), ownerPubkey.toBuffer()], PROGRAM_ID
        );
        logger.info('[mintEnergy] producerPda=' + producerPda.toBase58() +
            ' producer.authority=' + producer.authority.toBase58() +
            ' oracle=' + oracleKeypair.publicKey.toBase58() +
            ' profilePda=' + profilePda.toBase58() +
            ' IDL=' + (ENRG_IDL_PATH || 'default'));
        const userAta = (await getOrCreateAssociatedTokenAccount(
            connection, oracleKeypair, srcMintPda, ownerPubkey
        )).address;
        const fundAtas = {
            buyback: getAssociatedTokenAddressSync(srcMintPda, buybackAuthorityPda, true),
            staking: getAssociatedTokenAddressSync(srcMintPda, fundStakingPda, true),
            dao: getAssociatedTokenAddressSync(srcMintPda, fundDaoPda, true),
            emergency: getAssociatedTokenAddressSync(srcMintPda, fundEmergencyPda, true),
        };

        // Pre-check: without a profile the transaction is bound to fail.
        if (!(await accountExists(connection, profilePda))) {
            return { success: false, error: 'energy_profile_missing_on_chain' };
        }

        // ADR-0003: Policy Registry (PDA [b"policy-registry"]). If the registry
        // is not initialized — pass null (protocol default policies,
        // full backward compatibility). Once initialized, policies
        // are managed via update_policy (registry authority).
        const policyRegistryExists = await accountExists(connection, policyRegistryPda);
        const policyRegistry = policyRegistryExists ? policyRegistryPda : null;

        // ── mint_energy via the Anchor client ──
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

        logger.info('[mintEnergy-ix] profile=' + (mintIx.keys.find(k => k.pubkey.equals(profilePda) || k.pubkey.equals(PublicKey.default))?.pubkey.toBase58()) +
            ' producer=' + producerPda.toBase58() + ' authority(ix)=' + mintIx.keys.find(k => k.isSigner)?.pubkey.toBase58());

        // ── Two ed25519 precompile instructions BEFORE mint_energy ──
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

        // v0 transaction with an Address Lookup Table (2× ed25519 + 16 accounts > legacy limit).
        const lutAddresses = [
            producerPda, vaultPda, tokenMintPda, srcMintPda, mintAuthorityPda, userAta,
            fundAtas.buyback, fundAtas.staking, fundAtas.dao, fundAtas.emergency,
            SYSVAR_INSTRUCTIONS_PUBKEY, oracleRegistryPda, TOKEN_PROGRAM_ID, PROFILE_PROGRAM_ID,
            oracleKeypair.publicKey, profilePda, Ed25519Program.programId,
            // Policy Registry — only if initialized (ADR-0003).
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

// The device_id format (base58/hex) and all input validation live
// in the Policy Engine — policy.validateDeviceId() / policy.validateProof() (ADR-0003).

// === Device registration ===
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

    // CR-1: Policy Engine — device_id format, key/signature lengths and
    // proof-of-possession over the message `${device_id}|${public_key}` (ADR-0003).
    const v = policy.validateRegister(device_id, public_key, signature);
    if (!v.ok) {
        if (v.status === 403) {
            logger.warn(`⛔ Register denied (bad signature) for device ${device_id}`);
        }
        return res.status(v.status).json({ error: v.error });
    }

    // CR-1: forbid overwriting someone else's device_id. If the device exists,
    // the key must match the stored one; otherwise — 403 Forbidden.
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

// M-5: device_id format validation in all read endpoints
// (/status, /balance, /history) — Policy Engine (ADR-0003).
app.param('id', (req, res, next, id) => {
    if (!policy.validateDeviceId(id).ok) {
        return res.status(400).json({ error: 'invalid device_id format (base58 or hex only)' });
    }
    next();
});

// === DEVICE STATUS ===
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

// === BALANCE (stub) ===
app.get('/api/v1/device/:id/balance', (req, res) => {
    const deviceId = req.params.id;
    if (!devices[deviceId]) {
        return res.status(404).json({ error: 'device not found' });
    }
    // A real Solana balance could be fetched here; for now a stub
    res.json({ balance: 0, device_id: deviceId });
});

// === HISTORY (stub) ===
app.get('/api/v1/device/:id/history', (req, res) => {
    const deviceId = req.params.id;
    if (!devices[deviceId]) {
        return res.status(404).json({ error: 'device not found' });
    }
    // For now return an empty array; mint history can be added later
    res.json({ history: [] });
});

// === SIGNED DEVICE MANIFEST (ADR-0004) ===
// The device requests configuration (rated_power, oracle_url) from the oracle and
// verifies the founder (FOUNDER_KEY) signature before using it.
// Canonical signing message — policy.buildManifestMessage() (policy.js),
// reproduced in the ESP32 firmware too (verifyManifest).
app.get('/api/v1/manifest/:device_id', (req, res) => {
    const deviceId = req.params.device_id;

    // device_id format (base58/hex) — via the Policy Engine.
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

    // public_key: the registry key, or (for unregistered devices)
    // the device_id itself (backward compatibility with the "manifest before registration" flow).
    const public_key =
        devices[deviceId] ||
        util.encodeBase64(d.deviceIdPubkey.toBytes());

    // rated_power: optional query parameter (trusted callers only),
    // otherwise — defaultRatedPowerW from the policy configuration.
    let rated_power = policy.config.defaultRatedPowerW;
    if (req.query.rated_power !== undefined) {
        const rp = Number(req.query.rated_power);
        if (!Number.isFinite(rp) || rp <= 0 || rp > 1_000_000_000) {
            return res.status(400).json({ error: 'invalid rated_power (positive number <= 1e9 W)' });
        }
        rated_power = Math.round(rp);
    }

    // oracle_url: the public oracle URL (where the device sends proofs).
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
        // ADR-0004 (audit 2026-08-18, P1-12): required manifest fields.
        trust_level: 'basic',
        heartbeat_interval: 60, // seconds
        proof_threshold: 1,     // Wh, proof formation threshold
        policy_version: 1,
        verifier_endpoint: oracle_url,
    };

    const signature = policy.signManifest(manifest, founderKeypair.secretKey);
    logger.info(`📋 Manifest issued for ${deviceId} (rated_power=${rated_power}W, oracle=${oracle_url})`);
    res.json({ ...manifest, signature });
});

// === FIRMWARE OTA UPDATES (ADR-0008) ===
// The image is signed with the founder key (FOUNDER_KEY) using the
//   version|image_hash|image_size  (policy.buildFirmwareMessage)
// The device verifies the signature + SHA-256(image) before installing.

/** Sanitize the version file name (no paths or special characters). */
function sanitizeVersion(v) {
    return String(v).replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Load latest.json (current firmware metadata) or null. */
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
// Body: raw binary firmware image. Requires x-api-key == FIRMWARE_ADMIN_KEY.
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

// GET /api/v1/firmware/latest — current firmware metadata (signature + hash).
app.get('/api/v1/firmware/latest', (req, res) => {
    const meta = loadFirmwareMeta();
    if (!meta) return res.status(404).json({ error: 'no firmware published' });
    res.json(meta);
});

// GET /api/v1/firmware/latest/image — the current firmware binary image.
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


// === DEVICE REVOKE / KEY ROTATION (ADR-0007) ===
// Both endpoints call on-chain instructions of the enrg_mvp program.
// Transactions are signed with the founder key, which is
// the vault.authority (protocol admin) — allowed on-chain.

/** Producer PDA: [b"producer", device_id]. */
function findProducerPda(deviceIdPubkey) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('producer'), deviceIdPubkey.toBuffer()], PROGRAM_ID
    )[0];
}

/** PDA Vault: [b"vault"]. */
function findVaultPda() {
    return PublicKey.findProgramAddressSync([Buffer.from('vault')], PROGRAM_ID)[0];
}

/** Bootstrap an Anchor client (as in mintEnergy). */
function anchorProgram(connection) {
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(founderKeypair), {
        commitment: 'confirmed',
        preflightCommitment: 'confirmed',
    });
    return new anchor.Program(IDL, provider);
}

/** Read-only Anchor client to fetch accounts without signing transactions. */
function readOnlyProgram(connection) {
    const wallet = new anchor.Wallet(Keypair.generate());
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: 'confirmed',
    });
    return new anchor.Program(IDL, provider);
}

// POST /api/v1/device/revoke/:device_id — revoke a device (founder only).
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
        // owner_devices — Option account; pass null (admin revoke does not
        // need owner_devices). on-chain handles None correctly.
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
//   owner_signature — Ed25519 signature of the owner (producer authority) over
//     `${device_id}|${new_device_id}` — confirmation of the owner's intent;
//   new_device_signature — Ed25519 signature of the NEW key over the binary message
//     b"enrg:device:rotate" || new(32) || owner(32) || nonce(8) || ts(8)
//     (a mirror of the on-chain rotate_device_key).
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

        // 1) The device owner — from the on-chain producer (authority).
        let producer;
        try {
            producer = await program.account.energyProducer.fetch(producerPda);
        } catch (e) {
            return res.status(404).json({ error: 'device_not_registered_on_chain', reason: (e && e.message) || '' });
        }
        const ownerPubkey = new PublicKey(producer.authority.toBytes());

        // 2) The owner's signature over `${device_id}|${new_device_id}`.
        const authMsg = Buffer.from(`${deviceId}|${new_device_id}`, 'utf8');
        const ownerOk = nacl.sign.detached.verify(
            new Uint8Array(authMsg),
            new Uint8Array(Buffer.from(owner_signature, 'base64')),
            new Uint8Array(ownerPubkey.toBytes())
        );
        if (!ownerOk) return res.status(403).json({ error: 'invalid owner signature' });

        // 3) The new key's signature (PoP) over the binary rotate message.
        const nowSec = Math.floor(Date.now() / 1000);
        const rotateNonce = nowSec; // monotonic nonce (unixtime) — > claim_nonce
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

        // 4) On-chain rotate (signed by the founder as protocol admin).
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


// === POOL CREATION ===
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

// === PROOF SUBMISSION ===
// CR-2 / M-3: limits (energyWh, timestamp freshness, nonce, signature) are set
// in the Policy Engine (policy-config.json, ADR-0003) and synced with on-chain
// (constants.rs::MAX_CLOCK_SKEW=300, security/validation.rs::MAX_PROOF_AGE=900).

app.post('/api/v1/proof/submit', async (req, res) => {
    try {
        // P0-2 (ADR-0002): the source of truth for proof verification is on-chain
        // Device Registry (EnergyProducer PDA), NOT the oracle's local DB.
        // Local tables (devices/energyStore) remain only for
        // stats/history and do not determine trust.
        const device_id = req.body && req.body.device_id;
        const d = policy.validateDeviceId(device_id);
        if (!d.ok) return res.status(d.status).json({ error: d.error });
        if (!d.deviceIdPubkey) {
            return res.status(400).json({ error: 'device_id must be a 32-byte Ed25519 public key (base58)' });
        }
        if (!IDL) return res.status(500).json({ error: 'idl_missing' });

        // Read the device from the on-chain Registry.
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

        // ADR-0007: a revoked device does not accept proofs.
        if (producer.revoked) {
            return res.status(403).json({ error: 'device_revoked_on_chain' });
        }
        const devicePubkey = new PublicKey(producer.deviceId.toBytes());
        if (!devicePubkey.equals(d.deviceIdPubkey)) {
            return res.status(400).json({ error: 'device_id mismatch with on-chain registry' });
        }

        // CR-1/CR-2/CR-3/M-3/M-5: ALL incoming proof checks are done by the Policy
        // Engine — policy.validateProof(): device_id format, energyWh, freshness
        // timestamp, unknown device, monotonic nonce and Ed25519 signature.
        // Key and nonce come from the on-chain Registry (single source of truth).
        const onChainNonce = producer.nonce ? producer.nonce.toNumber() : 0;
        const localNonce = (energyStore[device_id] || { nonce: 0 }).nonce;
        const v = policy.validateProof(req.body, {
            getPublicKey: () => Buffer.from(devicePubkey.toBytes()).toString('base64'),
            getLastNonce: () => Math.max(onChainNonce, localNonce),
        });
        if (!v.ok) {
            return res.status(v.status).json({ error: v.error });
        }

        // ── Energy accumulation (whole Wh) + storing the proof for the on-chain mint ──
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
                // P1 (audit 2026-08-18): the off-chain pool does NOT distribute tokens —
                // the previous code that "reset the counter and replied tokens distributed" was
                // a stub. Real distribution happens on-chain
                // (instructions/pool.rs::distribute_pool); the oracle passes pool=null
                // to mintEnergy. We keep accumulating but do not lie.
                logger.warn(`⚠️ Pool ${pool_id}: threshold reached, but off-chain distribution is NOT implemented (on-chain distribute_pool required)`);
                return res.json({
                    ok: true,
                    pool_total: pool.total_energy,
                    warning: 'pool_threshold_reached_offchain_distribution_not_implemented',
                });
            }
            return res.json({ ok: true, pool_total: pool.total_energy });
        }

        logger.info(`📊 Device ${device_id} submitted ${energyWhInt}Wh (nonce=${proof.nonce}, sig=${proof.sig_mode}). Accumulated: ${newEnergy}Wh`);

        // CR-3: on-chain-compatible (binary) signature → each proof is minted
        // in a separate mint_energy transaction (as in devnet_e2e_lifecycle.ts).
        // If minting is temporarily impossible (ORACLE_KEY unset, device not yet
        // registered on-chain, no profile created, RPC unavailable) — the proof
        // IS ACCEPTED, energy accumulates, minting is deferred. This is graceful
        // degradation, not a failure: proofs must not be lost because minting is down.
        if (proof.sig_mode === 'binary') {
            const mintRes = await mintEnergy(proof, producer);
            if (mintRes.success) {
                return res.json({ ok: true, minted: proof.energy_wh, tx: mintRes.tx, accumulated: newEnergy });
            }
            logger.warn(`⚠️ mint_energy deferred for ${device_id}: ${mintRes.error}. Energy accumulated: ${newEnergy}Wh`);
            return res.json({
                ok: true,
                accumulated: newEnergy,
                mint: 'deferred',
                mint_reason: mintRes.error,
            });
        }

        // legacy signature (string format) is incompatible with on-chain mint — accumulation only.
        if (newEnergy >= ENERGY_THRESHOLD) {
            logger.warn(`⚠️ Device ${device_id} reached threshold but mint requires on-chain-compatible (binary) device signature`);
            return res.json({ ok: true, accumulated: newEnergy, note: 'mint_requires_binary_signature' });
        }
        return res.json({ ok: true, accumulated: newEnergy });
    } catch (e) {
        // L-3: log only the message, no stacktrace with host paths.
        logger.error('❌ Error handling proof:', e && e.message);
        return res.status(500).json({ error: (e && e.message) || 'internal error' });
    }
});

// === WEBSITE STATS ===
app.get('/api/v1/stats', (req, res) => {
  try {
    const totalEnergyWh = Object.values(energyStore).reduce((sum, e) => sum + (e.energy_wh || 0), 0);
    const totalEnergyMwh = totalEnergyWh / 1000000;
    const activeProducers = Object.keys(devices).length;
    const totalSupply = 0; // stub
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

// M-2: async startup — storage init (Postgres when DATABASE_URL is set,
// otherwise SQLite) and loading persistent state into memory.
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
