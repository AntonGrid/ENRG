#!/usr/bin/env node
/**
 * ENRG — register a device with the oracle (PoP signature via the Serial SIGN command).
 *
 * Flow (ADR-0001: the private key stays on the device; only the signature leaves it):
 *   1. `node register-device.js --prepare --device-id 0x...`
 *        → prints public_key (base64) and the hex PoP message `${device_id}|${public_key}`.
 *   2. In the ESP32 monitor (`pio device monitor`) run:
 *        SIGN <hex from step 1>
 *        → copy the line `[SIGN] sig_base64   = <...>`.
 *   3. `node register-device.js --send --device-id 0x... --signature <sig_base64> [--url ...]`
 *        → POST /api/v1/device/register; afterwards the ESP32 gets 200 OK on proofs.
 *
 * Options:
 *   --device-id  <0x-hex|base58>  device_id of the device (from INFO / logs / manifest)
 *   --prepare                     print hex messages for the SIGN command (offline)
 *   --send                        send POST /api/v1/device/register
 *   --signature <base64>          signature from the ESP32 (the [SIGN] sig_base64 line)
 *   --public-key <base64>         (opt.) do not derive from device_id
 *   --url <http://host:3000>      oracle address (default http://192.168.1.123:3000)
 *   --json                        print responses as JSON
 *   --help                        this help
 */
'use strict';

const path = require('path');

// device_id → 32 bytes (hex 0x… or base58).
function deviceIdToBytes(deviceId) {
    if (typeof deviceId !== 'string' || !deviceId) return null;
    if (/^0x[0-9a-fA-F]{64}$/.test(deviceId)) {
        return Buffer.from(deviceId.slice(2), 'hex');
    }
    try {
        // base58 (bs58 is available in the ENRG node_modules — used by policy.js).
        const bs58 = require(path.join(__dirname, '..', 'node_modules', 'bs58')).default;
        const b = bs58.decode(deviceId);
        if (b.length === 32) return Buffer.from(b);
    } catch (_) { /* not base58 */ }
    return null;
}

function usage() {
    console.log(`Usage: node register-device.js <--prepare|--send> --device-id <0x-hex|base58> [options]

  --prepare        print hex PoP messages for the SIGN command (offline)
  --send           send POST /api/v1/device/register

  --device-id      device_id of the device (e.g. 0xcbec5afc...)
  --signature      (for --send) the ESP32 signature — the [SIGN] sig_base64 line
  --public-key     (opt.) base64 public key; otherwise derived from device_id
  --url            oracle address (default: http://192.168.1.123:3000)
  --json           print JSON responses
  --help           this help`);
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
        else { console.error(`Unknown option: ${k} (--help)`); process.exit(2); }
    }
    return a;
}

async function main() {
    const a = parseArgs(process.argv.slice(2));

    if (!a.deviceId) {
        console.error('Error: specify --device-id (--help)');
        process.exit(2);
    }
    const pubBytes = deviceIdToBytes(a.deviceId);
    if (!pubBytes) {
        console.error('Error: invalid device_id (expected 0x + 64 hex or base58 32 bytes)');
        process.exit(2);
    }
    const publicKeyB64 = a.publicKeyB64 || pubBytes.toString('base64');

    // PoP message (exactly as policy.js validateRegister):
    //   signature over the UTF-8 string `${device_id}|${public_key}`.
    const popMessage = `${a.deviceId}|${publicKeyB64}`;
    const popHex = Buffer.from(popMessage, 'utf8').toString('hex');

    if (a.prepare) {
        console.log('── PoP registration: preparation (SIGN command) ──────────────');
        console.log(`  device_id  : ${a.deviceId}`);
        console.log(`  public_key : ${publicKeyB64}`);
        console.log(`  PoP message: ${popMessage}`);
        console.log('');
        console.log('In the ESP32 monitor (pio device monitor) run:');
        console.log(`  SIGN ${popHex}`);
        console.log('');
        console.log('Then copy the signature from the line `[SIGN] sig_base64   = <...>`');
        console.log('and pass it to --send --signature <sig_base64>.');
        return;
    }

    if (a.send) {
        if (!a.signature) {
            console.error('Error: for --send provide --signature <base64> (the ESP32 signature)');
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
                console.log(`✅ Registration successful (HTTP ${resp.status}): ${parsed?.message || text}`);
                console.log('   Now the ESP32 can send proofs — the oracle will return 200 OK.');
            }
            process.exit(resp.ok ? 0 : 1);
        } catch (e) {
            console.error(`❌ Failed to send the registration: ${e.message}`);
            process.exit(1);
        }
    }

    console.error('Specify --prepare or --send (--help)');
    process.exit(2);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

