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
import type { AccountClient, IdlAccounts } from "@coral-xyz/anchor";
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
import type { EnrgMvp } from "../target/types/enrg_mvp";
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

  // Typed account clients (from the generated IDL types) — the `methods`
  // namespace stays loose, account fetches get real generated types.
  type AccountNamespace = {
    [K in keyof IdlAccounts<EnrgMvp>]: AccountClient<EnrgMvp, K>;
  };
  const accounts = program.account as unknown as AccountNamespace;

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

  async function vote(
    ora: Keypair,
    deviceId: PublicKey,
    nonce: BN,
    hash: Buffer,
    configPda?: PublicKey | null
  ) {
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
        oracleQuorumConfig: configPda ?? null,
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
    const reg = await accounts.oracleRegistry.fetch(registryPda);
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
    let a: any = await accounts.oracleAttestation.fetch(attestPda);
    assert.strictEqual(a.votes, 1);
    assert.strictEqual(a.finalized, false);
    assert.deepStrictEqual(Array.from(a.proofHash), Array.from(hashA));

    await vote(ora2, device.publicKey, nonce, hashA);
    a = await accounts.oracleAttestation.fetch(attestPda);
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
    const a: any = await accounts.oracleAttestation.fetch(attestPda);
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
          oracleQuorumConfig: null,
          payer: provider.wallet.publicKey,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ed25519Ix(msg, stranger)])
        .rpc(),
      /custom program error|already initialized|AccountNotInitialized/
    );
  });

  it("config: init sets authority + required, threshold overrides finalize", async () => {
    const configPda = find("oracle-quorum-config");
    if (!(await connection.getAccountInfo(configPda))) {
      await program.methods
        .initOracleQuorum(false, 3, new BN(1_000_000_000)) // 3 votes needed, 1 SRC/vote
        .accounts({
          oracleQuorumConfig: configPda,
          oracleRegistry: registryPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    let cfg: any = await accounts.oracleQuorumConfig.fetch(configPda);
    assert.strictEqual(cfg.required, false);
    assert.strictEqual(cfg.threshold, 3);
    assert.strictEqual(cfg.rewardPerVote.toNumber(), 1_000_000_000);
    assert.ok(cfg.authority.equals(provider.wallet.publicKey));

    // Threshold 3 (from the config) → 2 votes do NOT finalize.
    const nonce = new BN(5);
    await vote(ora1, device.publicKey, nonce, hashA, configPda);
    await vote(ora2, device.publicKey, nonce, hashA, configPda);
    const attestPda = find("oracle-attest", [
      device.publicKey.toBytes(),
      nonce.toArrayLike(Buffer, "le", 8),
    ]);
    let a: any = await accounts.oracleAttestation.fetch(attestPda);
    assert.strictEqual(a.votes, 2);
    assert.strictEqual(a.finalized, false, "threshold=3 must not finalize at 2 votes");

    await vote(ora3, device.publicKey, nonce, hashA, configPda);
    a = await accounts.oracleAttestation.fetch(attestPda);
    assert.strictEqual(a.finalized, true, "3rd vote finalizes");
  });

  it("config: only the config authority can update it", async () => {
    const configPda = find("oracle-quorum-config");
    const stranger = Keypair.generate();
    await ensureFunded(connection, stranger.publicKey);
    await assert.rejects(
      program.methods
        .setOracleQuorum(true, 2, new BN(0))
        .accounts({
          oracleQuorumConfig: configPda,
          authority: stranger.publicKey,
        })
        .signers([stranger])
        .rpc(),
      /AnchorError|custom program error/
    );
    await program.methods
      .setOracleQuorum(true, 2, new BN(1_000_000_000))
      .accounts({
        oracleQuorumConfig: configPda,
        authority: provider.wallet.publicKey,
      })
      .rpc();
    const cfg: any = await accounts.oracleQuorumConfig.fetch(configPda);
    assert.strictEqual(cfg.required, true);
    assert.strictEqual(cfg.threshold, 2);
  });

  it("config: init rejects threshold < 2", async () => {
    const stranger = Keypair.generate();
    await ensureFunded(connection, stranger.publicKey);
    const cfgPda = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle-quorum-config")],
      PROGRAM_ID
    )[0];
    // PDA already exists → init_if_needed would collide; instead assert the
    // constraint path via set (threshold validation) on the existing config.
    await assert.rejects(
      program.methods
        .setOracleQuorum(true, 1, new BN(0))
        .accounts({ oracleQuorumConfig: cfgPda, authority: provider.wallet.publicKey })
        .rpc(),
      /AnchorError|custom program error/
    );
  });
});

