// ENRG Merkle proof flow — Anchor IDL style (ts-mocha).
import { Connection, PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import * as assert from "assert";
import { EnrgMvp } from "../target/types/enrg_mvp";
import rawIdl from "../target/idl/enrg_mvp.json";

import { buildMerkleTree, getProof, leafHash } from "./helpers/merkle";
import { registryPda, verificationPda, proofPda } from "./helpers/pda";
import { loadAuthority, ensureFunded, randomManifestId } from "./helpers/accounts";
import { patchIdl } from "./helpers/patch-idl";

const PROGRAM_ID = new PublicKey("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");

const idl = patchIdl(rawIdl);

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

    const leaves = [Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 3), Buffer.alloc(32, 4)];
    const tree = buildMerkleTree(leaves);
    const manifestId = randomManifestId();
    const leafIndex = 1;
    const proof = getProof(tree, leafIndex);
    const leafHashArr = Array.from(leafHash(leaves[leafIndex]));
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
      .accounts({ registry, payer: authority, systemProgram: SystemProgram.programId })
      .signers([provider.wallet.payer])
      .rpc();
    console.log("✔ initializeManifestRegistry");

    const publisherKey = Array.from(authority.toBuffer());
    const contentHash = Array.from(Buffer.alloc(32, 42));
    const signature = Array.from(Buffer.alloc(64, 77));
    await program.methods
      .registerManifestVerification(manifestId, publisherKey, contentHash, signature, 1)
      .accounts({ verification, publisher: authority, systemProgram: SystemProgram.programId })
      .signers([provider.wallet.payer])
      .rpc();
    console.log("✔ registerManifestVerification");

    await program.methods
      .updateMerkleRoot(Array.from(root), new BN(4))
      .accounts({ registry, oracle, authority })
      .signers([provider.wallet.payer])
      .rpc();
    console.log("✔ updateMerkleRoot ; root =", root.toString("hex"));

    const sig = await program.methods
      .verifyMerkleProof(
        manifestId,
        proof.map((p) => Array.from(p)),
        leafHashArr,
        leafIndex
      )
      .accounts({
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
});
