/**
 * ENRG — PROOF: a contradictory oracle vote cannot finalize an attestation.
 *
 * Audit 2026-09-16 (quorum semantics). Before the fix, EVERY vote incremented
 * `OracleAttestation.votes` and the attestation finalized on
 * `votes >= threshold`. With the shipped `threshold = 2` that meant:
 *
 *     oracle #1 votes hash X  -> votes = 1
 *     oracle #2 votes hash Y  -> votes = 2, finalized = TRUE   <-- WRONG
 *
 * i.e. one honest plus one CONTRADICTING oracle satisfied a "2 of n" quorum.
 * This script runs those exact two votes on a real cluster and asserts:
 *
 *     votes = 1, conflict = true, finalized = FALSE
 *
 * Usage:
 *   RPC_ENDPOINT=https://api.devnet.solana.com npx ts-node scripts/devnet_quorum_conflict.ts
 *
 * Env:
 *   RPC_ENDPOINT       default https://api.devnet.solana.com
 *   ORACLE_KEY_PATH    voter #1 (default ~/keys/enrg-mainnet/oracle-keypair.json)
 *   ORACLE2_KEY_PATH   voter #2 (default ~/keys/enrg-mainnet/oracle-tx-keypair.json)
 *   DEVICE_ID          device to attest (default: a random pubkey — the attestation
 *                      PDA only needs 32 bytes; no on-chain device is required)
 *   NONCE              proof nonce (default: current unix time)
 */
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Idl, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Ed25519Program,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import fs from "fs";
import os from "os";
import path from "path";
import { patchIdl } from "../tests/helpers/patch-idl";

const PROGRAM_ID = new PublicKey("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");
const RPC_ENDPOINT =
  process.env.RPC_ENDPOINT || process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const ORACLE_KEY_PATH =
  process.env.ORACLE_KEY_PATH || path.join(os.homedir(), "keys/enrg-mainnet/oracle-keypair.json");
const ORACLE2_KEY_PATH =
  process.env.ORACLE2_KEY_PATH || path.join(os.homedir(), "keys/enrg-mainnet/oracle-tx-keypair.json");
const NONCE = new BN(process.env.NONCE || Math.floor(Date.now() / 1000));

const connection = new Connection(RPC_ENDPOINT, "confirmed");

function loadKeypair(p: string, label: string): Keypair {
  if (!p || !fs.existsSync(p)) throw new Error(`${label} keypair not found at ${p}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

const oracle1 = loadKeypair(ORACLE_KEY_PATH, "oracle1");
const oracle2 = loadKeypair(ORACLE2_KEY_PATH, "oracle2");
const deviceId = process.env.DEVICE_ID
  ? new PublicKey(process.env.DEVICE_ID)
  : Keypair.generate().publicKey;

const idl = patchIdl(
  Object.assign(JSON.parse(fs.readFileSync("idls/enrg_mvp.json", "utf8")), {
    address: PROGRAM_ID.toBase58(),
  }),
) as Idl;

const program = (k: Keypair) =>
  new Program(
    idl,
    new AnchorProvider(connection, new Wallet(k), {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    }),
  );

const find = (seed: string, extra: Buffer[] = []) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed), ...extra], PROGRAM_ID)[0];

const attestationPda = find("oracle-attest", [
  deviceId.toBytes(),
  NONCE.toArrayLike(Buffer, "le", 8),
]);
const votePda = (who: PublicKey) => find("oracle-vote", [attestationPda.toBytes(), who.toBytes()]);
const stakePda = (who: PublicKey) => find("oracle-stake", [who.toBytes()]);
const oracleRegistry = find("oracle-registry");
const quorumConfig = find("oracle-quorum-config");

/** Hash X = the "honest" report; hash Y = the contradicting one. */
const HASH_X = Buffer.alloc(32, 0xaa);
const HASH_Y = Buffer.alloc(32, 0xbb);

const attestMessage = (hash: Buffer) =>
  Buffer.concat([
    Buffer.from("enrg:oracle:attest"),
    deviceId.toBytes(),
    NONCE.toArrayLike(Buffer, "le", 8),
    hash,
  ]);

const state = async () =>
  (program(oracle1).account as any).oracleAttestation.fetch(attestationPda);

/**
 * Anchor's TS coder may expose IDL field names either as-is (`proof_hash`) or
 * camelCased (`proofHash`) depending on the IDL format — accept both, so the proof
 * cannot fail on a decoding detail.
 */
const hashOf = (att: any): Buffer => {
  const v = att.proof_hash ?? att.proofHash;
  if (v === undefined) {
    throw new Error(`no proof hash in the decoded attestation: keys=${Object.keys(att).join(",")}`);
  }
  return Buffer.isBuffer(v) ? v : Buffer.from(v as number[]);
};

async function vote(who: Keypair, hash: Buffer, label: string): Promise<void> {
  const msg = attestMessage(hash);
  const signature = nacl.sign.detached(msg, who.secretKey);
  await program(who).methods
    .submitOracleAttestation(NONCE, Array.from(hash), Array.from(signature))
    .accounts({
      attestation: attestationPda,
      vote: votePda(who.publicKey),
      deviceId,
      oracle: who.publicKey,
      oracleRegistry,
      oracleStake: stakePda(who.publicKey),
      oracleQuorumConfig: quorumConfig,
      payer: who.publicKey,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([
      Ed25519Program.createInstructionWithPublicKey({
        publicKey: who.publicKey.toBytes(),
        message: msg,
        signature,
      }),
    ])
    .rpc();
  console.log(`  ${label} submitted`);
}

async function main(): Promise<void> {
  console.log(`\nENRG quorum-conflict proof @ ${RPC_ENDPOINT}`);
  console.log(`  device ${deviceId.toBase58()} | nonce ${NONCE.toString()}`);
  console.log(`  voter #1 ${oracle1.publicKey.toBase58()}`);
  console.log(`  voter #2 ${oracle2.publicKey.toBase58()}`);

  const cfg = await (program(oracle1).account as any).oracleQuorumConfig.fetch(quorumConfig);
  console.log(
    `  quorum config: required=${cfg.required} threshold=${cfg.threshold} ` +
      `(a contradiction must not satisfy it)\n`,
  );

  if (await connection.getAccountInfo(attestationPda)) {
    console.error("This (device, nonce) already has an attestation — rerun with NONCE=<new>.");
    process.exit(2);
  }

  console.log(`STEP 1. Oracle #1 votes the honest hash X (${HASH_X.subarray(0, 4).toString("hex")}…)`);
  await vote(oracle1, HASH_X, "vote #1");
  let att = await state();
  console.log(`  votes=${att.votes} finalized=${att.finalized} conflict=${att.conflict}`);
  if (att.votes !== 1 || att.finalized) throw new Error("unexpected state after the first vote");

  console.log(
    `\nSTEP 2. Oracle #2 votes a CONTRADICTING hash Y (${HASH_Y.subarray(0, 4).toString("hex")}…)`,
  );
  await vote(oracle2, HASH_Y, "vote #2");
  att = await state();
  console.log(`  votes=${att.votes} finalized=${att.finalized} conflict=${att.conflict}`);

  const ok =
    att.votes === 1 &&
    att.conflict === true &&
    att.finalized === false &&
    hashOf(att).equals(HASH_X);

  console.log("");
  if (!ok) {
    console.error(
      "FAIL — the contradicting vote advanced the quorum (or the state is unexpected). " +
        "Expected votes=1, conflict=true, finalized=false.",
    );
    process.exit(1);
  }
  console.log("PASS — the contradicting vote was recorded and did NOT finalize:");
  console.log(
    `  votes stays ${att.votes} (threshold ${cfg.threshold}), ` +
      `conflict=${att.conflict}, finalized=${att.finalized}`,
  );
  console.log(`  canonical hash kept: ${hashOf(att).toString("hex")}`);
  console.log(
    "\nNote: an agreeing vote from any further oracle still finalizes — see " +
      "demo/demo-recording.sh (two agreeing oracles -> finalized=true).",
  );
  console.log(`Attestation PDA: ${attestationPda.toBase58()}`);
}

main().catch((e) => {
  console.error(`\nFAILED against ${RPC_ENDPOINT}:`, e?.message ?? e);
  if (e?.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
