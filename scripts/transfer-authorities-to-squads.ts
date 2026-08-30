/**
 * Transfer all protocol authorities to a Squads multisig (P0-4, audit 2026-08-30).
 *
 * Mirrors the Squads manual procedure from docs/MAINNET-GOVERNANCE.md. Each
 * instruction is sent as a separate transaction, signed by the current
 * authority (the founder bootstrap key) and addressed to the multisig.
 *
 * Env:
 *   RPC_ENDPOINT            default https://api.mainnet-beta.solana.com
 *   AUTHORITY_KEY_PATH      current authority (founder) keypair (REQUIRED)
 *   SQUADS_PUBKEY           SquadsV4 multisig pubkey (REQUIRED)
 *   GOVERNANCE_MEMBERS      comma-separated guardian pubkeys (3..=5)
 *   DRY_RUN                 set to 1 to print the calls without sending
 *
 * Run: npx ts-node scripts/transfer-authorities-to-squads.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { patchIdl } from '../tests/helpers/patch-idl';
import rawIdl from '../target/idl/enrg_mvp.json';

const RPC = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const AUTHORITY_KEY_PATH =
  process.env.AUTHORITY_KEY_PATH || path.join(os.homedir(), '.config/solana/founder-wallet.json');
const SQUADS_PUBKEY = process.env.SQUADS_PUBKEY || '';
const MEMBERS = (process.env.GOVERNANCE_MEMBERS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const DRY_RUN = process.env.DRY_RUN === '1';

const PROGRAM_ID = new PublicKey('HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb');

async function main() {
  if (!SQUADS_PUBKEY) throw new Error('SQUADS_PUBKEY is required');
  const squads = new PublicKey(SQUADS_PUBKEY);
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(AUTHORITY_KEY_PATH, 'utf8'))));

  const connection = new Connection(RPC, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  const program: any = new anchor.Program(patchIdl(rawIdl), provider);

  const find = (seed: string) => PublicKey.findProgramAddressSync([Buffer.from(seed)], PROGRAM_ID)[0];

  const steps: Array<[string, () => Promise<string>]> = [
    ['vault.authority → multisig', () =>
      program.methods.setVaultAuthority(squads)
        .accounts({ vault: find('vault'), authority: keypair.publicKey })
        .rpc()],
    ['policy_registry.authority → multisig', () =>
      program.methods.setPolicyAuthority(squads)
        .accounts({ policyRegistry: find('policy-registry'), authority: keypair.publicKey })
        .rpc()],
    ['oracle_registry.authority → multisig', () =>
      program.methods.setOracleAuthority(squads)
        .accounts({ oracleRegistry: find('oracle-registry'), authority: keypair.publicKey })
        .rpc()],
  ];

  if (MEMBERS.length >= 3 && MEMBERS.length <= 5) {
    steps.push(['governance.members → guardians', () =>
      program.methods.updateMembers(MEMBERS.map((m) => new PublicKey(m)))
        .accounts({ governance: find('governance'), authority: keypair.publicKey })
        .rpc()]);
  } else {
    console.warn('[governance] GOVERNANCE_MEMBERS must be 3..=5 — governance member list NOT transferred');
  }

  for (const [label, run] of steps) {
    if (DRY_RUN) {
      console.log(`[dry-run] ${label}`);
      continue;
    }
    try {
      const tx = await run();
      console.log(`✅ ${label} -> ${tx}`);
    } catch (e) {
      console.error(`❌ ${label}: ${e?.message || e}`);
      console.error('   (skip if the authority is already transferred or the PDA is absent)');
    }
  }
}

main().catch((e) => {
  console.error('[fatal]', e?.message || e);
  process.exit(1);
});
