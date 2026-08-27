#!/usr/bin/env node
/**
 * ENRG — initialize the missing on-chain infrastructure for mint_energy:
 *   initialize_token (mint_authority) → fund ATAs → initialize_funds
 *   (buyback/staking/dao/emergency) → initialize_reputation(owner).
 * Idempotent. Uses the founder key as authority.
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import fs from "fs";

const ENDPOINT = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const WALLET_PATH = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/founder-wallet.json`;
const MAIN = new PublicKey("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");
const IDL = JSON.parse(fs.readFileSync("idls/enrg_mvp.json", "utf8"));
IDL.address = MAIN.toBase58();

const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"))));
const connection = new Connection(ENDPOINT, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(operator), { commitment: "confirmed" });
const program = new anchor.Program(IDL, provider);

const find = (seed: Buffer) => PublicKey.findProgramAddressSync([seed], MAIN)[0];
const find2 = (seed: Buffer, mint: PublicKey) => PublicKey.findProgramAddressSync([seed, mint.toBuffer()], MAIN)[0];

const vault = find(Buffer.from("vault"));
const tokenMint = find(Buffer.from("token-mint"));
const srcMint = find(Buffer.from("src-mint"));
const buybackAuth = find(Buffer.from("fund-buyback"));
const fundStaking = find(Buffer.from("fund-staking"));
const fundDao = find(Buffer.from("fund-dao"));
const fundEmergency = find(Buffer.from("fund-emergency"));
const reputation = find2(Buffer.from("reputation"), operator.publicKey);

async function exists(pk: PublicKey): Promise<boolean> {
  return (await connection.getAccountInfo(pk)) !== null;
}
const step = (name: string, ok: boolean, extra = "") => console.log((ok ? "✅ " : "⏭  ") + name + (extra ? " — " + extra : ""));

async function main() {
  // 1. initialize_token → creates token-mint / src-mint / mint-authority.
  //    mint_authority is a PDA *signer* (mut, not init) — it never has data.
  //    If token-mint already exists, the subsystem is already initialized.
  if (await exists(tokenMint)) {
    step("token subsystem exists", true, tokenMint.toBase58());
  } else {
    await program.methods.initializeToken().accounts({ authority: operator.publicKey }).rpc();
    step("initialize_token", true, tokenMint.toBase58());
  }

  // 2. fund ATAs
  const fundAtas = {
    buyback: getAssociatedTokenAddressSync(srcMint, buybackAuth, true),
    staking: getAssociatedTokenAddressSync(srcMint, fundStaking, true),
    dao: getAssociatedTokenAddressSync(srcMint, fundDao, true),
    emergency: getAssociatedTokenAddressSync(srcMint, fundEmergency, true),
  };
  for (const [name, ata] of Object.entries(fundAtas)) {
    if (await exists(ata)) { step(`fund ATA ${name} exists`); continue; }
    const owner = name === "buyback" ? buybackAuth : name === "staking" ? fundStaking : name === "dao" ? fundDao : fundEmergency;
    await provider.sendAndConfirm(
      new Transaction().add(createAssociatedTokenAccountInstruction(operator.publicKey, ata, owner, srcMint)),
      []
    );
    step(`fund ATA ${name}`, true);
  }

  // 3. initialize_funds → writes buyback/staking/dao/emergency ATAs into TokenMint.
  let fundsDone = false;
  try {
    const tm = await (program.account as any).tokenMint.fetch(tokenMint);
    fundsDone = tm.buybackAccount.toBase58() !== PublicKey.default.toBase58();
  } catch (_) { /* not initialized */ }
  if (fundsDone) {
    step("funds already configured");
  } else {
    await program.methods.initializeFunds().accounts({
      vault,
      tokenMint,
      mint: srcMint,
      vaultAuthority: vault,
      buybackAccount: fundAtas.buyback,
      stakingAccount: fundAtas.staking,
      daoAccount: fundAtas.dao,
      emergencyAccount: fundAtas.emergency,
      authority: operator.publicKey,
    }).rpc();
    step("initialize_funds", true);
  }

  // 4. initialize_reputation(owner) — needed by mint_energy (ERS)
  if (await exists(reputation)) {
    step("reputation(owner) exists", true, reputation.toBase58());
  } else {
    await program.methods.initializeReputation().accounts({
      reputation,
      authority: operator.publicKey,
      systemProgram: SystemProgram.programId,
    }).rpc();
    step("initialize_reputation", true, reputation.toBase58());
  }
  console.log("🎉 mint infrastructure ready!");
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
