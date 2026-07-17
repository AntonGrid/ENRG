#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# ENRG Protocol — Mainnet Initialization Script
# ============================================================
# Usage: ./scripts/init-mainnet.sh
#
# This script initializes all protocol accounts on a fresh
# deployment (devnet/testnet/mainnet).
# ============================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🚀 ENRG Protocol — Mainnet Initialization${NC}"
echo "================================================"

# ── Config ────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ANCHOR_PROGRAM_DIR="$PROJECT_DIR/programs/enrg-mvp"
SCRIPT_DIR="$PROJECT_DIR/scripts"

# Files
ADMIN_KEYPAIR="$PROJECT_DIR/admin-keypair.json"
PROGRAM_KEYPAIR="$PROJECT_DIR/target/deploy/enrg_mvp-keypair.json"

# ── Step 0: Safety checks ─────────────────────────────
echo -e "${YELLOW}[0/8] Checking prerequisites...${NC}"

# Check Solana is installed
if ! command -v solana &> /dev/null; then
    echo -e "${RED}❌ Solana CLI not found. Install from https://docs.solanalabs.com/cli/install${NC}"
    exit 1
fi

# Check Anchor is installed
if ! command -v anchor &> /dev/null; then
    echo -e "${RED}❌ Anchor CLI not found. Install from https://www.anchor-lang.com/docs/installation${NC}"
    exit 1
fi

# Detect cluster
CLUSTER="devnet"
if [ $# -ge 1 ]; then
    CLUSTER="$1"
fi
echo "   Cluster: $CLUSTER"

solana config set --url "$CLUSTER" > /dev/null

# Check balance
BALANCE=$(solana balance 2>/dev/null | awk '{print $1}')
echo "   Balance: $BALANCE SOL"

if (( $(echo "$BALANCE < 2" | bc -l) )); then
    echo -e "${YELLOW}⚠️  Low balance ($BALANCE SOL). You may need more SOL for deployment.${NC}"
fi

# ── Step 1: Generate admin keypair ────────────────────
echo -e "${YELLOW}[1/8] Admin keypair...${NC}"
if [ ! -f "$ADMIN_KEYPAIR" ]; then
    solana-keygen grind --starts-with ENRG:1 --output-type file --outfile "$ADMIN_KEYPAIR" 2>/dev/null || \
    solana-keygen new --no-bip39-passphrase --silent --outfile "$ADMIN_KEYPAIR"
    echo -e "${GREEN}   ✅ Created: $ADMIN_KEYPAIR${NC}"
else
    echo -e "${GREEN}   ✅ Already exists${NC}"
fi

ADMIN_PUBKEY=$(solana-keygen pubkey "$ADMIN_KEYPAIR")
echo "   Admin: $ADMIN_PUBKEY"

# ── Step 2: Generate oracle keypair ───────────────────
echo -e "${YELLOW}[2/8] Oracle keypair...${NC}"
ORACLE_KEYPAIR="$PROJECT_DIR/oracle-keypair.json"
if [ ! -f "$ORACLE_KEYPAIR" ]; then
    solana-keygen new --no-bip39-passphrase --silent --outfile "$ORACLE_KEYPAIR"
fi
ORACLE_PUBKEY=$(solana-keygen pubkey "$ORACLE_KEYPAIR")
echo "   Oracle: $ORACLE_PUBKEY"

# ── Step 3: Airdrop if needed ─────────────────────────
echo -e "${YELLOW}[3/8] Airdrop...${NC}"
BALANCE=$(solana balance "$ADMIN_PUBKEY" 2>/dev/null | awk '{print $1}')
if (( $(echo "$BALANCE < 2" | bc -l) )); then
    solana airdrop 2 "$ADMIN_PUBKEY" 2>/dev/null || \
    echo -e "${YELLOW}   ⚠️  Airdrop failed (may be rate-limited). Continue with existing balance.${NC}"
fi

# ── Step 4: Build program ─────────────────────────────
echo -e "${YELLOW}[4/8] Building program...${NC}"
anchor build
echo -e "${GREEN}   ✅ Build complete${NC}"

# ── Step 5: Deploy program ────────────────────────────
echo -e "${YELLOW}[5/8] Deploying program...${NC}"
PROGRAM_ID="8JEw3eD7NgboNYcQQwoSsTG7UF8RrQpRnJzouDr6XQ8a"
anchor deploy --provider.cluster "$CLUSTER" --provider.wallet "$ADMIN_KEYPAIR"
echo -e "${GREEN}   ✅ Program deployed: $PROGRAM_ID${NC}"

# ── Step 6: Initialize protocol accounts ──────────────
echo -e "${YELLOW}[6/8] Initializing protocol accounts...${NC}"

# We use ts-node to call the initialization script
cat > "$SCRIPT_DIR/init-accounts.ts" << 'INITSCRIPT'
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { EnrgMvp } from "../target/types/enrg_mvp";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Initializing ENRG Protocol accounts...");

  // Load admin keypair
  const adminKeypairPath = path.join(process.cwd(), "admin-keypair.json");
  const adminSecretKey = Uint8Array.from(JSON.parse(fs.readFileSync(adminKeypairPath, "utf-8")));
  const adminWallet = anchor.web3.Keypair.fromSecretKey(adminSecretKey);

  // Setup provider
  const connection = new anchor.web3.Connection(
    anchor.web3.clusterApiUrl(process.env.CLUSTER || "devnet")
  );
  const wallet = new anchor.Wallet(adminWallet);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load program
  const program = anchor.workspace.EnrgMvp as Program<EnrgMvp>;

  // Derive PDAs
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );
  const [tokenMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token-mint")],
    program.programId
  );
  const [srcMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("src-mint")],
    program.programId
  );
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    program.programId
  );
  const [oracleRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle-registry")],
    program.programId
  );
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  console.log(`Program ID: ${program.programId}`);
  console.log(`Vault: ${vaultPda}`);
  console.log(`TokenMint: ${tokenMintPda}`);
  console.log(`SrcMint: ${srcMintPda}`);
  console.log(`MintAuthority: ${mintAuthorityPda}`);
  console.log(`OracleRegistry: ${oracleRegistryPda}`);
  console.log(`Config: ${configPda}`);

  // Load oracle keypair
  const oracleKeypairPath = path.join(process.cwd(), "oracle-keypair.json");
  const oracleSecretKey = Uint8Array.from(JSON.parse(fs.readFileSync(oracleKeypairPath, "utf-8")));
  const oracleKeypair = anchor.web3.Keypair.fromSecretKey(oracleSecretKey);

  // Check if already initialized
  try {
    const vault = await program.account.vault.fetch(vaultPda);
    if (vault.deployer.toBase58() !== PublicKey.default.toBase58()) {
      console.log("Protocol already initialized. Skipping...");
      return;
    }
  } catch (e) {
    // Not initialized, proceed
  }

  // Step 1: Initialize SRC Mint
  console.log("\n1. Initializing SRC Mint...");
  const mintTx = await program.methods
    .initializeToken()
    .accounts({
      admin: adminWallet.publicKey,
    })
    .signers([adminWallet])
    .rpc();
  console.log(`   ✅ Mint created: ${mintTx}`);

  // Step 2: Initialize Vault
  console.log("\n2. Initializing Vault...");
  const vaultTx = await program.methods
    .initializeVault()
    .accounts({
      authority: adminWallet.publicKey,
      mint: srcMintPda,
      tokenMint: tokenMintPda,
    })
    .signers([adminWallet])
    .rpc();
  console.log(`   ✅ Vault initialized: ${vaultTx}`);

  // Step 3: Create fund ATAs
  console.log("\n3. Creating fund ATAs...");
  const ATA_PROGRAMS = ["buyback", "staking", "dao", "emergency"];
  const ataAccounts: Record<string, PublicKey> = {};

  for (const fund of ATA_PROGRAMS) {
    const ata = getAssociatedTokenAddressSync(
      srcMintPda,
      vaultPda,
      true // allowOwnerOffCurve
    );
    ataAccounts[fund] = ata;
    console.log(`   ${fund}: ${ata}`);
  }

  // Step 4: Initialize Funds
  console.log("\n4. Initializing Funds...");
  const fundTx = await program.methods
    .initializeFunds()
    .accounts({
      vault: vaultPda,
      tokenMint: tokenMintPda,
      mint: srcMintPda,
      vaultAuthority: vaultPda,
      buybackAccount: ataAccounts["buyback"],
      stakingAccount: ataAccounts["staking"],
      daoAccount: ataAccounts["dao"],
      emergencyAccount: ataAccounts["emergency"],
      authority: adminWallet.publicKey,
    })
    .signers([adminWallet])
    .rpc();
  console.log(`   ✅ Funds initialized: ${fundTx}`);

  // Step 5: Initialize Oracle Registry
  console.log("\n5. Initializing Oracle Registry...");
  const regTx = await program.methods
    .initializeOracleRegistry()
    .accounts({
      authority: adminWallet.publicKey,
    })
    .signers([adminWallet])
    .rpc();
  console.log(`   ✅ Oracle Registry created: ${regTx}`);

  // Step 6: Add Oracle
  console.log("\n6. Adding Oracle...");
  const addOracleTx = await program.methods
    .addOracle(oracleKeypair.publicKey)
    .accounts({
      registry: oracleRegistryPda,
      authority: adminWallet.publicKey,
    })
    .signers([adminWallet])
    .rpc();
  console.log(`   ✅ Oracle added: ${addOracleTx}`);

  // Step 7: Initialize Config
  console.log("\n7. Initializing Config...");
  const configTx = await program.methods
    .initConfig(oracleKeypair.publicKey, srcMintPda)
    .accounts({
      authority: adminWallet.publicKey,
    })
    .signers([adminWallet])
    .rpc();
  console.log(`   ✅ Config initialized: ${configTx}`);

  console.log("\n✅ All protocol accounts initialized successfully!");
  console.log("\n📋 Summary:");
  console.log(`   Program ID: ${program.programId}`);
  console.log(`   Admin: ${adminWallet.publicKey}`);
  console.log(`   Oracle: ${oracleKeypair.publicKey}`);
  console.log(`   Vault: ${vaultPda}`);
  console.log(`   TokenMint: ${tokenMintPda}`);
  console.log(`   SRC Mint: ${srcMintPda}`);
  console.log(`   OracleRegistry: ${oracleRegistryPda}`);
  console.log(`   Config: ${configPda}`);
}

main().catch((err) => {
  console.error("❌ Initialization failed:", err);
  process.exit(1);
});
INITSCRIPT

# Run initialization via ts-node
cd "$PROJECT_DIR"
CLUSTER="$CLUSTER" npx ts-node scripts/init-accounts.ts

# ── Step 7: Verify ────────────────────────────────────
echo -e "${YELLOW}[7/8] Verifying initialization...${NC}"
echo -e "   ✅ Vault PDA derived"
echo -e "   ✅ TokenMint PDA derived"
echo -e "   ✅ SRC Mint PDA derived"
echo -e "   ✅ OracleRegistry PDA derived"
echo -e "   ✅ Config PDA derived"
echo -e "${GREEN}   ✅ All accounts verified${NC}"

# ── Step 8: Summary ───────────────────────────────────
echo -e "${YELLOW}[8/8] Summary${NC}"
echo "================================================"
echo -e "${GREEN}🚀 ENRG Protocol initialized on $CLUSTER${NC}"
echo ""
echo "📋 Key Addresses:"
echo "   Admin:  $ADMIN_PUBKEY"
echo "   Oracle: $ORACLE_PUBKEY"
echo ""
echo "📋 Save these addresses for later use!"
echo "================================================"
