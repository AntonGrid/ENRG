import {
  Connection,
  Transaction,
  SystemProgram,
  PublicKey,
  Keypair,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as assert from "assert";

const PROGRAM_ID = new PublicKey("HrQZPeKYtDJCxo9R2wv8XUK43ex1XLcb3CqykYauGn64");
const LAMPORTS = LAMPORTS_PER_SOL;

const u8 = (v: number) => Buffer.from([v]);
const u64LE = (v: number | bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};

const arrU8 =
  (n: number) =>
  (v: number[]): Buffer => {
    if (v.length !== n) throw new Error(`expected ${n} bytes, got ${v.length}`);
    return Buffer.from(v);
  };

const vecArr32 = (items: number[][]): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(items.length);
  return Buffer.concat([len, ...items.map((it) => Buffer.from(it))]);
};

const concat = (...parts: Uint8Array[]) => Buffer.concat(parts);

const IX = {
  initializeManifestRegistry: [223, 175, 101, 191, 157, 253, 239, 208],
  registerManifestVerification: [240, 95, 189, 175, 43, 225, 140, 115],
  updateMerkleRoot: [195, 173, 38, 60, 242, 203, 158, 93],
  verifyMerkleProof: [51, 191, 37, 169, 74, 207, 201, 102],
};

function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}
function merkleHash(l: Buffer, r: Buffer): Buffer {
  return sha256(sha256(Buffer.concat([l, r])));
}
function buildMerkleTree(leaves: Buffer[]) {
  let level = leaves.map((l) => sha256(l));
  const levels: Buffer[][] = [level];
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(merkleHash(level[i], level[i + 1] ?? level[i]));
    }
    levels.push(next);
    level = next;
  }
  return { leaves: levels[0], levels, root: levels[levels.length - 1][0] };
}
function getProof(tree, index: number): Buffer[] {
  const proof: Buffer[] = [];
  let idx = index;
  for (let li = 0; li < tree.levels.length - 1; li++) {
    const level = tree.levels[li];
    const sibling = idx % 2 === 1 ? idx - 1 : idx + 1;
    proof.push(sibling < level.length ? level[sibling] : level[idx]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

const meta = (pk: PublicKey, isWritable: boolean, isSigner: boolean) => ({
  pubkey: pk,
  isWritable,
  isSigner,
});

describe("ENRG Merkle proof — raw (no anchor IDL parser)", () => {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const deployer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, "utf8")))
  );

  it("registry -> manifest -> update root -> verify", async () => {
    // 1. Данные Merkle
    const leaves = [Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 3), Buffer.alloc(32, 4)];
    const tree = buildMerkleTree(leaves);
    const leafIndex = 1;
    const proof = getProof(tree, leafIndex);
    const leafHash = sha256(leaves[leafIndex]);
    const root = tree.root;
    const position = leafIndex; // ← ИСПРАВЛЕНО: было 0

    // Уникальный manifestId на каждый прогон → никогда не натыкаемся на занятый PDA
    const manifestId = Array.from(Buffer.alloc(16));
    for (let i = 0; i < 16; i++) {
      manifestId[i] = Math.floor(Math.random() * 256);
    }

    // 2. PDA для manifest-verification (init) и merkle-proof-verification
    const [verificationPda] = await PublicKey.findProgramAddress(
      [Buffer.from("manifest-verification"), Buffer.from(manifestId)],
      PROGRAM_ID
    );
    console.log("verification PDA:", verificationPda.toBase58());

    // airdrop deployer (для rent/transfer)
    const bal = await connection.getBalance(deployer.publicKey);
    if (bal < LAMPORTS) {
      await connection.requestAirdrop(deployer.publicKey, LAMPORTS);
    }

    // 3. initialize_manifest_registry: registry = signer Keypair
    const registry = Keypair.generate();
    await connection.requestAirdrop(registry.publicKey, LAMPORTS);

    const ixInitReg = new TransactionInstruction({
      keys: [
        meta(registry.publicKey, true, true),   // registry
        meta(deployer.publicKey, true, true),   // authority
        meta(SystemProgram.programId, false, false), // system_program
      ],
      programId: PROGRAM_ID,
      data: Buffer.from(IX.initializeManifestRegistry),
    });

    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(ixInitReg),
      [deployer, registry],
      { commitment: "confirmed" }
    );
    console.log("✔ initializeManifestRegistry");

    // 4. register_manifest_verification: создаёт PDA verification
    const contentHash = Array.from(Buffer.alloc(32, 42));
    const signature = Array.from(Buffer.alloc(64, 77));
    const publisherKey = Array.from(deployer.publicKey.toBuffer());

    const dataRegManifest = concat(
      Buffer.from(IX.registerManifestVerification),
      arrU8(16)(manifestId),
      arrU8(32)(publisherKey),
      arrU8(32)(contentHash),
      arrU8(64)(signature),
      u8(1) // manifest_version
    );

    const ixRegManifest = new TransactionInstruction({
      keys: [
        meta(verificationPda, true, false),     // verification
        meta(deployer.publicKey, true, true),   // publisher
        meta(SystemProgram.programId, false, false), // system_program
      ],
      programId: PROGRAM_ID,
      data: dataRegManifest,
    });

    await sendAndConfirmTransaction(connection, new Transaction().add(ixRegManifest), [deployer], {
      commitment: "confirmed",
    });
    console.log("✔ registerManifestVerification");

    // 5. update_merkle_root: new_root, manifest_count
    const dataUpdateRoot = concat(
      Buffer.from(IX.updateMerkleRoot),
      arrU8(32)(Array.from(root)),
      u64LE(1)
    );

    const ixUpdateRoot = new TransactionInstruction({
      keys: [
        meta(registry.publicKey, true, false),  // registry
        meta(deployer.publicKey, false, true),  // oracle
        meta(deployer.publicKey, false, true),  // authority
      ],
      programId: PROGRAM_ID,
      data: dataUpdateRoot,
    });

    await sendAndConfirmTransaction(connection, new Transaction().add(ixUpdateRoot), [deployer], {
      commitment: "confirmed",
    });
    console.log("✔ updateMerkleRoot");

    // 6. verify_merkle_proof
    const [proofPda] = await PublicKey.findProgramAddress(
      [Buffer.from("merkle-proof-verification"), Buffer.from(manifestId), registry.publicKey.toBuffer()],
      PROGRAM_ID
    );

    const dataVerify = concat(
      Buffer.from(IX.verifyMerkleProof),
      arrU8(16)(manifestId),
      vecArr32(proof.map((p) => Array.from(p))),
      arrU8(32)(Array.from(leafHash)),
      u8(position)
    );

    const ixVerify = new TransactionInstruction({
      keys: [
        meta(registry.publicKey, false, false),      // registry
        meta(verificationPda, false, false),         // manifest_verification
        meta(proofPda, true, false),                 // proof_verification
        meta(deployer.publicKey, true, true),        // verifier
        meta(SystemProgram.programId, false, false), // system_program
      ],
      programId: PROGRAM_ID,
      data: dataVerify,
    });

    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(ixVerify),
      [deployer],
      { commitment: "confirmed" }
    );

    console.log("✔ verifyMerkleProof tx:", sig);
    assert.ok(sig.length > 0, "транзакция verify прошла");
  });
});
