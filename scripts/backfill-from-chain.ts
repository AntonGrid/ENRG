/**
 * ENRG — backfill таблицы `proofs` из on-chain истории программы enrg-mvp.
 *
 * Зачем: прод-база (Render) после удаления Postgres пуста. SQLite-файл — это
 * производная, а источник истины — цепочка, поэтому историю минтов можно
 * восстановить, читая devnet.
 *
 * Что восстанавливается точно: строки, для которых есть инструкция
 * `mint_energy` — из её аргумента `OracleReport` берутся device_id, nonce,
 * device_timestamp, energy_wh и `oracle` (это и есть `oracle_id`), а `mint_tx` —
 * подпись транзакции. Статус ставится `minted`.
 *
 * Что НЕ восстанавливается: строки `accepted`/`deferred` (приём proof'а
 * происходит вне цепочки — эти данные жили только в удалённой Postgres). Их
 * источник — бэкап. Честное следствие: `total_proofs` после backfill меньше,
 * чем было до переезда, зато `minted_proofs` — точный.
 *
 * Идемпотентность: ключ (device_id, nonce). Для каждого устройства из цепочки
 * читаются уже имеющиеся строки и существующие nonce пропускаются.
 *
 * Запуск:
 *   DRY_RUN=1 npx ts-node scripts/backfill-from-chain.ts     # только план
 *   npx ts-node scripts/backfill-from-chain.ts               # запись в БД
 *   npm run backfill:chain
 *
 * Переменные: RPC_ENDPOINT, MAX_TX (1000), DELAY_MS (25), RECENT_PAGE (1000).
 */
import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { patchIdl } from '../tests/helpers/patch-idl';

const PROGRAM_ID = new PublicKey('HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb');
const RPC =
  process.env.RPC_ENDPOINT || process.env.ANCHOR_PROVIDER_URL || 'https://api.devnet.solana.com';
const DRY_RUN = process.env.DRY_RUN === '1';
// Публичный devnet RPC отдаёт 429 при частых getParsedTransaction, поэтому
// дефолты консервативные: 300 транзакций с паузой 100 мс. Для полного скана
// истории (или прода) берите собственный RPC-эндпоинт и поднимайте MAX_TX.
const MAX_TX = Number(process.env.MAX_TX || 300);
const DELAY_MS = Number(process.env.DELAY_MS || 100);
const RECENT_PAGE = Number(process.env.RECENT_PAGE || 1000);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const storage = require('../storage');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rawIdl = require('./lib/load-idl').loadEnrgIdl();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface MintedProof {
  device_id: string;
  nonce: number;
  ts: number;
  energy_wh: number;
  mint_tx: string;
  oracle_id: string | null;
  report: Record<string, unknown>;
}

/** Достаёт mint_energy-отчёты из транзакций программы. */
async function collectMintReports(
  connection: Connection,
  coder: anchor.BorshInstructionCoder,
): Promise<{ proofs: MintedProof[]; stats: Record<string, number> }> {
  const stats = {
    signatures: 0,
    failed_txs: 0,
    program_ixs: 0,
    mint_energy: 0,
    other_ixs: 0,
    undecodable: 0,
    null_txs: 0,
  };
  const sigs: { signature: string }[] = [];
  let before: string | undefined;
  while (sigs.length < MAX_TX) {
    const page = await connection.getSignaturesForAddress(PROGRAM_ID, {
      limit: Math.min(1000, MAX_TX - sigs.length),
      before,
    });
    if (page.length === 0) break;
    sigs.push(...page);
    before = page[page.length - 1].signature;
  }
  stats.signatures = sigs.length;
  console.log(`[backfill] signatures fetched: ${sigs.length}`);

  const seen = new Set<string>();
  const proofs: MintedProof[] = [];
  for (let i = 0; i < sigs.length; i++) {
    const s = sigs[i];
    if (i % 25 === 0) process.stdout.write(`\r[backfill] txs: ${i}/${sigs.length}`);
    let tx: any = null;
    try {
      tx = await connection.getParsedTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
    } catch {
      tx = null;
    }
    if (!tx) {
      stats.null_txs++;
      await sleep(DELAY_MS);
      continue;
    }
    if (tx.meta?.err) stats.failed_txs++;
    const ixs = (tx.transaction?.message?.instructions || []).filter(
      (ix: any) => ix.programId === PROGRAM_ID.toBase58(),
    );
    stats.program_ixs += ixs.length;
    for (const ix of ixs) {
      let decoded: any = null;
      try {
        decoded = coder.decode(ix.data);
      } catch {
        stats.undecodable++;
      }
      if (!decoded?.name) {
        stats.undecodable++;
        continue;
      }
      if (decoded.name !== 'mint_energy') {
        stats.other_ixs++;
        continue;
      }
      const r = decoded.data?.report;
      if (!r) continue;
      stats.mint_energy++;
      const device_id =
        typeof r.device_id?.toBase58 === 'function' ? r.device_id.toBase58() : String(r.device_id);
      const nonce = Number(r.nonce ?? 0);
      const key = `${device_id}:${nonce}`;
      if (seen.has(key)) continue; // повторный минт того же proof'а
      seen.add(key);
      proofs.push({
        device_id,
        nonce,
        ts: Number(r.device_timestamp ?? 0),
        energy_wh: Number(r.energy_wh ?? 0),
        mint_tx: s.signature,
        oracle_id:
          r.oracle && typeof r.oracle.toBase58 === 'function' ? r.oracle.toBase58() : null,
        report: {
          oracle: r.oracle?.toBase58?.() ?? null,
          device_id,
          nonce,
          device_timestamp: Number(r.device_timestamp ?? 0),
          verified_at: Number(r.verified_at ?? 0),
          energy_wh: Number(r.energy_wh ?? 0),
        },
      });
    }
    await sleep(DELAY_MS);
  }
  process.stdout.write(`\r[backfill] txs: ${sigs.length}/${sigs.length}\n`);
  return { proofs, stats };
}

async function main() {
  console.log(`[backfill] rpc=${RPC} dry_run=${DRY_RUN} max_tx=${MAX_TX}`);
  const connection = new Connection(RPC, 'confirmed');
  const coder = new anchor.BorshInstructionCoder(patchIdl(rawIdl) as any);

  const { proofs, stats } = await collectMintReports(connection, coder);
  console.log('[backfill] scan:', JSON.stringify(stats));
  console.log(`[backfill] mint_energy records (deduped): ${proofs.length}`);

  await storage.init();
  console.log(`[backfill] storage backend: ${storage.backend}`);

  // Идемпотентность: по каждому устройству поднимаем уже записанные nonce.
  const knownNonces = new Map<string, Set<number>>();
  for (const p of proofs) {
    if (!knownNonces.has(p.device_id)) {
      const rows = await storage.loadProofs(p.device_id, RECENT_PAGE);
      knownNonces.set(p.device_id, new Set(rows.map((r: any) => Number(r.nonce))));
    }
  }

  let inserted = 0;
  let skipped = 0;
  const preview: string[] = [];
  for (const p of proofs) {
    const known = knownNonces.get(p.device_id)!;
    if (known.has(p.nonce)) {
      skipped++;
      continue;
    }
    if (preview.length < 5) {
      preview.push(
        `  + ${p.device_id.slice(0, 8)}… nonce=${p.nonce} wh=${p.energy_wh} ts=${p.ts} ` +
          `oracle=${(p.oracle_id || '-').slice(0, 8)}… tx=${p.mint_tx.slice(0, 8)}…`,
      );
    }
    if (!DRY_RUN) {
      await storage.saveProof(
        p.device_id,
        p.ts,
        p.energy_wh,
        p.nonce,
        p.mint_tx,
        'minted',
        JSON.stringify(p.report),
        p.oracle_id,
      );
    }
    known.add(p.nonce);
    inserted++;
  }

  console.log('[backfill] first rows to write:');
  for (const line of preview) console.log(line);
  console.log(
    `[backfill] ${DRY_RUN ? 'would insert' : 'inserted'}: ${inserted}, already present: ${skipped}`,
  );

  const after = await storage.loadStats();
  console.log(
    `[backfill] stats now: total_proofs=${after.total_proofs} ` +
      `minted_proofs=${after.minted_proofs} total_energy_wh=${after.total_energy_wh}`,
  );
  if (DRY_RUN) console.log('[backfill] DRY_RUN=1 — nothing was written');
  process.exit(0);
}

main().catch((e) => {
  console.error('[backfill] fatal:', e?.message || e);
  process.exit(1);
});
