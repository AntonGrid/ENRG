import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, clusterApiUrl, Connection } from "@solana/web3.js";
import * as assert from "assert";

/**
 * DEVNET INTEGRATION TEST
 * 
 * This test runs against Solana Devnet and verifies:
 * 1. Manifest Registry initialization
 * 2. Oracle authority management
 * 3. Merkle root updates by authorized oracle
 * 4. Manifest verification registration
 * 
 * To run:
 * ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 * ANCHOR_WALLET=~/.config/solana/id.json \
 * npm run test -- tests/devnet-manifest-registry.test.ts
 */

describe("Manifest Registry on Devnet", function () {
  this.timeout(60000);

  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  const program = anchor.workspace.EnrgMvp as Program<any>;
  const wallet = provider.wallet as anchor.Wallet;

  console.log(`📍 Network: ${connection.rpcEndpoint}`);
  console.log(`👤 Wallet: ${wallet.publicKey.toBase58()}`);

  const authorityKeypair = Keypair.generate();
  const oracleKeypair = Keypair.generate();
  let registryPda: PublicKey;

  it("should airdrop SOL to test accounts on devnet", async function () {
    const airdropAmount = 2 * anchor.web3.LAMPORTS_PER_SOL;

    console.log("🚀 Requesting airdrop for authority...");
    const authorityAirdrop = await connection.requestAirdrop(authorityKeypair.publicKey, airdropAmount);
    await connection.confirmTransaction(authorityAirdrop);
    console.log(`✅ Authority airdropped: ${authorityKeypair.publicKey.toBase58()}`);

    console.log("🚀 Requesting airdrop for oracle...");
    const oracleAirdrop = await connection.requestAirdrop(oracleKeypair.publicKey, airdropAmount);
    await connection.confirmTransaction(oracleAirdrop);
    console.log(`✅ Oracle airdropped: ${oracleKeypair.publicKey.toBase58()}`);

    const authorityBalance = await connection.getBalance(authorityKeypair.publicKey);
    const oracleBalance = await connection.getBalance(oracleKeypair.publicKey);
    console.log(`💰 Authority balance: ${authorityBalance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    console.log(`💰 Oracle balance: ${oracleBalance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
  });

  it("should initialize Manifest Registry on devnet", async function () {
    [registryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("manifest-registry-devnet")],
      program.programId
    );

    const tx = await program.methods
      .initializeManifestRegistry()
      .accounts({
        registry: registryPda,
        authority: authorityKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authorityKeypair])
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    console.log(`✅ Registry initialized: ${tx}`);
    console.log(`📍 Registry PDA: ${registryPda.toBase58()}`);

    const registry = await program.account.manifestRegistry.fetch(registryPda);
    assert.ok(registry, "Registry should exist");
    assert.strictEqual(registry.version, 1);
    assert.strictEqual(registry.manifestCount, 0);
    console.log(`📊 Registry state:`, {
      version: registry.version.toNumber(),
      manifestCount: registry.manifestCount.toNumber(),
      authority: registry.authority.toBase58(),
      oracleAuthority: registry.oracleAuthority.toBase58(),
    });
  });

  it("should set oracle authority on devnet", async function () {
    const tx = await program.methods
      .setOracleAuthority(oracleKeypair.publicKey)
      .accounts({
        registry: registryPda,
        authority: authorityKeypair.publicKey,
      })
      .signers([authorityKeypair])
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    console.log(`✅ Oracle authority set: ${tx}`);

    const registry = await program.account.manifestRegistry.fetch(registryPda);
    assert.strictEqual(registry.oracleAuthority.toBase58(), oracleKeypair.publicKey.toBase58());
    console.log(`📋 New oracle: ${registry.oracleAuthority.toBase58()}`);
  });

  it("should update Merkle root on devnet", async function () {
    const newRoot = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      newRoot[i] = Math.floor(Math.random() * 256);
    }

    const manifestCount = 42;

    const tx = await program.methods
      .updateMerkleRoot([...newRoot], new anchor.BN(manifestCount))
      .accounts({
        registry: registryPda,
        oracle: oracleKeypair.publicKey,
        authority: authorityKeypair.publicKey,
      })
      .signers([oracleKeypair, authorityKeypair])
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    console.log(`✅ Merkle root updated: ${tx}`);

    const registry = await program.account.manifestRegistry.fetch(registryPda);
    assert.strictEqual(registry.version, 2);
    assert.strictEqual(registry.manifestCount.toNumber(), manifestCount);
    console.log(`📊 Registry updated:`, {
      version: registry.version.toNumber(),
      manifestCount: registry.manifestCount.toNumber(),
      rootHex: Buffer.from(registry.merkleRoot).toString("hex"),
    });
  });

  it("should register manifest verification on devnet", async function () {
    const manifestId = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const publisherKey = new Uint8Array(32);
    const contentHash = new Uint8Array(32);
    const signature = new Uint8Array(64);

    for (let i = 0; i < publisherKey.length; i++) {
      publisherKey[i] = Math.floor(Math.random() * 256);
    }
    for (let i = 0; i < contentHash.length; i++) {
      contentHash[i] = Math.floor(Math.random() * 256);
    }
    for (let i = 0; i < signature.length; i++) {
      signature[i] = Math.floor(Math.random() * 256);
    }

    const [verificationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("manifest-verification"), manifestId],
      program.programId
    );

    const tx = await program.methods
      .registerManifestVerification(
        [...manifestId],
        [...publisherKey],
        [...contentHash],
        [...signature],
        1
      )
      .accounts({
        verification: verificationPda,
        publisher: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    console.log(`✅ Manifest verification registered: ${tx}`);
    console.log(`📍 Verification PDA: ${verificationPda.toBase58()}`);

    const verification = await program.account.manifestVerification.fetch(verificationPda);
    assert.ok(verification, "Verification should exist");
    assert.strictEqual(verification.manifestVersion, 1);
    console.log(`📋 Verification:`, {
      manifestId: Buffer.from(verification.manifestId).toString("hex"),
      createdAt: verification.createdAt.toNumber(),
      verified: verification.verified,
    });
  });

  it("should handle unauthorized oracle update rejection", async function () {
    const unauthorizedOracle = Keypair.generate();
    const newRoot = new Uint8Array(32).fill(99);

    // Request airdrop for unauthorized oracle
    const airdrop = await connection.requestAirdrop(unauthorizedOracle.publicKey, anchor.web3.LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdrop);

    try {
      await program.methods
        .updateMerkleRoot([...newRoot], new anchor.BN(100))
        .accounts({
          registry: registryPda,
          oracle: unauthorizedOracle.publicKey,
          authority: authorityKeypair.publicKey,
        })
        .signers([unauthorizedOracle, authorityKeypair])
        .rpc({ skipPreflight: false, commitment: "confirmed" });

      assert.fail("Should have rejected unauthorized oracle");
    } catch (err: any) {
      console.log(`✅ Correctly rejected unauthorized oracle:`, err.message.substring(0, 100));
      assert.ok(err.message.includes("AnchorError"), "Should be an Anchor error");
    }
  });
});
