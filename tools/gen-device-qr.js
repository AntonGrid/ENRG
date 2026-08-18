#!/usr/bin/env node
/**
 * ENRG — генерация QR-кода устройства для Plug & Play онбординга (Axis-connect).
 *
 * Пейлоад QR строго соответствует парсеру Axis-connect:
 *   { "deviceId": "<base58|0x-hex PUBLIC_KEY>", "schema": "axis-energy-v1" }
 *
 * deviceId — публичный Ed25519-ключ устройства (32 байта): "0x"+64hex (как в
 * [INFO] device_id прошивки ESP32) или base58 (канонический Solana PublicKey).
 *
 * Использование:
 *   node tools/gen-device-qr.js --device-id 0x<64hex>
 *   node tools/gen-device-qr.js --device-id <base58>
 *   node tools/gen-device-qr.js --from-file device.cfg          # файл: deviceId=...
 *   node tools/gen-device-qr.js --device-id 0x... --svg --json  # SVG + JSON payload
 *
 * Опции:
 *   --device-id <hex|base58>  публичный ключ устройства
 *   --from-file <path>        прочитать deviceId из файла (строки "deviceId=...",
 *                             "device_id=..."; также ищет "0x"-hex прямо в логе)
 *   --out <path>              путь PNG (по умолчанию docs/assets/qr-<short>.png)
 *   --format base58|hex       формат deviceId внутри QR (по умолчанию base58)
 *   --svg                     дополнительно сохранить SVG
 *   --terminal                вывести QR в терминал
 *   --json                    вывести JSON-пейлоад в stdout
 *   --help                    справка
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ── base58 (компактная реализация; без внешних зависимостей) ──
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes) {
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

function base58Decode(text) {
  const clean = text.trim();
  if (!clean) return null;
  let zeros = 0;
  for (let i = 0; i < clean.length && clean[i] === '1'; i++) zeros++;
  let num = 0n;
  for (let i = 0; i < clean.length; i++) {
    const idx = B58_ALPHABET.indexOf(clean[i]);
    if (idx < 0) return null;
    num = num * 58n + BigInt(idx);
  }
  if (num === 0n) return Buffer.alloc(zeros);
  const tmp = [];
  while (num > 0n) {
    tmp.push(Number(num & 0xffn));
    num >>= 8n;
  }
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(tmp.reverse())]);
}

function deviceIdToBytes(deviceId) {
  if (!deviceId || typeof deviceId !== 'string') return null;
  if (/^0[xX][0-9a-fA-F]{64}$/.test(deviceId)) {
    const clean = deviceId.slice(2);
    const out = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  const b58 = base58Decode(deviceId);
  if (b58 && b58.length === 32) return b58;
  return null;
}

function readDeviceIdFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  // 1) строки "deviceId=..." / "device_id=..." / "device-id=..."
  const re = /device[_-]?id\s*=\s*([^\s;,]+)/i;
  const m = content.match(re);
  if (m && deviceIdToBytes(m[1])) return m[1].trim();
  // 2) "0x" + 64 hex прямо в тексте (напр., вставленный лог [INFO] device_id)
  const hex = content.match(/0[xX][0-9a-fA-F]{64}/);
  if (hex) return hex[0];
  return null;
}
function usage() {
  console.log(`ENRG QR-генератор для Axis-connect Plug & Play

Использование:
  node tools/gen-device-qr.js --device-id <hex|base58> [опции]
  node tools/gen-device-qr.js --from-file <файл> [опции]

Опции:
  --device-id <hex|base58>  публичный Ed25519-ключ устройства (32 байта)
  --from-file <path>        прочитать deviceId из файла/лога (deviceId=..., или 0x-строка)
  --out <path>              путь PNG (по умолчанию docs/assets/qr-<short>.png)
  --format base58|hex       формат deviceId внутри QR (по умолчанию base58)
  --svg                     дополнительно сохранить SVG
  --terminal                вывести QR в терминал
  --json                    вывести JSON-пейлоад в stdout
  --help                    эта справка`);
}

function parseArgs(argv) {
  const a = { format: 'base58', svg: false, terminal: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : null);
    if (k === '--device-id') a.deviceId = next();
    else if (k === '--from-file') a.fromFile = next();
    else if (k === '--out') a.out = next();
    else if (k === '--format') a.format = next();
    else if (k === '--svg') a.svg = true;
    else if (k === '--terminal') a.terminal = true;
    else if (k === '--json') a.json = true;
    else if (k === '--help' || k === '-h') { usage(); process.exit(0); }
    else { console.error(`Неизвестная опция: ${k} (--help)`); process.exit(2); }
  }
  return a;
}

function requireQRCode() {
  // Ищем `qrcode` локально: tools/node_modules или корневой node_modules ENRG.
  const candidates = [
    path.join(__dirname, 'node_modules', 'qrcode'),
    path.join(__dirname, '..', 'node_modules', 'qrcode'),
  ];
  for (const c of candidates) {
    try { return require(c); } catch (_) { /* next */ }
  }
  return null;
}

/** Псевдо-QR в терминал (fallback, если npm-пакет qrcode недоступен). */
function terminalQr(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const size = 21;
  let out = '';
  for (let y = 0; y < size; y++) {
    let line = '';
    for (let x = 0; x < size; x++) {
      const inFinder = (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
      const inCore = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      const black = inFinder ? !inCore : (h ^ ((x * 31 + y * 17) >>> 0)) % 100 < 48;
      line += black ? '██' : '  ';
    }
    out += line + '\n';
  }
  return out;
}
async function main() {
  const a = parseArgs(process.argv.slice(2));

  let deviceId = a.deviceId;
  if (!deviceId && a.fromFile) {
    deviceId = readDeviceIdFromFile(a.fromFile);
    if (!deviceId) {
      console.error(`❌ Не удалось извлечь deviceId из ${a.fromFile}`);
      process.exit(2);
    }
  }
  if (!deviceId) {
    console.error('Ошибка: укажите --device-id или --from-file (--help)');
    process.exit(2);
  }

  const bytes = deviceIdToBytes(deviceId);
  if (!bytes) {
    console.error('Ошибка: deviceId должен быть 32-байтовым ключом (0x+64hex или base58)');
    process.exit(2);
  }

  const deviceIdOut =
    a.format === 'hex' ? '0x' + bytes.toString('hex') : base58Encode(bytes);
  const payload = JSON.stringify({ deviceId: deviceIdOut, schema: 'axis-energy-v1' });

  const short = bytes.toString('hex').slice(-4);
  const outPath = a.out || path.join(__dirname, '..', 'docs', 'assets', `qr-${short}.png`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (a.json) console.log(payload);

  const QRCode = requireQRCode();
  if (!QRCode) {
    if (a.terminal) {
      console.log(terminalQr(payload));
      console.log('  (fallback-представление; установите "qrcode" для настоящего PNG/SVG)');
      console.log(`  ${payload}`);
      process.exit(0);
    }
    console.error('❌ Пакет "qrcode" не найден. Установите: npm i -D qrcode  (в корне ENRG)');
    console.error(`   Пейлоад для ручного ввода: ${payload}`);
    process.exit(1);
  }

  await QRCode.toFile(outPath, payload, { width: 640, margin: 2, errorCorrectionLevel: 'M' });
  console.log(`✅ PNG: ${outPath}`);
  console.log(`   Payload: ${payload}`);

  if (a.svg) {
    const svgPath = outPath.replace(/\.png$/, '.svg');
    await QRCode.toFile(svgPath, payload, {
      type: 'svg',
      width: 640,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    console.log(`✅ SVG: ${svgPath}`);
  }

  if (a.terminal) {
    try {
      const term = await QRCode.toString(payload, { type: 'terminal', small: true });
      console.log('\n' + term);
    } catch (_) {
      console.log(terminalQr(payload));
    }
  }
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
