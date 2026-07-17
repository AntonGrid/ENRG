const express = require('express');
const nacl = require('tweetnacl');
const util = require('tweetnacl-util');
const keccak = require('keccak');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const ADMIN_KEY = process.env.REGISTRY_ADMIN_KEY || 'secure-key';
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

function createSnapshot() {
  const ids = Array.from(manifests.keys());
  let root = Buffer.alloc(32, 0);
  for (const id of ids) {
    const entry = manifests.get(id);
    const hash = keccak('keccak256').update(canonicalize(entry)).digest();
    root = keccak('keccak256').update(Buffer.concat([root, hash])).digest();
  }

  return {
    id: uuidv4(),
    root: root.toString('hex'),
    total: ids.length,
    timestamp: new Date().toISOString()
  };
}

router.get('/health', (req, res) => {
  res.json({ ok: true, service: SERVICE_NAME, manifests: manifests.size, snapshots: snapshots.length });
});

router.post('/api/v1/manifests', (req, res) => {
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

router.get('/api/v1/manifests', (req, res) => {
  res.json(Array.from(manifests.entries()).map(([manifest_id, entry]) => ({ manifest_id, ...entry })));
});

router.get('/api/v1/manifests/:id', (req, res) => {
  const entry = manifests.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  res.json(entry);
});

router.post('/api/v1/merkle/snapshot', (req, res) => {
  if (req.headers['x-api-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const snapshot = createSnapshot();
  snapshots.push(snapshot);
  res.status(201).json(snapshot);
});

router.get('/api/v1/merkle/current', (req, res) => {
  if (snapshots.length === 0) {
    return res.json({ root: null, message: 'No snapshots yet' });
  }
  res.json(snapshots[snapshots.length - 1]);
});

module.exports = router;
