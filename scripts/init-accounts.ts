import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  clusterApiUrl,
  Cluster,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { EnrgMvp } from "../target/types/enrg_mvp";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("🚀 Initializing ENRG Protocol accounts...\n");

  // ── Load keypairs ─────────────────────────────────
  const adminKeypairPath = path.join(process.cwd(), "admin-keypair.json");
  const oracleKeypairPath = path.join(process.cwd(), "oracle-keypair.json");

  if (!fs.existsSync(adminKeypairPath)) throw new Error("admin-keypair.json not found");
  if (!fs.existsSync(oracleKeypairPath)) throw new Error("oracle-keypair.json not found");

  const adminSecretKey = Uint8Array.from(JSON.parse(fs.readFileSync(adminKeypairPath, "utf-8")));
  const adminWallet = anchor.web3.Keypair.fromSecretKey(adminSecretKey);

  const oracleSecretKey = Uint8Array.from(JSON.parse(fs.readFileSync(oracleKeypairPath, "utf-8")));
  const oraclePubkey = anchor.web3.Keypair.fromSecretKey(oracleSecretKey).publicKey;

  // ── Setup provider ────────────────────────────────
  const cluster = (process.env.CLUSTER || "devnet") as Cluster;
  const connection = new anchor.web3.Connection(clusterApiUrl(cluster), "confirmed");
  const wallet = new anchor.Wallet(adminWallet);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  // ── Load program ──────────────────────────────────
  const program = anchor.workspace.EnrgMvp as Program<EnrgMvp>;
  console.log(`Program ID: ${program.programId}`);
  console.log(`Admin: ${adminWallet.publicKey}`);
  console.log(`Oracle: ${oraclePubkey}\n`);

  // ── Derive PDAs ───────────────────────────────────
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId);
  const [tokenMintPda] = PublicKey.findProgramAddressSync([Buffer.from("token-mint")], program.programId);
  const [srcMintPda] = PublicKey.findProgramAddressSync([Buffer.from("src-mint")], program.programId);
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("mint-authority")], program.programId);
  const [oracleRegistryPda] = PublicKey.findProgramAddressSync([Buffer.from("oracle-registry")], program.programId);
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const [buybackAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("buyback-authority")], program.programId);

  console.log("PDAs:");
  console.log(`  Vault:          ${vaultPda}`);
  console.log(`  TokenMint:      ${tokenMintPda}`);
  console.log(`  SRC Mint:       ${srcMintPda}`);
  console.log(`  MintAuthority:  ${mintAuthorityPda}`);
  console.log(`  OracleRegistry: ${oracleRegistryPda}`);
  console.log(`  Config:         ${configPda}`);
  console.log(`  BuybackAuth:    ${buybackAuthorityPda}\n`);

  // ── Check if already initialized ──────────────────
  try {
    const vaultAcc = await program.account.vault.fetch(vaultPda);
    if (vaultAcc.deployer.toBase58() !== PublicKey.default.toBase58()) {
      console.log("✅ Protocol already initialized. Skipping.\n");
      return;
    }
  } catch (_) {}

  // ── Step 1: Initialize Token ──────────────────────
  console.log("\n1. Initializing SRC Mint + TokenMint + MintAuthority...");
  // Anchor resolves PDA accounts automatically from seeds in #[derive(Accounts)]
  const tx1 = await program.methods
    .initializeToken()
    .accounts({ authority: adminWallet.publicKey })
    .signers([adminWallet])
    .rpc();
  console.log(`   ✅ ${tx1}`);

  // ── Step 2: Initialize Vault ──────────────────────
  console.log("\n2. Initializing Vault...");
  const tx2 = await program.methods
    .initializeVault()
    .accounts({ authority: adminWallet.publicKey, mint: srcMintPda })
    .signers([adminWallet])
    .rpc();
  console.log(`   ✅ ${tx2}`);

  // ── Step 3: Initialize Oracle Registry ────────────
  console.log("\n3. Initializing Oracle Registry...");
  const tx3 = await program.methods
    .initializeOracleRegistry()
    .accounts({ authority: adminWallet.publicKey })
    .signers([adminWallet])
    .rpc();
  console.log(`   ✅ ${tx3}`);

  // ── Step 4: Add Oracle ────────────────────────────
  console.log("\n4. Adding Oracle...");
  const tx4 = await program.methods
    .addOracle(oraclePubkey)
    .accounts({ authority: adminWallet.publicKey })
    .signers([adminWallet])
    .rpc();
  console.log(`   ✅ ${tx4}`);

  // ── Step 5: Initialize Config ─────────────────────
  console.log("\n5. Initializing Config (oracle + mint binding)...");
  const tx5 = await program.methods
    .initConfig(oraclePubkey, srcMintPda)
    .accounts({ authority: adminWallet.publicKey })
    .signers([adminWallet])
    .rpc();
  console.log(`   ✅ ${tx5}`);

  // ── Done ──────────────────────────────────────────
  console.log("\n✅ All protocol accounts initialized!\n");
  console.log("📋 ====== SUMMARY =====");
  console.log(`Program ID:     ${program.programId}`);
  console.log(`Admin:          ${adminWallet.publicKey}`);
  console.log(`Oracle:         ${oraclePubkey}`);
  console.log(`Vault:          ${vaultPda}`);
  console.log(`TokenMint:      ${tokenMintPda}`);
  console.log(`SRC Mint:       ${srcMintPda}`);
  console.log(`MintAuthority:  ${mintAuthorityPda}`);
  console.log(`OracleRegistry: ${oracleRegistryPda}`);
  console.log(`Config:         ${configPda}`);
  console.log(`BuybackAuth:    ${buybackAuthorityPda}`);
  console.log("========================");
}

main().catch(console.error);
