/**
 * ENRG Proof-of-Intelligence commitment (ADR-0010 Phase 2).
 *
 * commit_contribution stores a contribution digest on-chain:
 *   PDA [b"poi-commit", round(8 LE), device_id(32)]
 * The device signs b"enrg:poi:commit" || round || device_id || digest
 * (Ed25519 precompile + sysvar Instructions verified on-chain).
 *
 * Covered here:
 *   - a valid device signature commits and stores (digest, round, signature);
 *   - the same (round, device) cannot be committed twice (PDA collision);
 *   - a foreign/invalid device signature is rejected (Ed25519VerificationFailed).
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  TransactionInstruction,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import * as assert from "assert";
import nacl from "tweetnacl";
import rawIdl from "../target/idl/enrg_mvp.json";
import { patchIdl } from "./helpers/patch-idl";
import { loadAuthority, ensureFunded } from "./helpers/accounts";

const PROGRAM_ID = new PublicKey("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");
const ENDPOINT = "http://127.0.0.1:8899";

const PREFIX = Buffer.from("enrg:poi:commit");

function commitMessage(round: BN, deviceId: PublicKey, digest: Buffer): Buffer {
  const r = round.toArrayLike(Buffer, "le", 8);
  return Buffer.concat([PREFIX, r, deviceId.toBytes(), digest]);
}

function ed25519Ix(message: Buffer, signer: Keypair): TransactionInstruction {
  const signature = nacl.sign.detached(message, signer.secretKey);
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: signer.publicKey.toBytes(),
    message,
    signature,
  });
}

function poiPda(round: BN, deviceId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("poi-commit"), round.toArrayLike(Buffer, "le", 8), deviceId.toBytes()],
    PROGRAM_ID
  );
  return pda;
}

describe("ENRG — Proof-of-Intelligence commitment (ADR-0010)", () => {
  const connection = new Connection(ENDPOINT, "confirmed");
  const provider = new AnchorProvider(
    connection,
    new anchor.Wallet(loadAuthority()),
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  const program = new Program(patchIdl(rawIdl), provider);

  // Deterministic digest (SHA-256 of "contribution-1").
  const digest = Buffer.from(
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "hex"
  );

  it("commits a contribution digest signed by the device", async () => {
    const device = Keypair.generate();
    await ensureFunded(connection, device.publicKey);
    const round = new BN(1);

    const msg = commitMessage(round, device.publicKey, digest);
    const signature = nacl.sign.detached(msg, device.secretKey);

    const pda = poiPda(round, device.publicKey);
    await program.methods
      .commitContribution(round, Array.from(digest), Array.from(signature))
      .accounts({
        commitment: pda,
        deviceId: device.publicKey,
        payer: provider.wallet.publicKey,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ed25519Ix(msg, device)])
      .rpc();

    const c: any = await (program.account as any).poiCommitment.fetch(pda);
    assert.strictEqual(c.deviceId.toBase58(), device.publicKey.toBase58());
    assert.ok(c.round.eq(round));
    assert.deepStrictEqual(Array.from(c.digest), Array.from(digest));
    assert.ok(c.committedAt.toNumber() > 0);
  });

  it("rejects a duplicate (round, device) commitment (PDA collision)", async () => {
    const device = Keypair.generate();
    await ensureFunded(connection, device.publicKey);
    const round = new BN(2);

    const msg = commitMessage(round, device.publicKey, digest);
    const signature = nacl.sign.detached(msg, device.secretKey);
    const pda = poiPda(round, device.publicKey);

    const send = async () =>
      program.methods
        .commitContribution(round, Array.from(digest), Array.from(signature))
        .accounts({
          commitment: pda,
          deviceId: device.publicKey,
          payer: provider.wallet.publicKey,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix(msg, device)])
        .rpc();

    await send();
    await assert.rejects(send(), /already in use|custom program error/);
  });

  it("rejects a signature from the wrong device", async () => {
    const device = Keypair.generate();
    const attacker = Keypair.generate();
    await ensureFunded(connection, device.publicKey);
    await ensureFunded(connection, attacker.publicKey);
    const round = new BN(3);

    const msg = commitMessage(round, device.publicKey, digest);
    // Signed by the ATTACKER, not the device.
    const badSignature = nacl.sign.detached(msg, attacker.secretKey);
    const pda = poiPda(round, device.publicKey);

    // An invalid Ed25519 signature is rejected by the runtime precompile
    // BEFORE the program runs — accept any program/runtime error.
    await assert.rejects(
      program.methods
        .commitContribution(round, Array.from(digest), Array.from(badSignature))
        .accounts({
          commitment: pda,
          deviceId: device.publicKey,
          payer: provider.wallet.publicKey,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix(msg, attacker)])
        .rpc()
    );
  });
});
