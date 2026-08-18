const nacl = require('tweetnacl');
const util = require('tweetnacl-util');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = process.argv[2] || 'http://localhost:4000';

// Generate keypair
const keypair = nacl.sign.keyPair();
const publicKey = util.encodeBase64(keypair.publicKey);
const privateKey = keypair.secretKey;

/**
 * Каноническая сериализация — зеркало oracle/registry/app.js (аудит 2026-08-18):
 * рекурсивная сортировка ключей. Без неё подпись над JSON.stringify ломается
 * при переупорядочивании полей.
 */
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

const payload = {
  device_id: 'test-device-001',
  model: 'ENRG-ESP32-v1',
  firmware_version: '2026.07.17',
  timestamp: new Date().toISOString()
};

// Sign canonical payload
const msg = Buffer.from(canonicalize(payload), 'utf8');
const sig = nacl.sign.detached(msg, privateKey);
const signature = util.encodeBase64(sig);

// manifest_id: ровно 16 байт (on-chain register_manifest_verification принимает [u8; 16]).
// uuidv4() без дефисов = 32 hex = 16 байт.
const manifest_id = uuidv4().replace(/-/g, '');
if (Buffer.from(manifest_id, 'utf8').length !== 16) {
  throw new Error('manifest_id must be 16 bytes');
}

const envelope = {
  manifest_id,
  payload,
  signature,
  public_key: publicKey
};

fetch(`${BASE_URL}/api/v1/manifests`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(envelope)
})
.then(res => res.json())
.then(data => {
  console.log('✅ Manifest published:', data);
  console.log('Public key (save for later):', publicKey);
})
.catch(err => console.error('❌ Error:', err));
