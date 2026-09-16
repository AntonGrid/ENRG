/**
 * ENRG — PROOF: `mint_energy` works for a device owned by ANOTHER wallet.
 *
 * Audit 2026-09-16 (P0 ownership). Before this change the mint transaction had to
 * be signed by `producer.authority` (the profile CPI `record_production` required
 * the profile owner's signature), so the oracle could only mint for devices it
 * owned itself and the SRC always landed on the founder's ATA. This script proves
 * the fix end-to-end on a real cluster:
 *
 *   1. a FRESH device key + a FRESH owner wallet (neither is the founder/oracle);
 *   2. register -> claim (owner) -> provision -> activate -> profile (owner signs);
 *   3. two oracles attest the canonical proof hash -> finalized quorum attestation;
 *   4. the ORACLE submits `mint_energy` (the owner does NOT sign the mint);
 *   5. the SRC land on the OWNER's ATA — asserted by the balance delta.
 *
 * Usage:
 *   RPC_ENDPOINT=https://api.devnet.solana.com npx ts-node scripts/devnet_mint_third_party.ts
 *
 * Env:
 *   RPC_ENDPOINT        default https://api.devnet.solana.com
 *   OPERATOR_KEY_PATH   funds the fresh owner + creates the LUT (default ~/.config/solana/id.json)
 *   ORACLE_KEY_PATH     submits the mint (default ~/keys/enrg-mainnet/oracle-keypair.json)
 *   ORACLE2_KEY_PATH    second quorum voter (default ~/keys/enrg-mainnet/oracle-tx-keypair.json)
 *   OWNER_KEY_PATH      pre-existing owner (optional; otherwise a fresh key is generated)
 *   DEVICE_KEY_PATH     pre-existing device key (optional; otherwise a fresh key is generated)
 *   ENERGY_WH           energy of the proof (default 1000 = 1 kWh)
 *   RATED_POWER_W       device rated power (default 5000)
 *
 * NOTE: the LUT/v0 plumbing below mirrors `devnet_e2e_lifecycle.ts`. It should be
 * extracted into a shared helper module (follow-up); duplicated here so that the
 * proof stays self-contained.
 */
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Idl, Program, Wallet } from "@coral-xyz/anchor";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Connection,
  Ed25519Program,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import nacl from "tweetnacl";
import fs from "fs";
import os from "os";
import path from "path";
import { patchIdl } from "../tests/helpers/patch-idl";

const PROGRAM_ID = new PublicKey("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");
const PROFILE_PROGRAM_ID = new PublicKey("78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt");

const RPC_ENDPOINT =
  process.env.RPC_ENDPOINT || process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const ORACLE_KEY_PATH =
  process.env.ORACLE_KEY_PATH || path.join(os.homedir(), "keys/enrg-mainnet/oracle-keypair.json");
const ORACLE2_KEY_PATH =
  process.env.ORACLE2_KEY_PATH || path.join(os.homedir(), "keys/enrg-mainnet/oracle-tx-keypair.json");
const OPERATOR_KEY_PATH =
  process.env.OPERATOR_KEY_PATH || path.join(os.homedir(), ".config/solana/id.json");
const OWNER_KEY_PATH = process.env.OWNER_KEY_PATH || "";
const DEVICE_KEY_PATH = process.env.DEVICE_KEY_PATH || "";
const ENERGY_WH = Number(process.env.ENERGY_WH || 1000);
const RATED_POWER_W = Number(process.env.RATED_POWER_W || 5000);

const connection = new Connection(RPC_ENDPOINT, "confirmed");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadKeypair(p: string, label: string): Keypair {
  if (!p || !fs.existsSync(p)) throw new Error(`${label} keypair not found at ${p}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

const operator = loadKeypair(OPERATOR_KEY_PATH, "operator");
const oracle = loadKeypair(ORACLE_KEY_PATH, "oracle");
const oracle2 = loadKeypair(ORACLE2_KEY_PATH, "oracle2");
const owner = OWNER_KEY_PATH ? loadKeypair(OWNER_KEY_PATH, "owner") : Keypair.generate();
const device = DEVICE_KEY_PATH ? loadKeypair(DEVICE_KEY_PATH, "device") : Keypair.generate();
const deviceId = new PublicKey(device.publicKey);

const oracleProvider = new AnchorProvider(connection, new Wallet(oracle), {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});

function loadProgram(idlPath: string, programId: PublicKey, provider: AnchorProvider): Program {
  const raw = JSON.parse(fs.readFileSync(idlPath, "utf8")) as any;
  raw.address = programId.toBase58();
  raw.metadata = raw.metadata ?? {};
  return new Program(patchIdl(raw) as Idl, provider);
}

const ownerProvider = new AnchorProvider(connection, new Wallet(owner), {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});

const MVP_IDL = path.join(process.cwd(), "target/idl/enrg_mvp.json");
const PROFILE_IDL = path.join(process.cwd(), "idls/enrg_profile.json");

/** Mint side — the ORACLE is the wallet. */
const oracleProgram = loadProgram(MVP_IDL, PROGRAM_ID, oracleProvider);
/** Device lifecycle — the OWNER is the wallet (register/claim/provision/activate). */
const ownerProgram = loadProgram(MVP_IDL, PROGRAM_ID, ownerProvider);
/** enrg-profile: rated_power is set by the owner. */
const ownerProfileProgram = loadProgram(PROFILE_IDL, PROFILE_PROGRAM_ID, ownerProvider);
/** Second quorum voter (its own wallet — the vote is bound to its own Ed25519 key). */
const oracle2Provider = new AnchorProvider(connection, new Wallet(oracle2), {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});
const oracle2Program = loadProgram(MVP_IDL, PROGRAM_ID, oracle2Provider);

const find = (seed: string, extra: Buffer[] = [], pid = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed), ...extra], pid)[0];

const producerPda = find("producer", [deviceId.toBytes()]);
const profilePda = find("profile", [owner.publicKey.toBytes()], PROFILE_PROGRAM_ID);
const vault = find("vault");
const tokenMint = find("token-mint");
const srcMint = find("src-mint");
const mintAuthority = find("mint-authority");
const oracleRegistry = find("oracle-registry");
const policyRegistry = find("policy-registry");
const quorumConfig = find("oracle-quorum-config");
const ownerAta = getAssociatedTokenAddressSync(srcMint, owner.publicKey, false);
const fundAtas = {
  buyback: getAssociatedTokenAddressSync(srcMint, find("fund-buyback"), true),
  staking: getAssociatedTokenAddressSync(srcMint, find("fund-staking"), true),
  dao: getAssociatedTokenAddressSync(srcMint, find("fund-dao"), true),
  emergency: getAssociatedTokenAddressSync(srcMint, find("fund-emergency"), true),
};

const attestationPda = (nonce: BN) =>
  find("oracle-attest", [deviceId.toBytes(), nonce.toArrayLike(Buffer, "le", 8)]);
const votePda = (attestation: PublicKey, who: PublicKey) =>
  find("oracle-vote", [attestation.toBytes(), who.toBytes()]);
const stakePda = (who: PublicKey) => find("oracle-stake", [who.toBytes()]);

const step = (msg: string) => console.log(`\n${msg}`);

function ed25519Ix(message: Buffer, signer: Keypair): TransactionInstruction {
  const signature = nacl.sign.detached(message, signer.secretKey);
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: signer.publicKey.toBytes(),
    message,
    signature,
  });
}

const REGISTER_PREFIX = Buffer.from("enrg:device:register");
const CLAIM_PREFIX = Buffer.from("enrg:device:claim");

const registerMessage = (ts: BN) =>
  Buffer.concat([REGISTER_PREFIX, deviceId.toBytes(), ts.toArrayLike(Buffer, "le", 8)]);

const claimMessage = (nonce: BN, ts: BN) =>
  Buffer.concat([
    CLAIM_PREFIX,
    deviceId.toBytes(),
    owner.publicKey.toBytes(),
    nonce.toArrayLike(Buffer, "le", 8),
    ts.toArrayLike(Buffer, "le", 8),
  ]);

/** OracleReport::device_message_to_sign() — also the quorum `proof_hash` preimage. */
const deviceMessage = (nonce: BN, deviceTs: BN, energyWh: BN) =>
  Buffer.concat([
    deviceId.toBytes(),
    nonce.toArrayLike(Buffer, "le", 8),
    deviceTs.toArrayLike(Buffer, "le", 8),
    energyWh.toArrayLike(Buffer, "le", 8),
  ]);

/** OracleReport::oracle_message_to_sign() */
const oracleMessage = (nonce: BN, deviceTs: BN, verifiedAt: BN, energyWh: BN) =>
  Buffer.concat([
    deviceId.toBytes(),
    nonce.toArrayLike(Buffer, "le", 8),
    deviceTs.toArrayLike(Buffer, "le", 8),
    verifiedAt.toArrayLike(Buffer, "le", 8),
    energyWh.toArrayLike(Buffer, "le", 8),
  ]);

const sha256 = (buf: Buffer): Buffer => require("crypto").createHash("sha256").update(buf).digest();

const nowSec = () => Math.floor(Date.now() / 1000);

/** Owner-signed helper: send a legacy transaction paid by `payer`. */
async function sendLegacy(
  ixs: TransactionInstruction[],
  signers: Keypair[],
  payer: Keypair,
): Promise<string> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction().add(...ixs);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}

/** SOL top-up from the operator wallet (the public faucet is rate-limited). */
async function fundFromOperator(pk: PublicKey, sol: number): Promise<void> {
  const { SystemProgram } = await import("@solana/web3.js");
  await sendLegacy(
    [
      SystemProgram.transfer({
        fromPubkey: operator.publicKey,
        toPubkey: pk,
        lamports: Math.round(sol * 1e9),
      }),
    ],
    [operator],
    operator,
  );
}

/** Create + extend an Address Lookup Table (payer = operator). */
async function ensureLookupTable(addresses: PublicKey[]): Promise<AddressLookupTableAccount> {
  const offsets = [0, -50, -100, -150, -250, -400, -600];
  const baseSlot = await connection.getSlot("confirmed");
  let lut: PublicKey | null = null;
  for (const offset of offsets) {
    const recentSlot = Math.max(1, baseSlot + offset);
    const [createIx, table] = AddressLookupTableProgram.createLookupTable({
      authority: operator.publicKey,
      payer: operator.publicKey,
      recentSlot,
    });
    try {
      await sendLegacy([createIx], [operator], operator);
      lut = table;
      break;
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("not a recent slot") || msg.includes("timeout")) continue;
      throw e;
    }
  }
  if (!lut) throw new Error("could not create an Address Lookup Table");

  await sendLegacy(
    [
      AddressLookupTableProgram.extendLookupTable({
        payer: operator.publicKey,
        authority: operator.publicKey,
        lookupTable: lut,
        addresses,
      }),
    ],
    [operator],
    operator,
  );

  for (let i = 0; i < 15; i++) {
    const { value } = await connection.getAddressLookupTable(lut, { commitment: "confirmed" });
    if (value && value.state.addresses.length >= addresses.length) return value;
    await sleep(400);
  }
  throw new Error(`LUT ${lut.toBase58()} does not contain all addresses`);
}

/** Send a v0 transaction (2x ed25519 + ~18 accounts exceed the legacy 1232-byte limit). */
async function sendVersioned(
  instructions: TransactionInstruction[],
  lut: AddressLookupTableAccount,
  signer: Keypair,
): Promise<string> {
  let currentLut = lut;
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(1200);
    const latest = await connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: latest.blockhash,
      instructions,
    }).compileToV0Message([currentLut]);
    const tx = new VersionedTransaction(message);
    tx.sign([signer]);
    try {
      const sig = await connection.sendTransaction(tx, {
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });
      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        "confirmed",
      );
      return sig;
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (
        msg.includes("invalid index") ||
        msg.includes("address table lookup") ||
        msg.includes("timeout") ||
        msg.includes("blockheight exceeded")
      ) {
        const { value } = await connection.getAddressLookupTable(currentLut.key, {
          commitment: "confirmed",
        });
        if (value && value.state.addresses.length >= currentLut.state.addresses.length) {
          currentLut = value;
        }
        continue;
      }
      throw e;
    }
  }
  throw new Error("v0 transaction with the LUT did not pass after retries");
}

const tokenBalance = async (ata: PublicKey): Promise<number> => {
  try {
    return Number((await connection.getTokenAccountBalance(ata)).value.uiAmountString ?? 0);
  } catch {
    return 0; // ATA not created yet
  }
};

const DEVICE_TYPE = "solar";
const LOCATION = "third-party-proof";

async function main(): Promise<void> {
  const { SystemProgram } = await import("@solana/web3.js");

  step("STEP 0. Participants");
  console.log(`  chain:    ${RPC_ENDPOINT}`);
  console.log(`  owner:    ${owner.publicKey.toBase58()}   <- device authority, NOT the mint signer`);
  console.log(`  device:   ${deviceId.toBase58()}`);
  console.log(`  oracle:   ${oracle.publicKey.toBase58()}   <- submits the mint`);
  console.log(`  operator: ${operator.publicKey.toBase58()}   <- pays for the LUT`);
  if (owner.publicKey.equals(operator.publicKey) || owner.publicKey.equals(oracle.publicKey)) {
    throw new Error(
      "the owner must differ from the operator and the oracle — that is the point of this proof",
    );
  }

  step("STEP 1. Fund the owner (the whole lifecycle is owner-signed and owner-paid)");
  if ((await connection.getBalance(owner.publicKey)) < 0.1e9) {
    await fundFromOperator(owner.publicKey, 0.2);
  }
  console.log(`  owner balance: ${(await connection.getBalance(owner.publicKey)) / 1e9} SOL`);

  step("STEP 2. Device lifecycle — the OWNER signs, the oracle does not");
  const regTs = new BN(nowSec());
  const regMsg = registerMessage(regTs);
  await ownerProgram.methods
    .registerDevice(Array.from(nacl.sign.detached(regMsg, device.secretKey)), regTs)
    .accounts({
      operator: owner.publicKey,
      producer: producerPda,
      deviceId,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([ed25519Ix(regMsg, device)])
    .rpc();
  console.log("  register_device        OK");

  const claimNonce = new BN(1);
  const claimTs = new BN(nowSec());
  const claimMsg = claimMessage(claimNonce, claimTs);
  await ownerProgram.methods
    .claimDevice(Array.from(nacl.sign.detached(claimMsg, device.secretKey)), claimNonce, claimTs)
    .accounts({
      authority: owner.publicKey,
      producer: producerPda,
      ownerDevices: find("owner-devices", [owner.publicKey.toBytes()]),
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .preInstructions([ed25519Ix(claimMsg, device)])
    .rpc();
  console.log(`  claim_device           OK (authority = owner ${owner.publicKey.toBase58()})`);

  await ownerProgram.methods
    .provisionDevice()
    .accounts({ authority: owner.publicKey, producer: producerPda })
    .rpc();
  console.log("  provision_device       OK");

  await ownerProgram.methods
    .activateDevice()
    .accounts({
      authority: owner.publicKey,
      producer: producerPda,
      ownerDevices: find("owner-devices", [owner.publicKey.toBytes()]),
    })
    .rpc();
  console.log("  activate_device        OK");

  await ownerProgram.methods
    .initEnergyProfile()
    .accounts({
      authority: owner.publicKey,
      producer: producerPda,
      profileProgram: PROFILE_PROGRAM_ID,
      profile: profilePda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`  init_energy_profile    OK (profile ${profilePda.toBase58()})`);

  await ownerProfileProgram.methods
    .updateMetadata(new BN(RATED_POWER_W), DEVICE_TYPE, LOCATION)
    .accounts({ authority: owner.publicKey, profile: profilePda })
    .rpc();
  console.log(`  update_metadata        OK (rated_power = ${RATED_POWER_W} W)`);

  // The mint credits `user_token_account`, which must exist (created by the owner).
  const { getOrCreateAssociatedTokenAccount } = await import("@solana/spl-token");
  await getOrCreateAssociatedTokenAccount(connection, owner, srcMint, owner.publicKey);
  console.log(`  owner SRC ATA          OK (${ownerAta.toBase58()})`);

  step("STEP 3. Quorum attestation — two DISTINCT oracles attest the same canonical hash");
  const nonce = new BN(1);
  const deviceTs = new BN(nowSec());
  const verifiedAt = new BN(nowSec());
  const energyWh = new BN(ENERGY_WH);
  const devMsg = deviceMessage(nonce, deviceTs, energyWh);
  const proofHash = sha256(devMsg);
  const attestation = attestationPda(nonce);
  const attestMsg = Buffer.concat([
    Buffer.from("enrg:oracle:attest"),
    deviceId.toBytes(),
    nonce.toArrayLike(Buffer, "le", 8),
    proofHash,
  ]);

  const vote = async (who: Keypair, prog: Program, label: string) => {
    await prog.methods
      .submitOracleAttestation(
        nonce,
        Array.from(proofHash),
        Array.from(nacl.sign.detached(attestMsg, who.secretKey)),
      )
      .accounts({
        attestation,
        vote: votePda(attestation, who.publicKey),
        deviceId,
        oracle: who.publicKey,
        oracleRegistry,
        oracleStake: stakePda(who.publicKey),
        oracleQuorumConfig: quorumConfig,
        payer: who.publicKey,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ed25519Ix(attestMsg, who)])
      .rpc();
    console.log(`  ${label} OK (${who.publicKey.toBase58().slice(0, 8)}…)`);
  };

  await vote(oracle, oracleProgram, "oracle #1 vote");
  await vote(oracle2, oracle2Program, "oracle #2 vote");

  const att = await (oracleProgram.account as any).oracleAttestation.fetch(attestation);
  console.log(
    `  attestation ${attestation.toBase58()} | votes=${att.votes} finalized=${att.finalized} conflict=${att.conflict}`,
  );
  if (!att.finalized) throw new Error("the attestation did not finalize — is the quorum config on?");

  step("STEP 4. MINT — submitted and signed by the ORACLE, NOT by the device owner");
  const before = await tokenBalance(ownerAta);
  const oraMsg = oracleMessage(nonce, deviceTs, verifiedAt, energyWh);
  const report = {
    oracle: oracle.publicKey,
    deviceId,
    nonce,
    deviceTimestamp: deviceTs,
    verifiedAt,
    energyWh,
    deviceSignature: Array.from(nacl.sign.detached(devMsg, device.secretKey)),
    oracleSignature: Array.from(nacl.sign.detached(oraMsg, oracle.secretKey)),
  };

  const mintIx = await oracleProgram.methods
    .mintEnergy(report)
    .accounts({
      producer: producerPda,
      vault,
      tokenMint,
      mint: srcMint,
      mintAuthority,
      userTokenAccount: ownerAta,
      buybackAccount: fundAtas.buyback,
      stakingAccount: fundAtas.staking,
      daoAccount: fundAtas.dao,
      emergencyAccount: fundAtas.emergency,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      oracleRegistry,
      tokenProgram: TOKEN_PROGRAM_ID,
      profileProgram: PROFILE_PROGRAM_ID,
      authority: oracle.publicKey,
      profile: profilePda,
      producerOwner: owner.publicKey,
      reputation: null,
      pool: null,
      poolShare: null,
      policyRegistry,
      oracleQuorumConfig: quorumConfig,
      attestation,
    })
    .instruction();

  const lut = await ensureLookupTable([
    producerPda,
    vault,
    tokenMint,
    srcMint,
    mintAuthority,
    ownerAta,
    fundAtas.buyback,
    fundAtas.staking,
    fundAtas.dao,
    fundAtas.emergency,
    SYSVAR_INSTRUCTIONS_PUBKEY,
    oracleRegistry,
    TOKEN_PROGRAM_ID,
    PROFILE_PROGRAM_ID,
    oracle.publicKey,
    owner.publicKey,
    profilePda,
    Ed25519Program.programId,
    policyRegistry,
    quorumConfig,
    attestation,
  ]);

  const sig = await sendVersioned(
    [ed25519Ix(devMsg, device), ed25519Ix(oraMsg, oracle), mintIx],
    lut,
    oracle,
  );
  console.log(`  mint_energy            OK (tx ${sig})`);

  step("STEP 5. Result — the SRC must have arrived on the OWNER's ATA");
  const after = await tokenBalance(ownerAta);
  const producer = await (oracleProgram.account as any).energyProducer.fetch(producerPda);
  console.log(`  producer.authority:    ${producer.authority.toBase58()}`);
  console.log(`  producer.device_id:    ${producer.deviceId.toBase58()}`);
  console.log(`  owner ATA balance:     ${before} -> ${after} SRC`);
  if (after <= before) {
    throw new Error("FAIL: the mint succeeded but no SRC landed on the owner's ATA");
  }
  const ownerSol = await connection.getBalance(owner.publicKey);
  const oracleSol = await connection.getBalance(oracle.publicKey);
  console.log(`  owner SOL: ${ownerSol / 1e9} | oracle SOL: ${oracleSol / 1e9}`);
  console.log(
    "\nPASS — a device owned by a wallet that did NOT sign the mint received its SRC.",
  );
  console.log(`Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch((e) => {
  console.error(`\nFAILED against ${RPC_ENDPOINT}:`, e?.message ?? e);
  if (e?.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
