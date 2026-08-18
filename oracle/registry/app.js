const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const nacl = require('tweetnacl');
const util = require('tweetnacl-util');
const crypto = require('crypto'); // built-in SHA-256
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;
// H-5: дефолтного admin-ключа больше нет. REGISTRY_ADMIN_KEY обязателен
// и должен быть достаточно длинным (≥32 символов) — иначе сервер не стартует.
const ADMIN_KEY = process.env.REGISTRY_ADMIN_KEY;
if (!ADMIN_KEY || ADMIN_KEY.length < 32) {
  throw new Error('REGISTRY_ADMIN_KEY is required and must be at least 32 characters long');
}
const SERVICE_NAME = process.env.SERVICE_NAME || 'enrg-manifest-registry';

const manifests = new Map();
const snapshots = [];

// ══════════════════════════════════════════════════════════════════
//  Каноническая сериализация (аудит 2026-08-18, P1):
//  JSON.stringify не каноничен (порядок ключей зависит от порядка вставки),
//  что делает подписи и leaf-хэши недетерминированными. Используем
//  RFC-8785-совместимый подход: рекурсивная сортировка ключей + детерминированное
//  экранирование строк. Применяется и к подписям, и к leaf-хэшам манифестов.
// ══════════════════════════════════════════════════════════════════
function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

function verifySignature(payload, signature, publicKey) {
  try {
    // Подпись над КАНОНИЧЕСКИМ представлением payload (детерминизм).
    const msg = Buffer.from(canonicalize(payload), 'utf8');
    const sig = util.decodeBase64(signature);
    const pub = util.decodeBase64(publicKey);
    return nacl.sign.detached.verify(msg, sig, pub);
  } catch (e) {
    return false;
  }
}

// SHA-256 — single hash, per AXIS docs/merkle-proof-verification.md.
function hash(data) {
  return crypto.createHash('sha256').update(data).digest();
}

/**
 * Build a Merkle tree bottom-up exactly as specified in
 * docs/merkle-proof-verification.md ("Create Merkle Tree (Off-chain)"):
 *   parent = hash(left || right); odd node is duplicated.
 *
 * ВАЖНО (аудит 2026-08-18, P0-1): листья УЖЕ являются 32-байт хэшами
 * (leaf = SHA-256(manifest_id || content_hash)) и повторно НЕ хэшируются —
 * это согласовано с on-chain compute_merkle_root (merkle_proof_verification.rs),
 * иначе off-chain корень никогда не совпадёт с on-chain.
 * Returns the root (Buffer, 32 bytes).
 */
function buildMerkleRoot(leaves) {
  if (leaves.length === 0) {
    return Buffer.alloc(32, 0);
  }

  let currentLevel = leaves;

  while (currentLevel.length > 1) {
    const nextLevel = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      nextLevel.push(hash(Buffer.concat([left, right])));
    }
    currentLevel = nextLevel;
  }

  return currentLevel[0];
}

/**
 * Детерминированный content_hash манифеста (SHA-256 от канонического payload).
 * Используется и для подписи издателя, и для Merkle-листьев.
 */
function manifestContentHash(payload) {
  return hash(Buffer.from(canonicalize(payload), 'utf8'));
}

/**
 * Канонический leaf-хэш манифеста — СОГЛАСОВАН с on-chain
 * (`programs/enrg-mvp/src/instructions/merkle_proof_verification.rs`,
 * `manifest_leaf_hash`): leaf = SHA-256(manifest_id(16) || content_hash(32)).
 * On-chain verify_merkle_proof проверяет именно эту формулу (аудит 2026-08-18, P0-1).
 */
function manifestLeafHash(manifest_id, content_hash) {
  const mid = Buffer.from(manifest_id, 'utf8');
  if (mid.length !== 16) {
    throw new Error(`manifest_id must be exactly 16 bytes, got ${mid.length}`);
  }
  return hash(Buffer.concat([mid, Buffer.from(content_hash, 'hex')]));
}

function createSnapshot() {
  const ids = Array.from(manifests.keys());
  const leaves = ids.map((id) => {
    const entry = manifests.get(id);
    return manifestLeafHash(id, entry.content_hash);
  });
  const root = buildMerkleRoot(leaves);

  return {
    id: uuidv4(),
    root: root.toString('hex'),
    total: ids.length,
    timestamp: new Date().toISOString()
  };
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: SERVICE_NAME, manifests: manifests.size, snapshots: snapshots.length });
});

app.post('/api/v1/manifests', (req, res) => {
  const { manifest_id, payload, signature, public_key } = req.body;
  if (!manifest_id || !payload || !signature || !public_key) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  if (Buffer.from(manifest_id, 'utf8').length !== 16) {
    return res.status(400).json({ error: 'manifest_id must be exactly 16 bytes (utf8)' });
  }

  if (!verifySignature(payload, signature, public_key)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Сохраняем content_hash для детерминированных Merkle-листьев (P0-1).
  const content_hash = manifestContentHash(payload);
  manifests.set(manifest_id, {
    payload,
    content_hash: content_hash.toString('hex'),
    signature,
    public_key,
    created_at: new Date().toISOString()
  });
  res.status(201).json({ manifest_id, status: 'published', content_hash: content_hash.toString('hex') });
});

app.get('/api/v1/manifests/:id', (req, res) => {
  const entry = manifests.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  res.json(entry);
});

app.post('/api/v1/merkle/snapshot', (req, res) => {
  if (req.headers['x-api-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const snapshot = createSnapshot();
  snapshots.push(snapshot);
  res.status(201).json(snapshot);
});

app.get('/api/v1/merkle/current', (req, res) => {
  if (snapshots.length === 0) {
    return res.json({ root: null, message: 'No snapshots yet' });
  }
  res.json(snapshots[snapshots.length - 1]);
});

app.get('/api/v1/manifests', (req, res) => {
  res.json(Array.from(manifests.entries()).map(([manifest_id, entry]) => ({ manifest_id, ...entry })));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`${SERVICE_NAME} running on port ${PORT}`);
  });
}

module.exports = app;
