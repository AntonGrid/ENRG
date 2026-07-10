const nacl = require('tweetnacl');

// Используем уже сгенерированную ключевую пару
const privateKeyBase64 = 'jMId88L7QgB+cK64E42tReTu/hbyWDXRhTBIfBbIqouI3Wv4kDSWkFBOoJ+hINhVMOyhlo2L+T/2iMGjaP6aOA==';
const privateKey = Buffer.from(privateKeyBase64, 'base64');

const deviceId = 'test';
const timestamp = Math.floor(Date.now() / 1000);
const energyWh = 1000000; // 1 MWh
const nonce = 2;

const message = `${deviceId}|${timestamp}|${energyWh}|${nonce}`;
const messageBytes = Buffer.from(message, 'utf8');

const signature = nacl.sign.detached(messageBytes, privateKey);
const signatureBase64 = Buffer.from(signature).toString('base64');

console.log('📝 Message:', message);
console.log('✍️ Signature (base64):', signatureBase64);
console.log('\n=== Команда для отправки ===');
console.log(`curl -X POST http://localhost:3000/api/v1/proof/submit \\`);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(`  -d '{"device_id":"${deviceId}","timestamp":${timestamp},"energyWh":${energyWh},"nonce":${nonce},"signature":"${signatureBase64}"}'`);
