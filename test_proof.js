const nacl = require('tweetnacl');
const bs58 = require('bs58');

// Генерируем ключевую пару для теста
const keypair = nacl.sign.keyPair();
const publicKeyBase64 = Buffer.from(keypair.publicKey).toString('base64');
const privateKeyBase64 = Buffer.from(keypair.secretKey).toString('base64');

console.log('🔑 Public key (base64):', publicKeyBase64);
console.log('🔑 Private key (base64):', privateKeyBase64);

// Создаём сообщение
const deviceId = 'test';
const timestamp = Math.floor(Date.now() / 1000);
const energyWh = 100;
const nonce = 3;

const message = `${deviceId}|${timestamp}|${energyWh}|${nonce}`;
const messageBytes = Buffer.from(message, 'utf8');

// Подписываем
const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
const signatureBase64 = Buffer.from(signature).toString('base64');

console.log('📝 Message:', message);
console.log('✍️ Signature (base64):', signatureBase64);
console.log('\n=== Команда для отправки ===');
console.log(`curl -X POST http://localhost:3000/api/v1/proof/submit \\`);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(`  -d '{"device_id":"${deviceId}","timestamp":${timestamp},"energyWh":${energyWh},"nonce":${nonce},"signature":"${signatureBase64}"}'`);
