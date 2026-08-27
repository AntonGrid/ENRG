#!/usr/bin/env node
/**
 * ENRG — register the oracle key on-chain (Oracle Registry, ADR-0003/0006).
 *
 *   1. initializes the "oracle-registry" PDA if it does not exist yet;
 *   2. adds the oracle public key to the registry (authority = founder).
 *
 * Usage: npx ts-node scripts/setup-oracle.ts <oracle_pubkey>
 *   env: ANCHOR_WALLET (founder keypair), ANCHOR_PROVIDER_URL (default devnet)
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import fs from "fs";

const ENDPOINT = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const WALLET_PATH = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/founder-wallet.json`;
const IDL = JSON.parse(fs.readFileSync("idls/enrg_mvp.json", "utf8"));
IDL.address = "HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb";

const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"))));
const connection = new Connection(ENDPOINT, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(operator), { commitment: "confirmed" });
const program = new anchor.Program(IDL, provider);

async function main() {
  const oraclePub = process.argv[2] ? new PublicKey(process.argv[2]) : null;
  if (!oraclePub) {
    console.error("usage: setup-oracle.ts <oracle_pubkey>");
    process.exit(1);
  }

  const [registry] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle-registry")],
    program.programId
  );

  const exists = (await connection.getAccountInfo(registry)) !== null;
  console.log("registry PDA:", registry.toBase58(), exists ? "(exists)" : "(missing)");

  if (!exists) {
    await program.methods
      .initializeOracleRegistry()
      .accounts({ registry, authority: operator.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
    console.log("✅ initialize_oracle_registry");
  }

  // add_oracle requires registry.oracle_admin == signer. If a dev key is the
  // admin, restore it to the founder (allowed: registry.authority == founder).
  const reg = await program.account.oracleRegistry.fetch(registry);
  if (!(reg as any).oracleAdmin.equals(operator.publicKey)) {
    await program.methods
      .setOracleAdmin(operator.publicKey)
      .accounts({ registry, authority: operator.publicKey })
      .rpc();
    console.log("✅ set_oracle_admin -> founder");
  }

  await program.methods
    .addOracle(oraclePub)
    .accounts({ registry, authority: operator.publicKey })
    .rpc();
  console.log("✅ add_oracle:", oraclePub.toBase58());
  console.log("🎉 Oracle registered — mint_energy will be allowed for this key.");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
