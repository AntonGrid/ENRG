const express = require('express');
const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');
const { Connection, clusterApiUrl, Keypair, Transaction, TransactionInstruction, PublicKey, sendAndConfirmTransaction, SystemProgram } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token');
const crypto = require('crypto');
const cors = require('cors');

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

function saveJson(filePath, obj) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('❌ Failed to save', filePath, ':', e.message);
  }
}

devices = loadJson(DEVICES_FILE);
energyStore = loadJson(ENERGY_STORE_FILE);
pools = loadJson(POOLS_FILE);
console.log('✅ Loaded devices:', devices);
console.log('✅ Loaded pools:', pools);

let founderKeypair = null;
if (process.env.FOUNDER_KEY) {
  try {
    const arr = JSON.parse(process.env.FOUNDER_KEY);
    founderKeypair = Keypair.fromSecretKey(Uint8Array.from(arr));
    console.log('✅ Loaded founder keypair from FOUNDER_KEY env var');
  } catch (e) {
    console.warn('⚠️ Failed to parse FOUNDER_KEY:', e.message);
  }
}
if (!founderKeypair) {
  console.warn('⚠️ Founder keypair not found. Minting will not work.');
}

const app = express();
app.use(express.json());
app.use(cors({
  origin: ['https://enrg.network', 'https://www.enrg.network', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.static(path.join(__dirname, 'web')));

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
    console.log('✅ Producer already exists:', producerPda.toBase58());
    return true;
  }
  console.log('🔄 Creating producer...');
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
  console.log('✅ Producer created. TX:', sig);
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
    console.log('🎉 Mint successful! TX:', sig);
    return { success: true, tx: sig };
  } catch (e) {
    console.error('❌ mintEnergy error:', e);
    return { success: false, error: e.message };
  }
}

app.post('/api/v1/device/register', (req, res) => {
  console.log('📥 Registration request body:', req.body);
  const { device_id, public_key } = req.body;
  if (!device_id || !public_key) {
    return res.status(400).json({ error: 'missing device_id or public_key' });
  }
  if (devices[device_id]) {
    return res.status(400).json({ error: 'device already registered' });
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
  saveJson(DEVICES_FILE, devices);
  console.log(`✅ Device registered: ${device_id}`);
  res.json({ ok: true, message: 'Device registered successfully' });
});

app.get('/api/v1/device/:id/status', (req, res) => {
  const deviceId = req.params.id;
  if (!devices[deviceId]) {
    return res.status(404).json({ error: 'device not found' });
  }
  const energy = energyStore[deviceId] || 0;
  res.json({
    device_id: deviceId,
    is_initialized: true,
    energy_wh: energy,
  });
});

app.get('/api/v1/device/:id/balance', async (req, res) => {
  const deviceId = req.params.id;
  if (!devices[deviceId]) {
    return res.status(404).json({ error: 'device not found' });
  }
  // Здесь можно добавить запрос к Solana для получения реального баланса
  // Пока возвращаем 0
  res.json({ balance: 0, device_id: deviceId });
});

app.post('/api/v1/pool/create', (req, res) => {
  const { pool_id, threshold } = req.body;
  if (!pool_id || !threshold) {
    return res.status(400).json({ error: 'missing pool_id or threshold' });
  }
  if (pools[pool_id]) {
    return res.status(400).json({ error: 'pool already exists' });
  }
  pools[pool_id] = {
    threshold,
    devices: [],
    total_energy: 0,
    device_energy: {},
    created_at: Date.now()
  };
  saveJson(POOLS_FILE, pools);
  res.json({ ok: true, pool: pools[pool_id] });
});

app.post('/api/v1/proof/submit', async (req, res) => {
  try {
    const { device_id, timestamp, energyWh, nonce, signature, pool_id } = req.body;
    if (!device_id || !timestamp || energyWh === undefined || !nonce || !signature) {
      return res.status(400).json({ error: 'missing fields' });
    }
    const publicKeyB64 = devices[device_id];
    if (!publicKeyB64) return res.status(400).json({ error: 'unknown device' });
    const msg = `${device_id}|${timestamp}|${energyWh}|${nonce}`;
    const msgBytes = Buffer.from(msg, 'utf8');
    const sigBytes = Buffer.from(signature, 'base64');
    const pubBytes = Buffer.from(publicKeyB64, 'base64');
    if (pubBytes.length !== 32) {
      console.log(`Bad public key size: ${pubBytes.length}`);
      return res.status(400).json({ error: 'bad public key size' });
    }
    const verified = nacl.sign.detached.verify(
      new Uint8Array(msgBytes), new Uint8Array(sigBytes), new Uint8Array(pubBytes)
    );
    if (!verified) return res.status(400).json({ error: 'invalid signature' });
    if (pool_id && pools[pool_id]) {
      const pool = pools[pool_id];
      if (!pool.devices.includes(device_id)) {
        pool.devices.push(device_id);
      }
      if (!pool.device_energy) pool.device_energy = {};
      pool.device_energy[device_id] = (pool.device_energy[device_id] || 0) + Number(energyWh);
      pool.total_energy += Number(energyWh);
      saveJson(POOLS_FILE, pools);
      console.log(`📊 Pool ${pool_id}: +${energyWh}Wh, total: ${pool.total_energy}Wh`);
      if (pool.total_energy >= pool.threshold) {
        console.log(`🎯 Pool ${pool_id} threshold reached! Distributing tokens...`);
        const totalEnergy = pool.total_energy;
        const deviceShares = pool.devices.map((devId) => ({
          device_id: devId,
          share: pool.device_energy[devId] || 0,
        }));
        const totalShare = deviceShares.reduce((sum, d) => sum + d.share, 0);
        if (totalShare > 0) {
          for (const entry of deviceShares) {
            const amount = Math.floor((entry.share / totalShare) * totalEnergy);
            if (amount > 0) {
              console.log(`📤 Minting ${amount}Wh for device ${entry.device_id}`);
              await mintEnergy(entry.device_id, amount);
            }
          }
        } else {
          console.warn(`⚠️ No device shares in pool ${pool_id}`);
        }
        pool.total_energy = 0;
        pool.device_energy = {};
        saveJson(POOLS_FILE, pools);
        return res.json({ ok: true, message: 'Pool threshold reached, tokens distributed' });
      }
      return res.json({ ok: true, pool_total: pool.total_energy });
    }
    const prev = energyStore[device_id] || 0;
    const total = prev + Number(energyWh);
    energyStore[device_id] = total;
    saveJson(ENERGY_STORE_FILE, energyStore);
    console.log(`📊 Device ${device_id} submitted ${energyWh}Wh (nonce=${nonce}). Accumulated: ${total}Wh`);
    if (total >= ENERGY_THRESHOLD) {
      console.log(`🎯 Threshold reached for ${device_id}: minting ${total}`);
      await createProducerIfNeeded();
      const mintRes = await mintEnergy(device_id, total);
      if (mintRes.success) {
        energyStore[device_id] = 0;
        saveJson(ENERGY_STORE_FILE, energyStore);
        return res.json({ ok: true, minted: total, tx: mintRes.tx });
      } else {
        return res.status(500).json({ error: 'mint_failed', reason: mintRes.error });
      }
    }
    return res.json({ ok: true, accumulated: total });
  } catch (e) {
    console.error('❌ Error handling proof:', e);
    return res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Oracle server listening on port ${PORT}`));
