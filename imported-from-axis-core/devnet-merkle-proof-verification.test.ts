import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Connection, clusterApiUrl } from "@solana/web3.js";
import * as keccak from "keccak";
import * as assert from "assert";

/**
 * DEVNET MERKLE PROOF VERIFICATION TEST
 * 
 * Tests the complete Merkle proof verification flow on Solana Devnet:
 * 1. Create Merkle tree from sample manifests
 * 2. Register registry and manifests on-chain
 * 3. Generate Merkle proof for a leaf
 * 4. Verify proof on-chain
 * 
 * Run with:
 * ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 * ANCHOR_WALLET=~/.config/solana/id.json \
 * npm run test -- tests/devnet-merkle-proof-verification.test.ts
 */

function sha256(data: Buffer): Buffer {
  return keccak("keccak256").update(data).digest();
}

interface MerkleTree {
  leaves: Buffer[];
  root: Buffer;
}

function buildSimpleMerkleTree(leaves: Buffer[]): MerkleTree {
  if (leaves.length === 0) {
    return { leaves: [], root: Buffer.alloc(32) };
  }

  let currentLevel = leaves.map((leaf) => sha256(leaf));

  while (currentLevel.length > 1) {
    const nextLevel: Buffer[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      const parent = sha256(Buffer.concat([left, right]));
      nextLevel.push(parent);
    }
    currentLevel = nextLevel;
  }

  return {
    leaves,
    root: currentLevel[0],
  };
}

describe("Merkle Proof Verification on Devnet", function () {
  this.timeout(60000);

  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  const program = anchor.workspace.EnrgMvp as Program<any>;
  const wallet = provider.wallet as anchor.Wallet;

  console.log(`📍 Network: ${connection.rpcEndpoint}`);
  console.log(`👤 Wallet: ${wallet.publicKey.toBase58()}`);

  const authorityKeypair = Keypair.generate();
  const oracleKeypair = Keypair.generate();
  const verifierKeypair = Keypair.generate();

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("manifest-registry-devnet-merkle")],
    program.programId
  );

  let tree: MerkleTree;
  let manifestVerificationPda: PublicKey;

  it("should airdrop SOL to test accounts", async function () {
    const accountsToAirdrop = [
      { kp: authorityKeypair, name: "Authority" },
      { kp: oracleKeypair, name: "Oracle" },
      { kp: verifierKeypair, name: "Verifier" },
    ];

    for (const { kp, name } of accountsToAirdrop) {
      const airdrop = await connection.requestAirdrop(kp.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await connection.confirmTransaction(airdrop);
      console.log(`✅ ${name} airdropped: ${kp.publicKey.toBase58()}`);
    }
  });

  it("should initialize registry on devnet", async function () {
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

    const registry = await program.account.manifestRegistry.fetch(registryPda);
    assert.ok(registry);
    console.log(`📊 Registry version: ${registry.version.toNumber()}`);
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
  });

  it("should create Merkle tree and register manifest", async function () {
    // Create sample leaves
    const leaves = [
      Buffer.from("esp32-sensor-001"),
      Buffer.from("esp32-sensor-002"),
      Buffer.from("rpi-gateway-001"),
    ];

    tree = buildSimpleMerkleTree(leaves);
    console.log(`✅ Merkle tree created with ${leaves.length} leaves`);
    console.log(`📊 Root: ${tree.root.toString("hex")}`);

    // Update registry with root
    const root32 = new Uint8Array(tree.root.length);
    for (let i = 0; i < tree.root.length; i++) {
      root32[i] = tree.root[i];
    }

    const tx = await program.methods
      .updateMerkleRoot([...root32], new anchor.BN(leaves.length))
      .accounts({
        registry: registryPda,
        oracle: oracleKeypair.publicKey,
        authority: authorityKeypair.publicKey,
      })
      .signers([oracleKeypair, authorityKeypair])
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    console.log(`✅ Merkle root updated on devnet: ${tx}`);

    // Register manifest verification
    const manifestId = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    [manifestVerificationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("manifest-verification"), manifestId],
      program.programId
    );

    const publisherKey = new Uint8Array(32).fill(1);
    const contentHash = new Uint8Array(32).fill(2);
    const signature = new Uint8Array(64).fill(3);

    const regTx = await program.methods
      .registerManifestVerification(
        [...manifestId],
        [...publisherKey],
        [...contentHash],
        [...signature],
        1
      )
      .accounts({
        verification: manifestVerificationPda,
        publisher: verifierKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([verifierKeypair])
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    console.log(`✅ Manifest verification registered: ${regTx}`);
  });

  it("should verify Merkle proof on devnet", async function () {
    const leafIndex = 0;
    const leaf = tree.leaves[leafIndex];
    const leafHash = sha256(leaf);

    // Generate simple proof (in real scenario, compute full path)
    const proof: Buffer[] = [];
    if (tree.leaves.length > 1) {
      const sibling = tree.leaves[1];
      proof.push(sha256(sibling));
    }

    console.log(`✅ Generated proof with ${proof.length} nodes`);

    const manifestId = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const [proofVerificationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("merkle-proof-verification"), manifestId, registryPda.toBuffer()],
      program.programId
    );

    // Convert proof to array of [u8; 32]
    const proofAs32ByteArrays: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number][] = [];

    for (const p of proof) {
      const arr32 = new Array(32).fill(0) as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
      for (let i = 0; i < Math.min(p.length, 32); i++) {
        arr32[i] = p[i];
      }
      proofAs32ByteArrays.push(arr32);
    }

    const tx = await program.methods
      .verifyMerkleProof(
        [...manifestId],
        proofAs32ByteArrays,
        [...new Uint8Array(leafHash)]
      )
      .accounts({
        registry: registryPda,
        manifestVerification: manifestVerificationPda,
        proofVerification: proofVerificationPda,
        verifier: verifierKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([verifierKeypair])
      .rpc({ skipPreflight: false, commitment: "confirmed" });

    console.log(`✅ Merkle proof verified on devnet: ${tx}`);
    console.log(`📍 Proof verification PDA: ${proofVerificationPda.toBase58()}`);

    const proofVerification = await program.account.merkleProofVerification.fetch(proofVerificationPda);
    assert.ok(proofVerification);
    console.log(`📊 Proof length: ${proofVerification.proofLength}`);
    console.log(`📊 Verified at: ${new Date(proofVerification.verifiedAt.toNumber() * 1000).toISOString()}`);
  });
});
