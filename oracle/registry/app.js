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

function verifySignature(payload, signature, publicKey) {
  try {
    const msg = Buffer.from(JSON.stringify(payload));
    const sig = util.decodeBase64(signature);
    const pub = util.decodeBase64(publicKey);
    return nacl.sign.detached.verify(msg, sig, pub);
  } catch (e) {
    return false;
  }
}

function canonicalize(data) {
  return typeof data === 'string' ? data : JSON.stringify(data);
}

// SHA-256 — single hash, per AXIS docs/merkle-proof-verification.md.
function hash(data) {
  return crypto.createHash('sha256').update(data).digest();
}

/**
 * Build a Merkle tree bottom-up exactly as specified in
 * docs/merkle-proof-verification.md ("Create Merkle Tree (Off-chain)"):
 *   parent = hash(left || right); odd node is duplicated.
 * Returns the root (Buffer, 32 bytes).
 */
function buildMerkleRoot(leaves) {
  if (leaves.length === 0) {
    return Buffer.alloc(32, 0);
  }

  let currentLevel = leaves.map((leaf) => hash(leaf));

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
 * Compute the canonical leaf hash for a manifest.
 * On-chain verification compares proved leaves against this scheme, so the
 * leaf input MUST be deterministic across implementations.
 */
function manifestLeafHash(manifest_id, entry) {
  return hash(Buffer.concat([
    Buffer.from(manifest_id, 'utf8'),
    Buffer.from(canonicalize(entry.payload || entry)),
  ]));
}

function createSnapshot() {
  const ids = Array.from(manifests.keys());
  const leaves = ids.map((id) => manifestLeafHash(id, manifests.get(id)));
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

  if (!verifySignature(payload, signature, public_key)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  manifests.set(manifest_id, { payload, signature, public_key, created_at: new Date().toISOString() });
  res.status(201).json({ manifest_id, status: 'published' });
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
