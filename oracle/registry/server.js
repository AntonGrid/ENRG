const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const nacl = require('tweetnacl');
const util = require('tweetnacl-util');
const keccak = require('keccak');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;
const ADMIN_KEY = process.env.REGISTRY_ADMIN_KEY || 'secure-key';

// In-memory storage (for demo only — use DB in production)
const manifests = new Map();
const snapshots = [];

// Verify ED25519 signature
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

// POST /api/v1/manifests
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

// GET /api/v1/manifests/{manifest_id}
app.get('/api/v1/manifests/:id', (req, res) => {
  const entry = manifests.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  res.json(entry);
});

// POST /api/v1/merkle/snapshot
app.post('/api/v1/merkle/snapshot', (req, res) => {
  if (req.headers['x-api-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const ids = Array.from(manifests.keys());
  let root = Buffer.alloc(32);
  for (const id of ids) {
    const entry = manifests.get(id);
    const hash = keccak('keccak256').update(JSON.stringify(entry)).digest();
    root = keccak('keccak256').update(Buffer.concat([root, hash])).digest();
  }
  const snapshot = {
    id: uuidv4(),
    root: root.toString('hex'),
    total: ids.length,
    timestamp: new Date().toISOString()
  };
  snapshots.push(snapshot);
  res.status(201).json(snapshot);
});

// GET /api/v1/merkle/current
app.get('/api/v1/merkle/current', (req, res) => {
  if (snapshots.length === 0) {
    return res.json({ root: null, message: 'No snapshots yet' });
  }
  res.json(snapshots[snapshots.length - 1]);
});

app.listen(PORT, () => {
  console.log(`Manifest Registry running on port ${PORT}`);
});
