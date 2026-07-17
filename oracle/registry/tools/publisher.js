const nacl = require('tweetnacl');
const util = require('tweetnacl-util');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = process.argv[2] || 'http://localhost:4000';

// Generate keypair
const keypair = nacl.sign.keyPair();
const publicKey = util.encodeBase64(keypair.publicKey);
const privateKey = keypair.secretKey;

const payload = {
  device_id: 'test-device-001',
  model: 'ENRG-ESP32-v1',
  firmware_version: '2026.07.17',
  timestamp: new Date().toISOString()
};

// Sign payload
const msg = Buffer.from(JSON.stringify(payload));
const sig = nacl.sign.detached(msg, privateKey);
const signature = util.encodeBase64(sig);

const envelope = {
  manifest_id: uuidv4(),
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
