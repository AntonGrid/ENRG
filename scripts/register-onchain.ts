#!/usr/bin/env node
/**
 * ENRG — on-chain device registration for a physical ESP32 (PoP via Serial).
 *
 * ADR-0001: the device's private key never leaves it. The script therefore
 * does NOT hold the device key — it asks the ESP32 to SIGN two canonical
 * messages over Serial, then builds the lifecycle transactions:
 *
 *   register_device → claim_device → provision_device → activate_device
 *
 * B4 (audit 2026-10-21): the device id is NOT hard-coded any more. Pass it
 * with `--device-id` (64 hex chars, optionally 0x-prefixed, or base58) or via
 * the DEVICE_ID environment variable.
 *
 * Usage:
 *   1) npx ts-node scripts/register-onchain.ts --prepare --device-id 0x<cbec…>
 *        → prints REGISTER_MESSAGE_HEX and CLAIM_MESSAGE_HEX (+ TS)
 *   2) In the ESP32 monitor (pio device monitor) run twice:
 *        SIGN <REGISTER_MESSAGE_HEX>
 *        SIGN <CLAIM_MESSAGE_HEX>
 *      copy the two `[SIGN] sig_base64 = ...` lines
 *   3) TS=<ts from step 1> REG_SIG=<reg sig> CLAIM_SIG=<claim sig> \
 *        npx ts-node scripts/register-onchain.ts --send --device-id 0x<cbec…>
 *
 *   npx ts-node scripts/register-onchain.ts --check --device-id 0x<cbec…>
 *        → read-only: prints the PDA and the current on-chain state/nonce.
 *
 * Environment:
 *   DEVICE_ID            same as --device-id
 *   ANCHOR_PROVIDER_URL  / RPC_ENDPOINT — RPC (default: devnet)
 *   ANCHOR_WALLET        / WALLET_PATH  — operator keypair (default: founder-wallet)
 *   REG_SIG / CLAIM_SIG   base64 signatures produced by the device
 *   TS                    timestamp signed in step 1 (REQUIRED for --send)
 *   CLAIM_NONCE           claim nonce (default 1)
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

const DEFAULT_ENDPOINT = "https://api.devnet.solana.com";

type Mode = "prepare" | "send" | "check";

interface Options {
  mode?: Mode;
  deviceId?: string;
  endpoint: string;
  walletPath: string;
  claimNonce: number;
  ts?: string;
  help: boolean;
}

function usage(): void {
  console.log(`ENRG on-chain device registration (PoP via Serial)

Usage:
  register-onchain.ts --prepare --device-id <0x-hex|base58>
      print the hex messages the ESP32 must SIGN (register + claim)
  register-onchain.ts --send --device-id <0x-hex|base58>
      send register_device → claim_device → provision_device → activate_device
      (requires TS, REG_SIG and CLAIM_SIG from --prepare)
  register-onchain.ts --check --device-id <0x-hex|base58>
      read-only: show the producer PDA and its current on-chain state

Options:
  --device-id <id>    device public key: 64 hex chars (0x… optional) or base58
                      (or set DEVICE_ID in the environment)
  --cluster <url>     RPC endpoint (default: ${DEFAULT_ENDPOINT})
  --wallet <path>     operator keypair (default: ~/.config/solana/founder-wallet.json)
  --claim-nonce <n>   claim nonce (default 1 / CLAIM_NONCE)
  --ts <unix>         timestamp signed in --prepare (required by --send)
  -h, --help          this text

Examples:
  npx ts-node scripts/register-onchain.ts --prepare --device-id 0xcbec5afc...
  TS=1789… REG_SIG=… CLAIM_SIG=… npx ts-node scripts/register-onchain.ts \\
      --send --device-id 0xcbec5afc...
  npx ts-node scripts/register-onchain.ts --check --device-id Ej2oCfDk...
`);
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    endpoint:
      process.env.ANCHOR_PROVIDER_URL || process.env.RPC_ENDPOINT || DEFAULT_ENDPOINT,
    walletPath:
      process.env.ANCHOR_WALLET ||
      process.env.WALLET_PATH ||
      `${process.env.HOME}/.config/solana/founder-wallet.json`,
    claimNonce: Number(process.env.CLAIM_NONCE || 1),
    deviceId: process.env.DEVICE_ID || undefined,
    ts: process.env.TS || undefined,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const name = eq >= 0 ? arg.slice(0, eq) : arg;
    const inlineValue = eq >= 0 ? arg.slice(eq + 1) : undefined;
    const nextValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) {
        throw new Error(`missing value for ${name}`);
      }
      return v;
    };

    switch (name) {
      case "--prepare":
        opts.mode = "prepare";
        break;
      case "--send":
        opts.mode = "send";
        break;
      case "--check":
        opts.mode = "check";
        break;
      case "--device-id":
      case "--device_id":
        opts.deviceId = nextValue();
        break;
      case "--cluster":
      case "--rpc":
      case "--url":
        opts.endpoint = nextValue();
        break;
      case "--wallet":
      case "--keypair":
        opts.walletPath = nextValue();
        break;
      case "--claim-nonce":
        opts.claimNonce = Number(nextValue());
        break;
      case "--ts":
        opts.ts = nextValue();
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg} (see --help)`);
    }
  }
  return opts;
}

/** Accepts 64 hex chars (0x prefix optional) or a base58 public key. */
function parseDeviceId(raw: string): PublicKey {
  const value = raw.trim();
  const hex = /^0x/i.test(value) ? value.slice(2) : value;

  if (/^[0-9a-fA-F]+$/.test(hex)) {
    if (hex.length !== 64) {
      throw new Error(
        `device id hex must be exactly 32 bytes (64 hex chars), got ${hex.length} chars`
      );
    }
    return new PublicKey(Buffer.from(hex, "hex"));
  }

  try {
    const key = new PublicKey(value);
    if (key.toBytes().length !== 32) throw new Error("not 32 bytes");
    return key;
  } catch {
    throw new Error(
      `device id must be 64 hex chars (0x… optional) or a base58 public key: ${value}`
    );
  }
}

function loadOperator(walletPath: string): Keypair {
  if (!fs.existsSync(walletPath)) {
    throw new Error(`wallet not found: ${walletPath} (use --wallet or ANCHOR_WALLET)`);
  }
  try {
    const secret = JSON.parse(fs.readFileSync(walletPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  } catch (e) {
    throw new Error(`cannot read the wallet ${walletPath}: ${(e as Error).message}`);
  }
}

const REGISTER_PREFIX = Buffer.from("enrg:device:register");
const CLAIM_PREFIX = Buffer.from("enrg:device:claim");

function registerMessage(deviceId: PublicKey, ts: anchor.BN): Buffer {
  return Buffer.concat([REGISTER_PREFIX, deviceId.toBytes(), ts.toArrayLike(Buffer, "le", 8)]);
}
function claimMessage(
  deviceId: PublicKey,
  owner: PublicKey,
  nonce: anchor.BN,
  ts: anchor.BN
): Buffer {
  return Buffer.concat([
    CLAIM_PREFIX,
    deviceId.toBytes(),
    owner.toBytes(),
    nonce.toArrayLike(Buffer, "le", 8),
    ts.toArrayLike(Buffer, "le", 8),
  ]);
}
function ed25519Ix(deviceId: PublicKey, message: Buffer, signature: Buffer) {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: deviceId.toBytes(),
    message,
    signature,
  });
}

async function nowTs(connection: Connection): Promise<anchor.BN> {
  const slot = await connection.getSlot("finalized");
  const bt = await connection.getBlockTime(slot);
  return new anchor.BN(bt ?? Math.floor(Date.now() / 1000));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || process.argv.length <= 2) {
    usage();
    process.exit(opts.help ? 0 : 1);
  }
  if (!opts.mode) {
    console.error("❌ choose a mode: --prepare | --send | --check");
    usage();
    process.exit(1);
  }
  if (!opts.deviceId) {
    console.error("❌ device id is required: --device-id <0x-hex|base58> or DEVICE_ID=<...>");
    console.error("   Example: npx ts-node scripts/register-onchain.ts --prepare \\");
    console.error(
      "              --device-id 0xcbec5afc382549012faf845ab25f593fe8f119d2ceb93f34ed308c283521584a"
    );
    process.exit(1);
  }
  if (!Number.isInteger(opts.claimNonce) || opts.claimNonce <= 0) {
    console.error("❌ --claim-nonce must be a positive integer");
    process.exit(1);
  }

  const DEVICE_ID = parseDeviceId(opts.deviceId);
  const operator = loadOperator(opts.walletPath);
  const connection = new Connection(opts.endpoint, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(operator), {
    commitment: "confirmed",
  });
  const IDL = require("./lib/load-idl").loadEnrgIdl();
  const program = new anchor.Program(IDL, provider);

  const [producerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("producer"), DEVICE_ID.toBuffer()],
    program.programId
  );
  const [ownerDevicesPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("owner-devices"), operator.publicKey.toBuffer()],
    program.programId
  );
  const claimNonce = new anchor.BN(opts.claimNonce);

  console.log("cluster          :", opts.endpoint);
  console.log("program          :", program.programId.toBase58());
  console.log("device_id (hex)  : 0x" + DEVICE_ID.toBuffer().toString("hex"));
  console.log("device_id (b58)  :", DEVICE_ID.toBase58());
  console.log("owner            :", operator.publicKey.toBase58());
  console.log("producer PDA     :", producerPda.toBase58());

  // Read-only mode: is the device already registered on this cluster?
  if (opts.mode === "check") {
    const account: any = await (program.account as any).energyProducer.fetchNullable(
      producerPda
    );
    if (!account) {
      console.log("state            : NOT REGISTERED on this cluster — proofs will be rejected");
      console.log(
        "                   (POST /api/v1/proof/submit → 404 device_not_registered_on_chain)"
      );
      return;
    }
    console.log("state            : registered on-chain ✅");
    console.log(
      "authority        :",
      account.authority?.toBase58?.() ?? String(account.authority)
    );
    console.log("device_state     :", JSON.stringify(account.state));
    console.log("nonce            :", account.nonce?.toString?.() ?? String(account.nonce));
    console.log("energy_wh        :", account.energyWh?.toString?.() ?? String(account.energyWh));
    console.log(
      "month_energy_wh  :",
      account.monthEnergyWh?.toString?.() ?? String(account.monthEnergyWh)
    );
    console.log("revoked          :", account.revoked);
    return;
  }

  // Timestamp: for --send it MUST be the one the device signed in --prepare.
  let ts: anchor.BN;
  if (opts.ts) {
    ts = new anchor.BN(opts.ts);
  } else if (opts.mode === "send") {
    console.error(
      "❌ TS is required for --send: the device signed the timestamp printed by --prepare."
    );
    console.error("   Re-run as: TS=<timestamp from --prepare> REG_SIG=… CLAIM_SIG=… … --send");
    process.exit(1);
  } else {
    ts = await nowTs(connection);
  }

  const regMsg = registerMessage(DEVICE_ID, ts);
  const claimMsg = claimMessage(DEVICE_ID, operator.publicKey, claimNonce, ts);

  if (opts.mode === "prepare") {
    const existing = await connection.getAccountInfo(producerPda);
    console.log("ownerDevices PDA :", ownerDevicesPda.toBase58());
    console.log(
      "producer account :",
      existing ? "EXISTS (already registered)" : "not found (free)"
    );
    console.log("ts               :", ts.toString());
    console.log("");
    console.log("REGISTER_MESSAGE_HEX:", regMsg.toString("hex"));
    console.log("CLAIM_MESSAGE_HEX   :", claimMsg.toString("hex"));
    console.log("");
    console.log("В мониторе ESP32 введи дважды:");
    console.log("  SIGN <REGISTER_MESSAGE_HEX>");
    console.log("  SIGN <CLAIM_MESSAGE_HEX>");
    console.log("и пришли обе строки [SIGN] sig_base64 = ...");
    console.log("");
    console.log("Затем (тот же ts!):");
    console.log(`  TS=${ts.toString()} REG_SIG=<reg> CLAIM_SIG=<claim> \\`);
    console.log(`    npx ts-node scripts/register-onchain.ts --send --device-id ${opts.deviceId}`);
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

  const existing = await connection.getAccountInfo(producerPda);
  if (existing) {
    console.error(`❌ ${producerPda.toBase58()} already exists on this cluster.`);
    console.error("   register_device would fail with 'account already in use'.");
    console.error("   Check the state with --check: a device that is already ACTIVE needs");
    console.error("   no registration; only the nonce (SETNONCE on the device) matters.");
    process.exit(1);
  }

  // 1. register_device — PoP от устройства (ed25519 в той же транзакции)
  const regIx = await program.methods
    .registerDevice(Array.from(regSig), ts)
    .accounts({
      operator: operator.publicKey,
      producer: producerPda,
      deviceId: DEVICE_ID,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  await provider.sendAndConfirm(new Transaction().add(ed25519Ix(DEVICE_ID, regMsg, regSig), regIx), []);
  console.log("✅ register_device");

  // 2. claim_device — PoP от устройства + привязка к владельцу
  const claimIx = await program.methods
    .claimDevice(Array.from(claimSig), claimNonce, ts)
    .accounts({
      authority: operator.publicKey,
      producer: producerPda,
      ownerDevices: ownerDevicesPda,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  await provider.sendAndConfirm(
    new Transaction().add(ed25519Ix(DEVICE_ID, claimMsg, claimSig), claimIx),
    []
  );
  console.log("✅ claim_device");

  // 3. provision_device / 4. activate_device (owner-gated)
  await program.methods
    .provisionDevice()
    .accounts({ authority: operator.publicKey, producer: producerPda })
    .rpc();
  console.log("✅ provision_device");

  await program.methods
    .activateDevice()
    .accounts({
      authority: operator.publicKey,
      producer: producerPda,
      ownerDevices: ownerDevicesPda,
    })
    .rpc();
  console.log("✅ activate_device");
  console.log("🎉 Устройство ACTIVE on-chain — proofs на Render пойдут!");
  console.log("");
  console.log("Проверка (read-only):");
  console.log(
    `  npx ts-node scripts/register-onchain.ts --check --device-id ${DEVICE_ID.toBase58()}`
  );
}

main().catch((e) => {
  console.error("❌", (e as Error).message || e);
  process.exit(1);
});
