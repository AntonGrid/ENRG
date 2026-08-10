import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { createHash } from "crypto";
import type EnrgMvp from "../target/types/enrg_mvp";

const singleSha256 = (data: Buffer): Buffer =>
  createHash("sha256").update(data).digest();

const leafHasher = (bytes: Uint8Array): Buffer =>
  singleSha256(Buffer.from(bytes));

const computeMerkleRootLeaves = (leavesHex: string[]): string => {
  if (leavesHex.length === 0) throw new Error("no leaves");
  let level = leavesHex.map((h) => Buffer.from(h, "hex"));
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      next.push(singleSha256(Buffer.concat([left, right])));
    }
    level = next;
  }
  return level[0].toString("hex");
};

describe("devnet-manifest-registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.EnrgMvp as Program<EnrgMvp>;

  const getRegistryPda = (): PublicKey => {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("manifest-registry")],
      program.programId
    );
    return pda;
  };

  it("initializes registry with seeds [b\"manifest-registry\"]", async () => {
    const registry = getRegistryPda();

    const tx = await program.methods
      .initializeManifestRegistry()
      .accounts({
        registry,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    assert.ok(tx);
    const account = await program.account.manifestRegistry.fetch(registry);
    assert.strictEqual(account.manifestCount.toString(), "0");
  });

  it("updates merkle_root via update_merkle_root", async () => {
    const registry = getRegistryPda();

    const leaves = ["manifest:1", "manifest:2", "manifest:3", "manifest:4"].map(
      (s) => leafHasher(Buffer.from(s)).toString("hex")
    );
    const newRoot = Buffer.from(computeMerkleRootLeaves(leaves), "hex");

    console.log("newRoot:", newRoot.toString("hex"));

    // update_merkle_root требует signer'ов: oracle (уполномоченный) и authority.
    // В тестовой среде используем wallet как signer для role.
    const tx = await program.methods
      .updateMerkleRoot(Array.from(newRoot), new anchor.BN(leaves.length))
      .accounts({
        registry,
        oracle: provider.wallet.publicKey,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    assert.ok(tx);
    const account = await program.account.manifestRegistry.fetch(registry);
    assert.strictEqual(
      Buffer.from(account.merkleRoot).toString("hex"),
      newRoot.toString("hex")
    );
  });
});
