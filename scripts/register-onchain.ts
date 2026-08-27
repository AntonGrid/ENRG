#!/usr/bin/env node
/**
 * ENRG — on-chain device registration for the physical ESP32 (PoP via Serial).
 *
 * ADR-0001: the device's private key never leaves it. The script therefore
 * does NOT hold the device key — it asks the ESP32 to SIGN two canonical
 * messages over Serial, then builds the lifecycle transactions on devnet:
 *
 *   register_device → claim_device → provision_device → activate_device
 *
 * Usage:
 *   1) npx ts-node scripts/register-onchain.ts --prepare
 *        → prints REGISTER_MESSAGE_HEX and CLAIM_MESSAGE_HEX
 *   2) In the ESP32 monitor (pio device monitor) run twice:
 *        SIGN <REGISTER_MESSAGE_HEX>
 *        SIGN <CLAIM_MESSAGE_HEX>
 *      copy the two `[SIGN] sig_base64 = ...` lines
 *   3) REG_SIG=<reg sig> CLAIM_SIG=<claim sig> \
 *        npx ts-node scripts/register-onchain.ts --send
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import { Ed25519Program } from "@solana/web3.js";
import nacl from "tweetnacl";
import fs from "fs";

// ── The physical ESP32 device (public key only) ──
const DEVICE_ID_HEX = "cbec5afc382549012faf845ab25f593fe8f119d2ceb93f34ed308c283521584a";
const DEVICE_ID = new PublicKey(Buffer.from(DEVICE_ID_HEX, "hex"));

const ENDPOINT = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const WALLET_PATH = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/founder-wallet.json`;
const IDL = JSON.parse(fs.readFileSync("target/idl/enrg_mvp.json", "utf8"));

const operator = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")))
);
const connection = new Connection(ENDPOINT, "confirmed");
const provider = new anchor.AnchorProvider(
  connection,
  new anchor.Wallet(operator),
  { commitment: "confirmed" }
);
const program = new anchor.Program(IDL, provider);

const REGISTER_PREFIX = Buffer.from("enrg:device:register");
const CLAIM_PREFIX = Buffer.from("enrg:device:claim");

function registerMessage(ts: anchor.BN): Buffer {
  return Buffer.concat([REGISTER_PREFIX, DEVICE_ID.toBytes(), ts.toArrayLike(Buffer, "le", 8)]);
}
function claimMessage(owner: PublicKey, nonce: anchor.BN, ts: anchor.BN): Buffer {
  return Buffer.concat([
    CLAIM_PREFIX,
    DEVICE_ID.toBytes(),
    owner.toBytes(),
    nonce.toArrayLike(Buffer, "le", 8),
    ts.toArrayLike(Buffer, "le", 8),
  ]);
}
function ed25519Ix(message: Buffer, signature: Buffer) {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: DEVICE_ID.toBytes(),
    message,
    signature,
  });
}
async function nowTs(): Promise<anchor.BN> {
  const slot = await connection.getSlot("finalized");
  const bt = await connection.getBlockTime(slot);
  return new anchor.BN(bt ?? Math.floor(Date.now() / 1000));
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "--prepare" && mode !== "--send") {
    console.log("Usage: register-onchain.ts --prepare | --send");
    console.log("  --prepare  print the hex messages for the ESP32 SIGN command");
    console.log("  --send     send the lifecycle transactions (needs REG_SIG + CLAIM_SIG)");
    process.exit(1);
  }

  // TS env — reuse the timestamp the device already signed (from --prepare);
  // otherwise generate a fresh one (only for --prepare).
  const ts = process.env.TS ? new anchor.BN(process.env.TS) : await nowTs();
  const owner = operator.publicKey;
  const [producerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("producer"), DEVICE_ID.toBuffer()],
    program.programId
  );
  const [ownerDevicesPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("owner-devices"), owner.toBuffer()],
    program.programId
  );
  const claimNonce = new anchor.BN(1);

  const regMsg = registerMessage(ts);
  const claimMsg = claimMessage(owner, claimNonce, ts);

  if (mode === "--prepare") {
    console.log("owner            :", owner.toBase58());
    console.log("producer PDA     :", producerPda.toBase58());
    console.log("ownerDevices PDA :", ownerDevicesPda.toBase58());
    console.log("ts               :", ts.toString());
    console.log("");
    console.log("REGISTER_MESSAGE_HEX:", regMsg.toString("hex"));
    console.log("CLAIM_MESSAGE_HEX   :", claimMsg.toString("hex"));
    console.log("");
    console.log("В мониторе ESP32 введи дважды:");
    console.log("  SIGN <REGISTER_MESSAGE_HEX>");
    console.log("  SIGN <CLAIM_MESSAGE_HEX>");
    console.log("и пришли обе строки [SIGN] sig_base64 = ...");
    return;
  }

  const regSig = Buffer.from(process.env.REG_SIG || "", "base64");
  const claimSig = Buffer.from(process.env.CLAIM_SIG || "", "base64");
  if (regSig.length !== 64 || claimSig.length !== 64) {
    console.error("REG_SIG / CLAIM_SIG (base64, 64 bytes) required");
    process.exit(1);
  }

  // ADR-0001: verify the device signatures BEFORE spending any transaction.
  const devPub = DEVICE_ID.toBytes();
  if (!nacl.sign.detached.verify(regMsg, regSig, devPub)) {
    console.error("❌ register signature does NOT match the device key — redo SIGN");
    process.exit(1);
  }
  if (!nacl.sign.detached.verify(claimMsg, claimSig, devPub)) {
    console.error("❌ claim signature does NOT match the device key — redo SIGN");
    process.exit(1);
  }
  console.log("✅ device signatures verified (ts=" + ts.toString() + ")");

  // 1. register_device — PoP от устройства (ed25519 в той же транзакции)
  const regIx = await program.methods
    .registerDevice(Array.from(regSig), ts)
    .accounts({
      operator: owner,
      producer: producerPda,
      deviceId: DEVICE_ID,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  await provider.sendAndConfirm(
    new Transaction().add(ed25519Ix(regMsg, regSig), regIx),
    []
  );
  console.log("✅ register_device");

  // 2. claim_device — PoP от устройства + привязка к владельцу
  const claimIx = await program.methods
    .claimDevice(Array.from(claimSig), claimNonce, ts)
    .accounts({
      authority: owner,
      producer: producerPda,
      ownerDevices: ownerDevicesPda,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  await provider.sendAndConfirm(
    new Transaction().add(ed25519Ix(claimMsg, claimSig), claimIx),
    []
  );
  console.log("✅ claim_device");

  // 3. provision_device / 4. activate_device (owner-gated)
  await program.methods
    .provisionDevice()
    .accounts({ authority: owner, producer: producerPda })
    .rpc();
  console.log("✅ provision_device");

  await program.methods
    .activateDevice()
    .accounts({ authority: owner, producer: producerPda, ownerDevices: ownerDevicesPda })
    .rpc();
  console.log("✅ activate_device");
  console.log("🎉 Устройство ACTIVE on-chain — proofs на Render пойдут!");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});

