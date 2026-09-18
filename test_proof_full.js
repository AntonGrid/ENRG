const nacl = require('tweetnacl');
const fs = require('fs');

// Never commit key material: the previous revision of this file hardcoded a
// device private key — it is gone. Point DEVICE_KEY_PATH at a Solana-style
// keypair JSON (64-byte array, the format `solana-keygen new --outfile` writes),
// e.g. the pilot device created by scripts/devnet_mint_third_party.ts.
// For the modern binary-mode submission against a running oracle, prefer
// scripts/submit-proof-to-oracle.js.
const KEY_PATH = process.env.DEVICE_KEY_PATH || '';
if (!KEY_PATH) {
  console.error('✗ set DEVICE_KEY_PATH=<keypair.json> (the hardcoded key was removed on purpose)');
  process.exit(1);
}
const keypair = nacl.sign.keyPair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(KEY_PATH, 'utf8')))
);

// A device id is the device public key (base58); override with DEVICE_ID for a
// local experiment.
const deviceId =
  process.env.DEVICE_ID ||
  new (require('@solana/web3.js').PublicKey)(keypair.publicKey).toBase58();

const timestamp = Math.floor(Date.now() / 1000);
const energyWh = 1000000; // 1 MWh
const nonce = 2;

const message = `${deviceId}|${timestamp}|${energyWh}|${nonce}`;
const messageBytes = Buffer.from(message, 'utf8');

const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
const signatureBase64 = Buffer.from(signature).toString('base64');

console.log('📝 Message:', message);
console.log('✍️ Signature (base64):', signatureBase64);
console.log('\n=== Command to send ===');
console.log(`curl -X POST http://localhost:3000/api/v1/proof/submit \\`);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(`  -d '{"device_id":"${deviceId}","timestamp":${timestamp},"energyWh":${energyWh},"nonce":${nonce},"signature":"${signatureBase64}"}'`);

console.log('📝 Message:', message);
console.log('✍️ Signature (base64):', signatureBase64);
console.log('\n=== Command to send ===');
console.log(`curl -X POST http://localhost:3000/api/v1/proof/submit \\`);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(`  -d '{"device_id":"${deviceId}","timestamp":${timestamp},"energyWh":${energyWh},"nonce":${nonce},"signature":"${signatureBase64}"}'`);
