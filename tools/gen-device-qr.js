#!/usr/bin/env node
/**
 * ENRG — device QR-code generator for Plug & Play onboarding (Axis-connect).
 *
 * The QR payload strictly follows the Axis-connect parser:
 *   { "deviceId": "<base58|0x-hex PUBLIC_KEY>", "schema": "axis-energy-v1" }
 *
 * deviceId — the device's public Ed25519 key (32 bytes): "0x"+64hex (as in
 * the ESP32 firmware [INFO] device_id) or base58 (canonical Solana PublicKey).
 *
 * Usage:
 *   node tools/gen-device-qr.js --device-id 0x<64hex>
 *   node tools/gen-device-qr.js --device-id <base58>
 *   node tools/gen-device-qr.js --from-file device.cfg          # file: deviceId=...
 *   node tools/gen-device-qr.js --device-id 0x... --svg --json  # SVG + JSON payload
 *
 * Options:
 *   --device-id <hex|base58>  the device public key
 *   --from-file <path>        read deviceId from a file (lines "deviceId=...",
 *                             "device_id=..."; also scans the log for "0x"-hex)
 *   --out <path>              PNG path (default docs/assets/qr-<short>.png)
 *   --format base58|hex       deviceId format inside the QR (default base58)
 *   --svg                     also save an SVG
 *   --terminal                print the QR to the terminal
 *   --json                    print the JSON payload to stdout
 *   --help                    help
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ── base58 (compact implementation; no external dependencies) ──
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
  // 1) lines "deviceId=..." / "device_id=..." / "device-id=..."
  const re = /device[_-]?id\s*=\s*([^\s;,]+)/i;
  const m = content.match(re);
  if (m && deviceIdToBytes(m[1])) return m[1].trim();
  // 2) "0x" + 64 hex anywhere in the text (e.g., a pasted [INFO] device_id log)
  const hex = content.match(/0[xX][0-9a-fA-F]{64}/);
  if (hex) return hex[0];
  return null;
}
function usage() {
  console.log(`ENRG QR generator for Axis-connect Plug & Play

Usage:
  node tools/gen-device-qr.js --device-id <hex|base58> [options]
  node tools/gen-device-qr.js --from-file <file> [options]

Options:
  --device-id <hex|base58>  the device public Ed25519 key (32 bytes)
  --from-file <path>        read deviceId from a file/log (deviceId=..., or a 0x string)
  --out <path>              PNG path (default docs/assets/qr-<short>.png)
  --format base58|hex       deviceId format inside the QR (default base58)
  --svg                     also save an SVG
  --terminal                print the QR to the terminal
  --json                    print the JSON payload to stdout
  --help                    this help`);
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
    else { console.error(`Unknown option: ${k} (--help)`); process.exit(2); }
  }
  return a;
}

function requireQRCode() {
  // Look for `qrcode` locally: tools/node_modules or the ENRG root node_modules.
  const candidates = [
    path.join(__dirname, 'node_modules', 'qrcode'),
    path.join(__dirname, '..', 'node_modules', 'qrcode'),
  ];
  for (const c of candidates) {
    try { return require(c); } catch (_) { /* next */ }
  }
  return null;
}

/** Pseudo-QR for the terminal (fallback when the qrcode npm package is unavailable). */
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
      console.error(`❌ Failed to extract deviceId from ${a.fromFile}`);
      process.exit(2);
    }
  }
  if (!deviceId) {
    console.error('Error: pass --device-id or --from-file (--help)');
    process.exit(2);
  }

  const bytes = deviceIdToBytes(deviceId);
  if (!bytes) {
    console.error('Error: deviceId must be a 32-byte key (0x+64hex or base58)');
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
      console.log('  (fallback rendering; install "qrcode" for real PNG/SVG)');
      console.log(`  ${payload}`);
      process.exit(0);
    }
    console.error('❌ Package "qrcode" not found. Install it: npm i -D qrcode  (in the ENRG root)');
    console.error(`   Payload for manual entry: ${payload}`);
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
