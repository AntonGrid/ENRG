// ENRG Merkle proof flow — Anchor IDL style (ts-mocha).
import { Connection, PublicKey, Keypair, SystemProgram, Transaction, Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import * as assert from "assert";
import nacl from "tweetnacl";
import { EnrgMvp } from "../target/types/enrg_mvp";
import rawIdl from "../target/idl/enrg_mvp.json";

import { buildMerkleTree, getProof, sha256 } from "./helpers/merkle";
import { registryPda, verificationPda, proofPda } from "./helpers/pda";
import { loadAuthority, ensureFunded, randomManifestId } from "./helpers/accounts";
import { patchIdl } from "./helpers/patch-idl";

const PROGRAM_ID = new PublicKey("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");

const idl = patchIdl(rawIdl);

/**
 * Канонический leaf манифеста — зеркало on-chain
 * `manifest_leaf_hash` (merkle_proof_verification.rs):
 * leaf = SHA-256(manifest_id(16) || content_hash(32)).
 */
function manifestLeaf(manifestId: number[], contentHash: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from(manifestId), contentHash]));
}

/** ed25519-precompile-инструкция (сигнатура над msg ключом kp). */
function ed25519Ix(msg: Buffer, kp: Keypair): TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: kp.publicKey.toBytes(),
    message: msg,
    signature: nacl.sign.detached(msg, kp.secretKey),
  });
}

describe("ENRG Merkle proof — Anchor IDL", () => {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  // H-2: initializeManifestRegistry (первый init PDA) разрешён только
  // EXPECTED_DEPLOYER (адрес основателя) — используем founder-ключ.
  const FOUNDER_KEYPAIR_PATH =
    process.env.FOUNDER_KEYPAIR_PATH ||
    path.join(os.homedir(), ".config/solana/founder-wallet.json");
  const provider = new AnchorProvider(
    connection,
    new anchor.Wallet(loadAuthority(FOUNDER_KEYPAIR_PATH)),
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );

  let program: Program<EnrgMvp>;

  before(() => {
    anchor.setProvider(provider);
    // @coral-xyz/anchor 0.32.1: Program(idl, provider) — programId из idl.address.
    program = new anchor.Program(idl as EnrgMvp, provider);
  });

  it("registry -> manifest -> update root (oracle) -> verify proof", async () => {
    const authority = provider.wallet.publicKey;
    await ensureFunded(connection, authority);

    // ── Дерево из 4 манифестов; leaf = SHA-256(manifest_id || content_hash) ──
    const MANIFESTS = Array.from({ length: 4 }, () => randomManifestId());
    const CONTENT = [Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 3), Buffer.alloc(32, 4)];
    const leaves = MANIFESTS.map((id, i) => manifestLeaf(id, CONTENT[i]));
    const tree = buildMerkleTree(leaves);
    const leafIndex = 1;
    const proof = getProof(tree, leafIndex);
    const manifestId = MANIFESTS[leafIndex];
    const contentHash = CONTENT[leafIndex];
    const root = tree.root;

    const registry = await registryPda(PROGRAM_ID);
    const verification = await verificationPda(PROGRAM_ID, manifestId);
    const proofAccount = await proofPda(PROGRAM_ID, manifestId, registry);

    // updateMerkleRoot требует signer == registry.oracle_authority.
    // initializeManifestRegistry ставит oracle_authority = payer (wallet),
    // поэтому oracle здесь — тот же authority.
    const oracle = authority;

    await program.methods
      .initializeManifestRegistry()
      .accountsStrict({ registry, payer: authority, systemProgram: SystemProgram.programId })
      .signers([provider.wallet.payer])
      .rpc();
    console.log("✔ initializeManifestRegistry");

    // ── P0-1: подпись ИЗДАТЕЛЯ проверяется on-chain. Издатель == oracle_authority.
    // msg = b"enrg:manifest" || manifest_id(16) || content_hash(32) || version(1).
    const publisherKey = Array.from(authority.toBuffer());
    const manifestVersion = 1;
    const signMsg = Buffer.concat([
      Buffer.from("enrg:manifest", "utf8"),
      Buffer.from(manifestId),
      contentHash,
      Buffer.from([manifestVersion]),
    ]);
    const signature = Array.from(nacl.sign.detached(signMsg, provider.wallet.payer.secretKey));
    const regIx = await program.methods
      .registerManifestVerification(manifestId, publisherKey, Array.from(contentHash), signature, manifestVersion)
      .accountsStrict({
        verification,
        registry,
        publisher: authority,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const regTx = new Transaction().add(ed25519Ix(signMsg, provider.wallet.payer), regIx);
    await provider.sendAndConfirm(regTx, [provider.wallet.payer]);
    console.log("✔ registerManifestVerification (signed)");

    await program.methods
      .updateMerkleRoot(Array.from(root), new BN(4))
      .accountsStrict({ registry, oracle, authority })
      .signers([provider.wallet.payer])
      .rpc();
    console.log("✔ updateMerkleRoot ; root =", root.toString("hex"));

    // verifyMerkleProof: leaf обязан равняться manifest_leaf(manifest_id || content_hash).
    const myLeaf = manifestLeaf(manifestId, contentHash);
    const sig = await program.methods
      .verifyMerkleProof(
        manifestId,
        proof.map((p) => Array.from(p)),
        Array.from(myLeaf),
        leafIndex
      )
      .accountsStrict({
        registry,
        manifestVerification: verification,
        proofVerification: proofAccount,
        verifier: authority,
        systemProgram: SystemProgram.programId,
      })
      .signers([provider.wallet.payer])
      .rpc();
    console.log("✔ verifyMerkleProof tx:", sig);
    assert.ok(sig.length > 0);
  });

  it("leaf, не связанный с содержимым манифеста, отклоняется (P0-1)", async () => {
    const authority = provider.wallet.publicKey;
    const registry = await registryPda(PROGRAM_ID);
    const manifestId = randomManifestId();
    const contentHash = Buffer.alloc(32, 9);
    const verification = await verificationPda(PROGRAM_ID, manifestId);
    const proofAccount = await proofPda(PROGRAM_ID, manifestId, registry);

    // Чужой leaf: тот же manifest_id, но leaf от ДРУГОГО content_hash.
    const foreignContent = Buffer.alloc(32, 10);
    const foreignLeaf = manifestLeaf(manifestId, foreignContent);
    const tree = buildMerkleTree([foreignLeaf]);
    const leafIndex = 0;
    const proof = getProof(tree, leafIndex);

    // Регистрируем манифест с contentHash (валидной подписью издателя).
    const publisherKey = Array.from(authority.toBuffer());
    const signMsg = Buffer.concat([
      Buffer.from("enrg:manifest", "utf8"),
      Buffer.from(manifestId),
      contentHash,
      Buffer.from([1]),
    ]);
    const signature = Array.from(nacl.sign.detached(signMsg, provider.wallet.payer.secretKey));
    const regIx = await program.methods
      .registerManifestVerification(manifestId, publisherKey, Array.from(contentHash), signature, 1)
      .accountsStrict({
        verification,
        registry,
        publisher: authority,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    await provider.sendAndConfirm(new Transaction().add(ed25519Ix(signMsg, provider.wallet.payer), regIx), [provider.wallet.payer]);

    await program.methods
      .updateMerkleRoot(Array.from(tree.root), new BN(1))
      .accountsStrict({ registry, oracle: authority, authority })
      .signers([provider.wallet.payer])
      .rpc();

    // Подпись корня действительна, но leaf не соответствует зарегистрированному
    // содержимому — on-chain обязан вернуть InvalidManifestLeaf.
    let failed = false;
    try {
      await program.methods
        .verifyMerkleProof(
          manifestId,
          proof.map((p) => Array.from(p)),
          Array.from(foreignLeaf),
          leafIndex
        )
        .accountsStrict({
          registry,
          manifestVerification: verification,
          proofVerification: proofAccount,
          verifier: authority,
          systemProgram: SystemProgram.programId,
        })
        .signers([provider.wallet.payer])
        .rpc();
    } catch (e: any) {
      failed = true;
      const msgText = String((e && e.message) || e);
      assert.ok(
        msgText.includes("InvalidManifestLeaf") || msgText.includes("0x"),
        `ожидали InvalidManifestLeaf, получили: ${msgText}`
      );
    }
    assert.ok(failed, "proof с чужим leaf должен быть отклонён (P0-1)");
  });
});
