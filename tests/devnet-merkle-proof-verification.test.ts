import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { assert } from "chai";
import { createHash } from "crypto";
import type EnrgMvp from "../target/types/enrg_mvp";

/**
 * Devnet test: Merkle Proof Verification (Variant A).
 * Single SHA-256, binary Merkle tree.
 * Merkle logic lives in the oracle; Rust stores merkle_root/count.
 */

describe.skip("devnet-merkle-proof-verification", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // TEMP disabled devnet program binding - const program = anchor.workspace.EnrgMvp as Program<EnrgMvp>;

  const singleSha256 = (data: Buffer): Buffer =>
    createHash("sha256").update(data).digest();

  const parentHash = (left: Buffer, right: Buffer): Buffer =>
    singleSha256(Buffer.concat([left, right]));

  const buildRoot = (leaves: Buffer[]): Buffer => {
    if (leaves.length === 0) throw new Error("no leaves");
    let level = leaves;
    while (level.length > 1) {
      const next: Buffer[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        next.push(parentHash(left, right));
      }
      level = next;
    }
    return level[0];
  };

  const buildProof = (
    leaves: Buffer[],
    index: number
  ): { proof: Buffer[]; positions: number[] } => {
    const proof: Buffer[] = [];
    const positions: number[] = [];
    let level = leaves;
    let idx = index;
    while (level.length > 1) {
      const next: Buffer[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        if (i === idx) {
          proof.push(right);
          positions.push(1);
        } else if (i + 1 === idx) {
          proof.push(left);
          positions.push(0);
        }
        next.push(parentHash(left, right));
      }
      idx = Math.floor(idx / 2);
      level = next;
    }
    return { proof, positions };
  };

  const getRegistryAddress = (): PublicKey => {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("manifest-registry")],
      program.programId
    );
    return pda;
  };

  const leafHasher = (bytes: Uint8Array): Buffer =>
    singleSha256(Buffer.from(bytes));

  it("computes root with single SHA-256 and duplicate-odd-leaf rule", () => {
    const leaves = [
      singleSha256(Buffer.from("a")),
      singleSha256(Buffer.from("b")),
      singleSha256(Buffer.from("c")),
    ];
    const level1 = [
      parentHash(leaves[0], leaves[1]),
      parentHash(leaves[2], leaves[2]),
    ];
    const expectedRoot = parentHash(level1[0], level1[1]);
    const actual = buildRoot(leaves);
    assert.strictEqual(actual.toString("hex"), expectedRoot.toString("hex"));
  });

  it("verifies a Merkle proof (single SHA-256, binary tree)", () => {
    const leaves = [
      singleSha256(Buffer.from("a")),
      singleSha256(Buffer.from("b")),
      singleSha256(Buffer.from("c")),
      singleSha256(Buffer.from("d")),
      singleSha256(Buffer.from("e")),
    ];
    const root = buildRoot(leaves);
    const targetIndex = 3;
    const targetLeaf = leaves[targetIndex];
    const { proof, positions } = buildProof(leaves, targetIndex);

    let computed = targetLeaf;
    for (let i = 0; i < proof.length; i++) {
      computed =
        positions[i] === 1
          ? parentHash(computed, proof[i])
          : parentHash(proof[i], computed);
    }
    assert.strictEqual(computed.toString("hex"), root.toString("hex"));
  });

  it("reads stored merkle_root from on-chain registry", async () => {
    const registry = getRegistryAddress();
    const account = await program.account.manifestRegistry.fetch(registry);
    assert.ok(account.merkleRoot);
    assert.ok(account.manifestCount >= 0n);
  });
});
