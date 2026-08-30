/**
 * AI → on-chain ERS collector (ADR-0010 Layer 3, audit P1-4, 2026-08-30).
 *
 * Closes the reputation loop:
 *   ENRG-AI signed signals (assessments.json, gh-pages)
 *     → Ed25519 signature verification (AXIS_AI_SIGNING_PUBKEY)
 *     → anomaly severity (mirrors agent/fed/ers_loop.py)
 *     → on-chain `report_anomaly` (oracle key, rate-limited per device)
 *
 * The oracle key (ORACLE_KEY_PATH) MUST be a member of the on-chain
 * OracleRegistry — otherwise report_anomaly reverts UntrustedOracle.
 *
 * Env:
 *   RPC_ENDPOINT            default https://api.devnet.solana.com
 *   ORACLE_KEY_PATH         oracle signer (default ~/.config/solana/oracle-keypair.json)
 *   AI_ASSESSMENTS_URL      default https://antongrid.github.io/ENRG-AI/ai/assessments.json
 *   AXIS_AI_SIGNING_PUBKEY  base64 Ed25519 pubkey of the AI oracle (REQUIRED)
 *   DEVICES                 comma-separated device pubkeys to assess (default: pilot)
 *   MIN_REPORT_INTERVAL_H   min hours between report_anomaly per device (default 24)
 *   SEVERITY                fixed severity if signals carry no device binding (default 3)
 *   DRY_RUN                 set to 1 to log decisions without sending txs
 *
 * Run: npx ts-node scripts/ai_ers_collector.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as nacl from 'tweetnacl';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { patchIdl } from '../tests/helpers/patch-idl';
import rawIdl from '../target/idl/enrg_mvp.json';

const RPC = process.env.RPC_ENDPOINT || 'https://api.devnet.solana.com';
const ORACLE_KEY_PATH =
  process.env.ORACLE_KEY_PATH || path.join(os.homedir(), '.config/solana/oracle-keypair.json');
const AI_URL =
  process.env.AI_ASSESSMENTS_URL || 'https://antongrid.github.io/ENRG-AI/ai/assessments.json';
const AI_PUBKEY_B64 = process.env.AXIS_AI_SIGNING_PUBKEY || '';
const DEVICES = (process.env.DEVICES || 'Ej2oCfDkNFeFY7hcKHFRxtyHkmYUukbcWZXCqxKvih9b')
  .split(',').map((s) => s.trim()).filter(Boolean);
const MIN_INTERVAL_H = Number(process.env.MIN_REPORT_INTERVAL_H || 24);
const SEVERITY = Number(process.env.SEVERITY || 3);
const DRY_RUN = process.env.DRY_RUN === '1';

const PROGRAM_ID = new PublicKey('HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb');

function canonical(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(canonical);
  if (obj !== null && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj as Record<string, unknown>).sort()) {
      out[k] = canonical((obj as Record<string, unknown>)[k]);
    }
    return out;
  }
  return obj;
}

function canonicalBytes(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(canonical(obj)));
}

function b64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

/** Verify the signed AI bundle (mirrors ENRG-AI verify_bundle_signature). */
function verifyBundle(payload: any): boolean {
  if (!AI_PUBKEY_B64) throw new Error('AXIS_AI_SIGNING_PUBKEY is required');
  const msg = payload?.message;
  const sig = payload?.signature;
  if (!msg || typeof sig !== 'string') return false;
  const pub = b64(AI_PUBKEY_B64);
  if (pub.length !== 32) return false;
  return nacl.sign.detached.verify(canonicalBytes(msg), b64(sig), pub);
}

/** Severity mirror of agent/fed/ers_loop.py::anomaly_severity. */
function severityOf(signals: any[]): number {
  const anomalies = (signals || []).filter((s) => s?.kind === 'generation_anomaly');
  if (anomalies.length === 0) return 0;
  let strength = 0;
  for (const a of anomalies) {
    const threshold = Number(a?.meta?.threshold_wh || 0);
    const residual = Math.abs(Number(a?.meta?.residual_wh || 0));
    if (threshold > 0) strength = Math.max(strength, Math.min(2, residual / threshold));
  }
  return Math.max(1, Math.min(10, 1 + Math.round(strength) + Math.max(0, anomalies.length - 1)));
}

async function main() {
  const res = await fetch(AI_URL);
  if (!res.ok) throw new Error(`AI assessments HTTP ${res.status}`);
  const payload = await res.json();

  if (!verifyBundle(payload)) {
    console.error('[collector] AI bundle signature INVALID — refusing to act on unverified signals');
    process.exit(1);
  }
  console.log('[collector] AI bundle signature OK');

  const signals = payload.message?.signals || [];
  const severity = severityOf(signals);
  const anomalyCount = signals.filter((s: any) => s?.kind === 'generation_anomaly').length;
  console.log(`[collector] anomaly signals=${anomalyCount}, severity=${severity}`);
  if (severity === 0) {
    console.log('[collector] no anomalies — nothing to report');
    return;
  }

  if (DRY_RUN) {
    console.log(`[collector][dry-run] would call report_anomaly(severity=${severity}) for ${DEVICES.join(', ')}`);
    return;
  }

  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(ORACLE_KEY_PATH, 'utf8'))));
  const connection = new Connection(RPC, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  const program: any = new anchor.Program(patchIdl(rawIdl), provider);

  const now = Date.now() / 1000;
  const [reputationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('reputation'), keypair.publicKey.toBuffer()], PROGRAM_ID,
  );
  const [oracleRegistryPda] = PublicKey.findProgramAddressSync([Buffer.from('oracle-registry')], PROGRAM_ID);

  for (const device of DEVICES) {
    try {
      const producerPda = PublicKey.findProgramAddressSync(
        [Buffer.from('producer'), new PublicKey(device).toBuffer()], PROGRAM_ID,
      )[0];
      await program.account.energyProducer.fetch(producerPda);
    } catch {
      console.warn(`[collector] device ${device} is not an on-chain producer — skipping`);
      continue;
    }

    // Rate limit: ERS state lives on-chain (reputation.updated_at), so
    // consecutive runs respect the same cadence.
    if (await connection.getAccountInfo(reputationPda)) {
      const rep: any = await program.account.reputation.fetch(reputationPda);
      const last = Number(rep.updatedAt);
      if (now - last < MIN_INTERVAL_H * 3600) {
        console.log(`[collector] ${device}: ERS updated ${((now - last) / 3600).toFixed(1)}h ago — rate limit, skip`);
        continue;
      }
    }

    const tx = await program.methods
      .reportAnomaly(SEVERITY)
      .accounts({
        reputation: reputationPda,
        oracleRegistry: oracleRegistryPda,
        oracle: keypair.publicKey,
      })
      .rpc();
    console.log(`[collector] report_anomaly(severity=${SEVERITY}) for ${device} -> ${tx}`);
  }
}

main().catch((e) => {
  console.error('[collector] fatal:', e?.message || e);
  process.exit(1);
});

