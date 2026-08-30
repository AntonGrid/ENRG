/**
 * ENRG Oracle Quorum (P3-6, audit 2026-08-30).
 *
 * A proof attestation is confirmed when >= ORACLE_ATTESTATION_THRESHOLD (2)
 * DISTINCT trusted oracles from the OracleRegistry vote for the same
 * proof_hash. Votes are per-oracle PDAs, so one oracle cannot vote twice.
 * A later vote with a different hash marks the attestation as a conflict
 * (the economic basis for slash_oracle).
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider, Wallet } from "@coral-xyz/anchor";
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
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import nacl from "tweetnacl";
import rawIdl from "../target/idl/enrg_mvp.json";
import { patchIdl } from "./helpers/patch-idl";
import { ensureFunded } from "./helpers/accounts";

const PROGRAM_ID = new PublicKey("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");
const ENDPOINT = "http://127.0.0.1:8899";

const PREFIX = Buffer.from("enrg:oracle:attest");

function attestMessage(deviceId: PublicKey, nonce: BN, hash: Buffer): Buffer {
  const n = nonce.toArrayLike(Buffer, "le", 8);
  return Buffer.concat([PREFIX, deviceId.toBytes(), n, hash]);
}

function ed25519Ix(message: Buffer, signer: Keypair): TransactionInstruction {
  const signature = nacl.sign.detached(message, signer.secretKey);
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: signer.publicKey.toBytes(),
    message,
    signature,
  });
}

function find(seed: string, extra: Buffer[] = []): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(seed), ...extra], PROGRAM_ID)[0];
}

describe("ENRG — Oracle Quorum (P3-6)", () => {
  const connection = new Connection(ENDPOINT, "confirmed");
  // H-2: initializeOracleRegistry / addOracle require EXPECTED_DEPLOYER
  // (the founder) — mirror trust-ers-pool.ts and governance.ts.
  const founderPath =
    process.env.FOUNDER_KEYPAIR_PATH ||
    path.join(os.homedir(), ".config/solana/founder-wallet.json");
  const founder = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(founderPath, "utf8")))
  );
  const provider = new AnchorProvider(connection, new Wallet(founder), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(patchIdl(rawIdl), provider);

  const ora1 = Keypair.generate();
  const ora2 = Keypair.generate();
  const ora3 = Keypair.generate();
  const device = Keypair.generate();
  const hashA = Buffer.alloc(32, 1);
  const hashB = Buffer.alloc(32, 2);

  const registryPda = find("oracle-registry");

  async function stakeOracle(ora: Keypair) {
    await ensureFunded(connection, ora.publicKey);
    const [stakePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle-stake"), ora.publicKey.toBytes()],
      PROGRAM_ID
    );
    await program.methods
      .stakeOracle(new BN(50_000_000)) // 0.05 SOL deposit
      .accounts({
        oracleStake: stakePda,
        oracleRegistry: registryPda,
        oracleSigner: ora.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([ora])
      .rpc();
    return stakePda;
  }

  async function vote(ora: Keypair, deviceId: PublicKey, nonce: BN, hash: Buffer) {
    const attestPda = find("oracle-attest", [deviceId.toBytes(), nonce.toArrayLike(Buffer, "le", 8)]);
    const [votePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle-vote"), attestPda.toBytes(), ora.publicKey.toBytes()],
      PROGRAM_ID
    );
    const [stakePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle-stake"), ora.publicKey.toBytes()],
      PROGRAM_ID
    );
    const msg = attestMessage(deviceId, nonce, hash);
    const signature = nacl.sign.detached(msg, ora.secretKey);

    await program.methods
      .submitOracleAttestation(nonce, Array.from(hash), Array.from(signature))
      .accounts({
        attestation: attestPda,
        vote: votePda,
        deviceId,
        oracle: ora.publicKey,
        oracleRegistry: registryPda,
        oracleStake: stakePda,
        payer: provider.wallet.publicKey,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ed25519Ix(msg, ora)])
      .rpc();
    return { attestPda, msg };
  }

  before(async () => {
    await ensureFunded(connection, provider.wallet.publicKey);
    await ensureFunded(connection, device.publicKey);

    if (!(await connection.getAccountInfo(registryPda))) {
      await program.methods
        .initializeOracleRegistry()
        .accounts({ authority: provider.wallet.publicKey })
        .rpc();
    }
    const reg = await program.account.oracleRegistry.fetch(registryPda);
    for (const ora of [ora1, ora2, ora3]) {
      if (!reg.oracles.some((o: PublicKey) => o.equals(ora.publicKey))) {
        await program.methods
          .addOracle(ora.publicKey)
          .accounts({ registry: registryPda, authority: provider.wallet.publicKey })
          .rpc();
      }
    }
    await stakeOracle(ora1);
    await stakeOracle(ora2);
    await stakeOracle(ora3);
  });

  it("2 votes from distinct oracles finalize the attestation", async () => {
    const nonce = new BN(1);
    const { attestPda } = await vote(ora1, device.publicKey, nonce, hashA);
    let a: any = await program.account.oracleAttestation.fetch(attestPda);
    assert.strictEqual(a.votes, 1);
    assert.strictEqual(a.finalized, false);
    assert.deepStrictEqual(Array.from(a.proofHash), Array.from(hashA));

    await vote(ora2, device.publicKey, nonce, hashA);
    a = await program.account.oracleAttestation.fetch(attestPda);
    assert.strictEqual(a.votes, 2);
    assert.strictEqual(a.finalized, true);
    assert.strictEqual(a.conflict, false);
  });

  it("a single oracle cannot vote twice (PDA collision)", async () => {
    const nonce = new BN(2);
    await vote(ora1, device.publicKey, nonce, hashA);
    await assert.rejects(
      vote(ora1, device.publicKey, nonce, hashA),
      /already in use|custom program error/
    );
  });

  it("a contradicting vote marks the attestation as a conflict", async () => {
    const nonce = new BN(3);
    await vote(ora1, device.publicKey, nonce, hashA);
    await vote(ora2, device.publicKey, nonce, hashA);
    // ora3 votes with a DIFFERENT proof hash → conflict.
    await vote(ora3, device.publicKey, nonce, hashB);
    const attestPda = find("oracle-attest", [
      device.publicKey.toBytes(),
      nonce.toArrayLike(Buffer, "le", 8),
    ]);
    const a: any = await program.account.oracleAttestation.fetch(attestPda);
    assert.strictEqual(a.conflict, true);
    assert.strictEqual(a.finalized, true);
    // canonical hash stays the first one.
    assert.deepStrictEqual(Array.from(a.proofHash), Array.from(hashA));
  });

  it("a non-registered oracle cannot vote", async () => {
    const stranger = Keypair.generate();
    await ensureFunded(connection, stranger.publicKey);
    const nonce = new BN(4);
    const msg = attestMessage(device.publicKey, nonce, hashA);
    const signature = nacl.sign.detached(msg, stranger.secretKey);
    const attestPda = find("oracle-attest", [
      device.publicKey.toBytes(),
      nonce.toArrayLike(Buffer, "le", 8),
    ]);
    const [votePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle-vote"), attestPda.toBytes(), stranger.publicKey.toBytes()],
      PROGRAM_ID
    );
    const [stakePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle-stake"), stranger.publicKey.toBytes()],
      PROGRAM_ID
    );
    await assert.rejects(
      program.methods
        .submitOracleAttestation(nonce, Array.from(hashA), Array.from(signature))
        .accounts({
          attestation: attestPda,
          vote: votePda,
          deviceId: device.publicKey,
          oracle: stranger.publicKey,
          oracleRegistry: registryPda,
          oracleStake: stakePda,
          payer: provider.wallet.publicKey,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix(msg, stranger)])
        .rpc(),
      /custom program error|already initialized|AccountNotInitialized/
    );
  });
});

