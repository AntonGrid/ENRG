#!/usr/bin/env node
/**
 * ENRG — device-side proof submitter (oracle HTTP API).
 *
 * Keeps the public metrics alive from any machine: it registers a device key
 * with the oracle (proof-of-possession over `${device_id}|${public_key}`) and
 * submits a signed energy proof.
 *
 * The oracle trusts the ON-CHAIN Device Registry (`server.js`, P0-2), so the
 * device must already be an ACTIVE `EnergyProducer`. One can be created with a
 * persisted key via:
 *   DEVICE_KEY_PATH=<keypair.json> RPC_ENDPOINT=https://api.devnet.solana.com \
 *     npx ts-node scripts/devnet_mint_third_party.ts
 * (`scripts/devnet_e2e_lifecycle.ts` generates its device key in memory and
 * cannot be reused for this purpose.)
 *
 * Usage:
 *   DEVICE_KEY_PATH=/secure/pilot/device-1.json \
 *     node scripts/submit-proof-to-oracle.js
 *
 * Env:
 *   DEVICE_KEY_PATH  Solana-style keypair JSON (64-byte array). Required.
 *   ORACLE_URL       default https://enrg-oracle.onrender.com
 *   ENERGY_WH        default 1000; the Policy Engine caps it at
 *                    `maxEnergyPerReportWh` (policy-config.json)
 *   NONCE            default = current epoch seconds (strictly increasing, the
 *                    Policy Engine rejects a nonce <= the last accepted one)
 *   SKIP_REGISTER=1  skip the registration call (device already registered)
 *
 * Signed message (must match `buildDeviceMessage` in policy.js and
 * OracleReport::device_message_to_sign on-chain):
 *   device_id(32) || nonce(8 LE) || timestamp(8 LE) || energy_wh(8 LE)
 */
const fs = require('fs');
const nacl = require('tweetnacl');
const { PublicKey } = require('@solana/web3.js');

const ORACLE_URL = (process.env.ORACLE_URL || 'https://enrg-oracle.onrender.com').replace(/\/+$/, '');
const KEY_PATH = process.env.DEVICE_KEY_PATH || '';
const ENERGY_WH = Number(process.env.ENERGY_WH || 1000);
const NONCE = Number(process.env.NONCE || Math.floor(Date.now() / 1000));

/** 8-byte little-endian integer, as in OracleReport. */
function le8(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(Math.round(n)));
  return b;
}

async function main() {
  if (!KEY_PATH) {
    console.error('✗ DEVICE_KEY_PATH is required (path to a Solana-style keypair JSON)');
    process.exit(1);
  }
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(KEY_PATH, 'utf8')));
  const kp = nacl.sign.keyPair.fromSecretKey(secret);
  const deviceId = new PublicKey(kp.publicKey).toBase58();
  const publicKeyB64 = Buffer.from(kp.publicKey).toString('base64');

  console.log(`oracle    ${ORACLE_URL}`);
  console.log(`device_id ${deviceId}`);

  if (process.env.SKIP_REGISTER !== '1') {
    const popSignature = Buffer.from(
      nacl.sign.detached(Buffer.from(`${deviceId}|${publicKeyB64}`), kp.secretKey)
    ).toString('base64');
    const reg = await fetch(`${ORACLE_URL}/api/v1/device/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, public_key: publicKeyB64, signature: popSignature }),
    });
    const regBody = await reg.text();
    console.log(`register  HTTP ${reg.status} ${regBody}`);
    if (!reg.ok) process.exit(1);
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const message = Buffer.concat([
    Buffer.from(kp.publicKey),
    le8(NONCE),
    le8(timestamp),
    le8(ENERGY_WH),
  ]);
  const signature = Buffer.from(nacl.sign.detached(message, kp.secretKey)).toString('base64');

  const res = await fetch(`${ORACLE_URL}/api/v1/proof/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: deviceId,
      timestamp,
      energyWh: ENERGY_WH,
      nonce: NONCE,
      signature,
    }),
  });
  const body = await res.text();
  console.log(`proof     HTTP ${res.status} ${body}`);
  if (!res.ok) {
    console.error('hint: NONCE must be strictly greater than the last accepted one — retry with NONCE=<higher>');
    process.exit(1);
  }

  const stats = await (await fetch(`${ORACLE_URL}/api/v1/stats`)).text();
  console.log(`stats     ${stats}`);
}

main().catch((e) => {
  console.error('✗ failed:', e && e.message ? e.message : e);
  process.exit(1);
});
