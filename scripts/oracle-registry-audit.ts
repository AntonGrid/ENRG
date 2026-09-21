#!/usr/bin/env node
/**
 * ENRG — audit (and clean) the on-chain Oracle Registry.
 *
 * Why this exists (P0, audit 2026-09-21): the registry is filled one key at a
 * time (`scripts/setup-oracle.ts <pubkey>`), so early development runs left keys
 * in it that never staked and never voted. A public `GET /api/v1/oracles` then
 * reported "12 oracles" where only two had ever done anything, which inflates
 * the network on paper. This script prints the real picture and can remove the
 * idle keys.
 *
 * Safety of `--remove-empty`: a vote (`submit_oracle_attestation`) requires the
 * oracle's stake PDA `[b"oracle-stake", oracle]` (see
 * `programs/enrg-mvp/src/instructions/oracle_quorum.rs`), and that account is
 * created only by `stake_oracle`. A key with no stake account therefore cannot
 * have voted — removing it is provably a no-op for the quorum.
 *
 * Usage:
 *   npx ts-node scripts/oracle-registry-audit.ts                 # read-only
 *   npx ts-node scripts/oracle-registry-audit.ts --remove-empty  # clean up
 *
 * `--remove-empty` requires the signer to be `registry.oracle_admin`.
 *
 * env: ANCHOR_WALLET (default ~/.config/solana/founder-wallet.json),
 *      ANCHOR_PROVIDER_URL (default https://api.devnet.solana.com),
 *      ORACLE_API (default https://enrg-oracle.onrender.com)
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";

const ENDPOINT = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const WALLET_PATH =
  process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/founder-wallet.json`;
const ORACLE_API = (process.env.ORACLE_API || "https://enrg-oracle.onrender.com").replace(/\/$/, "");
const REMOVE_EMPTY = process.argv.includes("--remove-empty");

const IDL = JSON.parse(fs.readFileSync("idls/enrg_mvp.json", "utf8"));
IDL.address = "HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb";

const operator = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")))
);
const connection = new Connection(ENDPOINT, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(operator), {
  commitment: "confirmed",
});
const program = new anchor.Program(IDL, provider);

interface RegistryRow {
  key: PublicKey;
  stake: boolean;
  proofs: number;
  minted: number;
}

async function fetchRegistry(): Promise<PublicKey[]> {
  const [registry] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle-registry")],
    program.programId
  );
  const reg: any = await (program.account as any).oracleRegistry.fetch(registry);
  return (reg.oracles || []) as PublicKey[];
}

async function stakeExists(oracle: PublicKey): Promise<boolean> {
  const [stakePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle-stake"), oracle.toBuffer()],
    program.programId
  );
  return (await connection.getAccountInfo(stakePda)) !== null;
}

function shorten(k: PublicKey): string {
  const s = k.toBase58();
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

async function apiAttribution(): Promise<Record<string, { proofs: number; minted: number }>> {
  try {
    const res = await fetch(`${ORACLE_API}/api/v1/oracles`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: any = await res.json();
    const out: Record<string, { proofs: number; minted: number }> = {};
    for (const o of body.oracles || []) {
      out[o.oracle_id] = { proofs: o.total_proofs || 0, minted: o.minted_proofs || 0 };
    }
    if (body.unattributed_proofs && body.unattributed_proofs.proofs > 0) {
      console.log(
        `note: ${body.unattributed_proofs.proofs} proof(s) predate per-oracle attribution ` +
          `(2026-08-30) and are not listed per oracle — see /api/v1/stats for the totals.`
      );
    }
    return out;
  } catch (e: any) {
    console.warn(`⚠️  ${ORACLE_API}/api/v1/oracles unreachable (${e.message}); on-chain data only.`);
    return {};
  }
}

async function main() {
  console.log(`registry audit — ${ENDPOINT}`);
  console.log(
    `wallet:        ${WALLET_PATH.replace(process.env.HOME || "", "~")} (${operator.publicKey.toBase58()})`
  );
  console.log(`oracle api:    ${ORACLE_API}\n`);

  const keys = await fetchRegistry();
  const attribution = await apiAttribution();

  const rows: RegistryRow[] = [];
  for (const key of keys) {
    const id = key.toBase58();
    const a = attribution[id] || { proofs: 0, minted: 0 };
    rows.push({ key, stake: await stakeExists(key), proofs: a.proofs, minted: a.minted });
  }

  console.log("key              stake  proofs  minted  verdict");
  console.log("────────────────────────────────────────────────────────");
  for (const r of rows) {
    const verdict = r.stake || r.proofs > 0 ? "active" : "IDLE (no stake, no proofs)";
    console.log(
      `${shorten(r.key).padEnd(16)} ${(r.stake ? "yes" : "no").padEnd(6)} ` +
        `${String(r.proofs).padEnd(7)} ${String(r.minted).padEnd(7)} ${verdict}`
    );
  }

  const idle = rows.filter((r) => !r.stake && r.proofs === 0);
  console.log(
    `\nregistered: ${rows.length} · staked: ${rows.filter((r) => r.stake).length} · ` +
      `with proofs: ${rows.filter((r) => r.proofs > 0).length} · idle: ${idle.length}`
  );

  if (idle.length === 0) {
    console.log("nothing to clean.");
    return;
  }

  if (!REMOVE_EMPTY) {
    console.log(
      `\n${idle.length} idle key(s) can be removed with:\n` +
        `  npx ts-node scripts/oracle-registry-audit.ts --remove-empty`
    );
    return;
  }

  const [registry] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle-registry")],
    program.programId
  );
  const reg: any = await (program.account as any).oracleRegistry.fetch(registry);
  if (!reg.oracleAdmin.equals(operator.publicKey)) {
    console.error(
      `❌ signer ${operator.publicKey.toBase58()} is not registry.oracle_admin ` +
        `(${reg.oracleAdmin.toBase58()}). Nothing was changed.`
    );
    process.exit(1);
  }

  console.log(`\nremoving ${idle.length} idle key(s)…`);
  for (const r of idle) {
    try {
      const tx = await (program.methods as any)
        .removeOracle(r.key)
        .accounts({ registry, authority: operator.publicKey })
        .rpc();
      console.log(`✅ remove_oracle ${shorten(r.key)} — ${tx}`);
    } catch (e: any) {
      console.error(`❌ remove_oracle ${shorten(r.key)} failed: ${e.message || e}`);
    }
  }
  console.log(`\nafter: ${(await fetchRegistry()).length} oracle(s) registered`);
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
