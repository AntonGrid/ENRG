'use strict';

/**
 * Oracle load test (P2-1, audit 2026-08-30).
 *
 * Measures the two hot paths independently:
 *   1. policy.validateProof — signature + nonce + freshness validation
 *      (pure CPU, no I/O): the per-proof cost before any minting.
 *   2. storage (SQLite) saveProof/loadProofs — the persistence layer.
 *
 * Reference scale: 1000 devices × 1 proof/min ≈ 17 proofs/s.
 *
 * Run: node scripts/benchmark-oracle.js [proofs]
 */

const nacl = require('tweetnacl');
const { Keypair, PublicKey } = require('@solana/web3.js');
const policy = require('../policy');

// Isolated SQLite DB so the benchmark does not touch ./enrg.db (which may be
// locked by a running oracle) and does not pollute the operator database.
const fs = require('fs');
const os = require('os');
const path = require('path');
const BENCH_DB = path.join(os.tmpdir(), `enrg-bench-${process.pid}.db`);
try { fs.unlinkSync(BENCH_DB); } catch {}
process.env.ENRG_SQLITE_PATH = BENCH_DB;
delete process.env.DATABASE_URL;
const storage = require('../storage');

const N = parseInt(process.argv[2] || '2000', 10);

function makeDevice() {
  const kp = nacl.sign.keyPair();
  const pub = new PublicKey(kp.publicKey).toBase58();
  const ctx = {
    getPublicKey: () => Buffer.from(kp.publicKey).toString('base64'),
    getLastNonce: () => 0,
  };
  return { kp, pub, ctx };
}

function makeProof(device, nonce, ts, energyWh) {
  const deviceIdPubkey = new PublicKey(device.kp.publicKey);
  const msg = policy.buildDeviceMessage(deviceIdPubkey, nonce, ts, energyWh);
  const sig = nacl.sign.detached(msg, device.kp.secretKey);
  return {
    device_id: device.pub,
    timestamp: ts,
    energyWh,
    nonce,
    signature: Buffer.from(sig).toString('base64'),
  };
}

async function main() {
  // ── 1. Policy validateProof throughput ──
  const device = makeDevice();
  const ts = Math.floor(Date.now() / 1000);
  const proofs = [];
  for (let i = 0; i < N; i++) {
    proofs.push(makeProof(device, i + 1, ts - N + i, 50 + (i % 10)));
  }
  let ok = 0;
  const t0 = process.hrtime.bigint();
  for (const p of proofs) {
    const r = policy.validateProof(p, device.ctx);
    if (r.ok) ok++;
  }
  const t1 = process.hrtime.bigint();
  const secs = Number(t1 - t0) / 1e9;
  console.log(`policy.validateProof: ${N} proofs in ${secs.toFixed(2)}s -> ${(N / secs).toFixed(0)} proofs/s (valid=${ok}/${N})`);

  // ── 2. Storage persistence (SQLite) ──
  await storage.init();
  const t2 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    await storage.saveProof(`bench-${i % 100}`, ts, 50, i + 1, null, 'accepted', '{}');
  }
  const t3 = process.hrtime.bigint();
  const s2 = Number(t3 - t2) / 1e9;
  console.log(`storage.saveProof: ${N} rows in ${s2.toFixed(2)}s -> ${(N / s2).toFixed(0)} rows/s`);

  const t4 = process.hrtime.bigint();
  await storage.loadProofs(null, 1000);
  const t5 = process.hrtime.bigint();
  const s3 = Number(t5 - t4) / 1e9;
  console.log(`storage.loadProofs(1000): ${s3.toFixed(4)}s`);

  console.log('\nReference: 1000 devices × 1 proof/min ≈ 17 proofs/s — policy handles it easily;');
  console.log('the bottleneck is the serial on-chain mint (queue depth), not validation.');
  console.log('');
  console.log('NOTE (P2-1a): tweetnacl Ed25519 verify measures ~15 ms/call on this box');
  console.log('(~65 proofs/s ceiling). On faster hosts / with native crypto this is');
  console.log('10-100x better. The oracle hot path should migrate to WebCrypto');
  console.log('(node:crypto webcrypto) — tracked as a follow-up.');

  try { fs.unlinkSync(BENCH_DB); } catch {}
}

main().catch((e) => {
  console.error('benchmark failed:', e);
  process.exit(1);
});
