#!/usr/bin/env node
/**
 * ENRG — регистрация устройства в оракуле (PoP-подпись через Serial-команду SIGN).
 *
 * Flow (ADR-0001: приватный ключ остаётся на устройстве, наружу — только подпись):
 *   1. `node register-device.js --prepare --device-id 0x...`
 *        → выводит public_key (base64) и hex PoP-сообщения `${device_id}|${public_key}`.
 *   2. В мониторе ESP32 (`pio device monitor`) выполнить:
 *        SIGN <hex из шага 1>
 *        → скопировать строку `[SIGN] sig_base64   = <...>`.
 *   3. `node register-device.js --send --device-id 0x... --signature <sig_base64> [--url ...]`
 *        → POST /api/v1/device/register; после этого ESP32 получает 200 OK на proof'ы.
 *
 * Опции:
 *   --device-id  <0x-hex|base58>  device_id устройства (из INFO / логов / манифеста)
 *   --prepare                     вывести hex сообщения для команды SIGN (без сети)
 *   --send                        отправить POST /api/v1/device/register
 *   --signature <base64>          подпись от ESP32 (строка [SIGN] sig_base64)
 *   --public-key <base64>         (опц.) не вычислять из device_id
 *   --url <http://host:3000>      адрес оракула (по умолчанию http://192.168.1.123:3000)
 *   --json                        выводить ответы в JSON
 *   --help                        эта справка
 */
'use strict';

const path = require('path');

// device_id → 32 байта (hex 0x… или base58).
function deviceIdToBytes(deviceId) {
    if (typeof deviceId !== 'string' || !deviceId) return null;
    if (/^0x[0-9a-fA-F]{64}$/.test(deviceId)) {
        return Buffer.from(deviceId.slice(2), 'hex');
    }
    try {
        // base58 (bs58 доступен в node_modules ENRG — используется policy.js).
        const bs58 = require(path.join(__dirname, '..', 'node_modules', 'bs58')).default;
        const b = bs58.decode(deviceId);
        if (b.length === 32) return Buffer.from(b);
    } catch (_) { /* not base58 */ }
    return null;
}

function usage() {
    console.log(`Использование: node register-device.js <--prepare|--send> --device-id <0x-hex|base58> [опции]

  --prepare        вывести hex PoP-сообщения для команды SIGN (без сети)
  --send           отправить POST /api/v1/device/register

  --device-id      device_id устройства (напр. 0xcbec5afc...)
  --signature      (для --send) подпись от ESP32 — строка [SIGN] sig_base64
  --public-key     (опц.) base64 публичного ключа; иначе вычисляется из device_id
  --url            адрес оракула (default: http://192.168.1.123:3000)
  --json           выводить JSON-ответы
  --help           эта справка`);
}

function parseArgs(argv) {
    const a = { prepare: false, send: false, json: false, url: 'http://192.168.1.123:3000' };
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        const next = () => (i + 1 < argv.length ? argv[++i] : null);
        if (k === '--prepare') a.prepare = true;
        else if (k === '--send') a.send = true;
        else if (k === '--device-id') a.deviceId = next();
        else if (k === '--signature') a.signature = next();
        else if (k === '--public-key') a.publicKeyB64 = next();
        else if (k === '--url') a.url = next();
        else if (k === '--json') a.json = true;
        else if (k === '--help' || k === '-h') { usage(); process.exit(0); }
        else { console.error(`Неизвестная опция: ${k} (--help)`); process.exit(2); }
    }
    return a;
}

async function main() {
    const a = parseArgs(process.argv.slice(2));

    if (!a.deviceId) {
        console.error('Ошибка: укажите --device-id (--help)');
        process.exit(2);
    }
    const pubBytes = deviceIdToBytes(a.deviceId);
    if (!pubBytes) {
        console.error('Ошибка: невалидный device_id (ожидается 0x + 64 hex или base58 32 байта)');
        process.exit(2);
    }
    const publicKeyB64 = a.publicKeyB64 || pubBytes.toString('base64');

    // PoP-сообщение (точно как policy.js validateRegister):
    //   подпись над UTF-8 строкой `${device_id}|${public_key}`.
    const popMessage = `${a.deviceId}|${publicKeyB64}`;
    const popHex = Buffer.from(popMessage, 'utf8').toString('hex');

    if (a.prepare) {
        console.log('── PoP-регистрация: подготовка (команда SIGN) ──────────────');
        console.log(`  device_id  : ${a.deviceId}`);
        console.log(`  public_key : ${publicKeyB64}`);
        console.log(`  PoP message: ${popMessage}`);
        console.log('');
        console.log('В мониторе ESP32 (pio device monitor) выполните:');
        console.log(`  SIGN ${popHex}`);
        console.log('');
        console.log('Затем скопируйте подпись из строки `[SIGN] sig_base64   = <...>`');
        console.log('и передайте её в --send --signature <sig_base64>.');
        return;
    }

    if (a.send) {
        if (!a.signature) {
            console.error('Ошибка: для --send укажите --signature <base64> (подпись от ESP32)');
            process.exit(2);
        }
        const body = { device_id: a.deviceId, public_key: publicKeyB64, signature: a.signature };
        const url = `${a.url}/api/v1/device/register`;
        console.log(`POST ${url}`);
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const text = await resp.text();
            let parsed = null;
            try { parsed = JSON.parse(text); } catch (_) { /* not json */ }
            if (a.json || resp.status >= 400) {
                console.log(JSON.stringify({ status: resp.status, body: parsed || text }, null, 2));
            } else {
                console.log(`✅ Регистрация успешна (HTTP ${resp.status}): ${parsed?.message || text}`);
                console.log('   Теперь ESP32 может отправлять proof\'ы — оракул вернёт 200 OK.');
            }
            process.exit(resp.ok ? 0 : 1);
        } catch (e) {
            console.error(`❌ Не удалось отправить регистрацию: ${e.message}`);
            process.exit(1);
        }
    }

    console.error('Укажите --prepare или --send (--help)');
    process.exit(2);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

