import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import * as keccak from "keccak";
import * as assert from "assert";

interface MerkleTree {
  leaves: Buffer[];
  levels: Buffer[][];
  root: Buffer;
}

function sha256(data: Buffer): Buffer {
  return keccak("keccak256").update(data).digest();
}

function buildMerkleTree(leaves: Buffer[]): MerkleTree {
  const tree: MerkleTree = {
    leaves,
    levels: [],
    root: Buffer.alloc(32),
  };

  if (leaves.length === 0) {
    tree.root = Buffer.alloc(32);
    return tree;
  }

  let currentLevel = leaves.map((leaf) => sha256(leaf));
  tree.levels.push([...currentLevel]);

  while (currentLevel.length > 1) {
    const nextLevel: Buffer[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      const parent = sha256(Buffer.concat([left, right]));
      nextLevel.push(parent);
    }
    currentLevel = nextLevel;
    tree.levels.push([...currentLevel]);
  }

  tree.root = currentLevel[0];
  return tree;
}

function getMerkleProof(tree: MerkleTree, leafIndex: number): Buffer[] {
  const proof: Buffer[] = [];
  let index = leafIndex;

  for (const level of tree.levels) {
    const sibling = index ^ 1;
    if (sibling < level.length) {
      proof.push(level[sibling]);
    }
    index = Math.floor(index / 2);
  }

  return proof;
}

function verifyMerkleProof(
  leaf: Buffer,
  leafIndex: number,
  proof: Buffer[],
  root: Buffer
): boolean {
  let hash = sha256(leaf);

  for (let i = 0; i < proof.length; i++) {
    const sibling = proof[i];
    const isRight = (leafIndex >> i) & 1;
    if (isRight) {
      hash = sha256(Buffer.concat([sibling, hash]));
    } else {
      hash = sha256(Buffer.concat([hash, sibling]));
    }
  }

  return hash.equals(root);
}

describe("Merkle Proof Verification", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.EnrgMvp as Program<any>;
  const wallet = provider.wallet as anchor.Wallet;

  const [manifestRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("manifest-registry")],
    program.programId
  );

  let registryPda: PublicKey;
  let tree: MerkleTree;

  it("should initialize registry and create Merkle tree", async () => {
    // Initialize manifest registry if not already done
    try {
      await program.account.manifestRegistry.fetch(manifestRegistryPda);
    } catch (e) {
      const tx = await program.methods
        .initializeManifestRegistry()
        .accounts({
          registry: manifestRegistryPda,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("✅ Registry initialized:", tx);
    }

    // Create sample leaves
    const leaves = [
      Buffer.from("manifest-0"),
      Buffer.from("manifest-1"),
      Buffer.from("manifest-2"),
      Buffer.from("manifest-3"),
    ];

    tree = buildMerkleTree(leaves);
    console.log("✅ Merkle tree created");
    console.log(`📊 Root: ${tree.root.toString("hex")}`);
    console.log(`📊 Tree levels: ${tree.levels.length}`);

    // Update registry with Merkle root
    const root32 = new Uint8Array(tree.root.length);
    for (let i = 0; i < tree.root.length; i++) {
      root32[i] = tree.root[i];
    }

    const tx = await program.methods
      .updateMerkleRoot([...root32], new BN(leaves.length))
      .accounts({
        registry: manifestRegistryPda,
        oracle: wallet.publicKey,
        authority: wallet.publicKey,
      })
      .rpc();

    console.log("✅ Registry updated with Merkle root:", tx);

    registryPda = manifestRegistryPda;
  });

  it("should register manifest verification", async () => {
    const manifestId = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const publisherKey = new Uint8Array(32).fill(1);
    const contentHash = new Uint8Array(32).fill(2);
    const signature = new Uint8Array(64).fill(3);

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
      .rpc();

    console.log("✅ Manifest verification registered:", tx);
  });

  it("should verify Merkle proof for leaf 0", async () => {
    const leafIndex = 0;
    const leaf = tree.leaves[leafIndex];
    const proof = getMerkleProof(tree, leafIndex);

    // Verify proof off-chain
    const isValid = verifyMerkleProof(leaf, leafIndex, proof, tree.root);
    assert.ok(isValid, "Merkle proof should be valid off-chain");
    console.log(`✅ Merkle proof valid for leaf ${leafIndex}`);

    const leafHash = sha256(leaf);
    const proofArray: Uint8Array[] = proof.map((p) => new Uint8Array(p));

    const manifestId = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const [verificationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("manifest-verification"), manifestId],
      program.programId
    );

    const [proofVerificationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("merkle-proof-verification"), manifestId, registryPda.toBuffer()],
      program.programId
    );

    // Convert proof to array of [u8; 32]
    const proofAs32ByteArrays: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number][] =
      proof.map((p) => [...new Uint8Array(p)] as any);

    const tx = await program.methods
      .verifyMerkleProof(
        [...manifestId],
        proofAs32ByteArrays,
        [...new Uint8Array(leafHash)]
      )
      .accounts({
        registry: registryPda,
        manifestVerification: verificationPda,
        proofVerification: proofVerificationPda,
        verifier: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Merkle proof verified on-chain: ${tx}`);
    console.log(`📍 Proof verification PDA: ${proofVerificationPda.toBase58()}`);

    const proofVerification = await program.account.merkleProofVerification.fetch(proofVerificationPda);
    assert.ok(proofVerification, "Proof verification should exist");
    assert.strictEqual(proofVerification.proofLength, proof.length);
    console.log(`📊 Proof length: ${proofVerification.proofLength}`);
  });

  it("should reject invalid Merkle proof", async () => {
    const leafIndex = 0;
    const leaf = Buffer.from("wrong-manifest");
    const proof = getMerkleProof(tree, leafIndex);

    const isValid = verifyMerkleProof(leaf, leafIndex, proof, tree.root);
    assert.strictEqual(isValid, false, "Invalid proof should not verify");
    console.log("✅ Invalid proof correctly rejected off-chain");
  });

  it("should verify Merkle proof for multiple leaves", async () => {
    for (let leafIndex = 0; leafIndex < tree.leaves.length; leafIndex++) {
      const leaf = tree.leaves[leafIndex];
      const proof = getMerkleProof(tree, leafIndex);

      const isValid = verifyMerkleProof(leaf, leafIndex, proof, tree.root);
      assert.ok(isValid, `Proof for leaf ${leafIndex} should be valid`);
      console.log(`✅ Merkle proof valid for leaf ${leafIndex}`);
    }
  });
});
