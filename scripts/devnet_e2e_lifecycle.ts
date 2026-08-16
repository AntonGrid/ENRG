#!/usr/bin/env ts-node
/**
 * ENRG — E2E device lifecycle + oracle mint (devnet/mainnet/localnet).
 *
 * Что делает:
 *   1. bootstrap протокола (идемпотентно):
 *        initialize_token → initialize_vault → fund ATAs → initialize_funds
 *        → initialize_oracle_registry → add_oracle → initialize_manifest_registry
 *        → init_config
 *   2. моделирует УСТРОЙСТВО (Ed25519-ключ) и ОРАКУЛА (Ed25519-ключ);
 *   3. прогоняет полный lifecycle (ADR-0005):
 *        register_device → claim_device → provision_device → activate_device
 *        → init_energy_profile (CPI в enrg-profile) → update_metadata
 *   4. формирует OracleReport с ДВУМЯ Ed25519-подписями (device + oracle)
 *      и вызывает mint_energy (ed25519-проверка + CPI record_production + SPL mint).
 *
 * Скрипт НЕ входит в `anchor test` (лежит в scripts/, а не в tests/).
 *
 * Конфигурация (env):
 *   RPC_ENDPOINT             по умолчанию http://127.0.0.1:8899
 *   ENRG_PROGRAM_ID          program id enrg_mvp (по умолчанию из Anchor.toml [programs.<cluster>])
 *   ENRG_PROFILE_PROGRAM_ID  program id enrg-profile (по умолчанию 78FUdpHn... из constants.rs)
 *   WALLET_PATH              keypair оператора (по умолчанию ~/.config/solana/id.json)
 *   SKIP_BOOTSTRAP=1         не трогать уже созданные аккаунты
 *
 * Флаги:
 *   --smoke                  mainnet dry-run: bootstrap + register_device (без claim/mint)
 *
 * Запуск:
 *   cd ~/Axis-workspace/ENRG
 *   RPC_ENDPOINT=https://api.devnet.solana.com yarn ts-node scripts/devnet_e2e_lifecycle.ts
 *   RPC_ENDPOINT=http://127.0.0.1:8899      yarn ts-node scripts/devnet_e2e_lifecycle.ts  # local
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Connection,
  Ed25519Program,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import nacl from "tweetnacl";

import { patchIdl } from "../tests/helpers/patch-idl";
import { loadAuthority } from "../tests/helpers/accounts";

// ════════════════════════════════════════════════════════════════
//  Конфигурация
// ════════════════════════════════════════════════════════════════

const DEFAULT_RPC = "http://127.0.0.1:8899";
const DEFAULT_PROFILE_PROGRAM_ID = "78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt";

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || DEFAULT_RPC;
const WALLET_PATH =
  process.env.WALLET_PATH || path.join(os.homedir(), ".config/solana/id.json");
const PROFILE_PROGRAM_ID = new PublicKey(
  process.env.ENRG_PROFILE_PROGRAM_ID || DEFAULT_PROFILE_PROGRAM_ID
);
const SMOKE = process.argv.includes("--smoke");
const SKIP_BOOTSTRAP = process.env.SKIP_BOOTSTRAP === "1";

const ENDPOINT_IS_LOCAL =
  RPC_ENDPOINT.includes("127.0.0.1") || RPC_ENDPOINT.includes("localhost");

// Параметры демо-минта: 90 kWh при rated_power 1 MW.
// M-4: MAX_RATED_POWER=1_000_000 Вт; тир Basic (v7.0 §15) лимит = 100_000 Wh/мес,
// поэтому ENERGY_WH=90_000 < 100_000 (иначе mint падает с TierLimitExceeded).
const ENERGY_WH = new BN(90_000);
const RATED_POWER = new BN(1_000_000);
const DEVICE_TYPE = "e2e-solar-panel";
const LOCATION = "devnet-e2e";

function detectCluster(): "devnet" | "mainnet" | "localnet" {
  if (RPC_ENDPOINT.includes("devnet")) return "devnet";
  if (RPC_ENDPOINT.includes("mainnet")) return "mainnet";
  return "localnet";
}

/** Читает enrg_mvp program id из секции [programs.<cluster>] Anchor.toml. */
function readAnchorTomlProgramId(
  cluster: "devnet" | "mainnet" | "localnet"
): string | null {
  const tomlPath = path.join(process.cwd(), "Anchor.toml");
  if (!fs.existsSync(tomlPath)) return null;
  const toml = fs.readFileSync(tomlPath, "utf8");
  const section = toml.match(new RegExp(`\\[programs\\.${cluster}\\][^\\[]*`));
  if (!section) return null;
  const key = section[0].match(/enrg_mvp\s*=\s*"([^"]+)"/);
  return key ? key[1] : null;
}

const CLUSTER = detectCluster();
const PROGRAM_ID = new PublicKey(
  process.env.ENRG_PROGRAM_ID ||
    readAnchorTomlProgramId(CLUSTER) ||
    "HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb"
);


// ════════════════════════════════════════════════════════════════
//  Хелперы
// ════════════════════════════════════════════════════════════════

const connection = new Connection(RPC_ENDPOINT, "confirmed");
const operator = loadAuthority(WALLET_PATH);
const provider = new AnchorProvider(connection, new Wallet(operator), {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});

function loadProgram(idlPath: string, programId: PublicKey): Program {
  const raw = JSON.parse(fs.readFileSync(idlPath, "utf8")) as any;
  if (raw.address !== programId.toBase58()) {
    console.warn(
      `⚠️  IDL адрес (${raw.address}) != PROGRAM_ID (${programId.toBase58()}). ` +
        `Убедитесь, что on-chain бинарник собран из кода с declare_id = ${programId.toBase58()}.`
    );
  }
  raw.address = programId.toBase58();
  raw.metadata = raw.metadata ?? {};
  raw.metadata.address = programId.toBase58();
  return new Program(patchIdl(raw), provider);
}

const program = loadProgram(
  path.join(process.cwd(), "target/idl/enrg_mvp.json"),
  PROGRAM_ID
);
const profileProgram = loadProgram(
  path.join(process.cwd(), "idls/enrg_profile.json"),
  PROFILE_PROGRAM_ID
);

function pdas(programId: PublicKey) {
  const find = (seed: Buffer) =>
    PublicKey.findProgramAddressSync([seed], programId)[0];
  return {
    vault: find(Buffer.from("vault")),
    tokenMint: find(Buffer.from("token-mint")),
    srcMint: find(Buffer.from("src-mint")),
    mintAuthority: find(Buffer.from("mint-authority")),
    buybackAuthority: find(Buffer.from("fund-buyback")),
    fundStaking: find(Buffer.from("fund-staking")),
    fundDao: find(Buffer.from("fund-dao")),
    fundEmergency: find(Buffer.from("fund-emergency")),
    oracleRegistry: find(Buffer.from("oracle-registry")),
    manifestRegistry: find(Buffer.from("manifest-registry")),
    config: find(Buffer.from("config")),
    producer: (deviceId: PublicKey) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("producer"), deviceId.toBytes()],
        programId
      )[0],
    ownerDevices: (owner: PublicKey) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("owner-devices"), owner.toBytes()],
        programId
      )[0],
    profile: (authority: PublicKey) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("profile"), authority.toBytes()],
        PROFILE_PROGRAM_ID
      )[0],
  };
}

const P = pdas(PROGRAM_ID);

async function accountExists(pk: PublicKey): Promise<boolean> {
  const info = await connection.getAccountInfo(pk);
  return info !== null;
}

// ── Моделируемые сущности (генерируются каждый запуск) ──
const device = nacl.sign.keyPair(); // Ed25519-ключ УСТРОЙСТВА (device_id = publicKey)
const oracle = nacl.sign.keyPair(); // Ed25519-ключ ОРАКУЛА (подписывает OracleReport)


/**
 * Аирдроп доступен только на local; на devnet/mainnet — только проверка баланса.
 * minLamports = 0.5 SOL: реально на bootstrap + lifecycle + mint уходит ~0.15 SOL,
 * а жёсткое требование 2 SOL ломает прогон после двух деплоев программ.
 */
async function ensureFunded(account: PublicKey, minLamports = 0.5 * LAMPORTS_PER_SOL) {
  const bal = await connection.getBalance(account);
  if (bal >= minLamports) return;
  if (ENDPOINT_IS_LOCAL) {
    await connection.requestAirdrop(account, minLamports);
  } else {
    try {
      await connection.requestAirdrop(
        account,
        Math.min(minLamports, LAMPORTS_PER_SOL)
      );
    } catch (e) {
      console.warn(`   ⚠️  Airdrop на ${CLUSTER} недоступен: ${(e as Error).message}`);
    }
  }
  await sleep(1500);
  const after = await connection.getBalance(account);
  if (after < minLamports) {
    throw new Error(
      `Недостаточно SOL у ${account.toBase58()} (${after} < ${minLamports}) на ${RPC_ENDPOINT}. ` +
        `Пополните кошелёк вручную и перезапустите.`
    );
  }
}

/** Текущее время по блокчейну (fallback — локальные часы). */
async function nowTs(): Promise<BN> {
  const slot = await connection.getSlot("finalized");
  const bt = await connection.getBlockTime(slot);
  return new BN(bt ?? Math.floor(Date.now() / 1000));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stepLog(name: string, ok: boolean, extra = "") {
  const mark = ok ? "✅" : "⏭";
  console.log(`   ${mark} ${name}${extra ? ` — ${extra}` : ""}`);
}

// ── Канонические сообщения (совпадают с Rust: security::lifecycle + state::oracle) ──

const REGISTER_PREFIX = Buffer.from("enrg:device:register");
const CLAIM_PREFIX = Buffer.from("enrg:device:claim");

function registerMessage(deviceId: PublicKey, ts: BN): Buffer {
  return Buffer.concat([
    REGISTER_PREFIX,
    deviceId.toBytes(),
    ts.toArrayLike(Buffer, "le", 8),
  ]);
}

function claimMessage(
  deviceId: PublicKey,
  owner: PublicKey,
  nonce: BN,
  ts: BN
): Buffer {
  return Buffer.concat([
    CLAIM_PREFIX,
    deviceId.toBytes(),
    owner.toBytes(),
    nonce.toArrayLike(Buffer, "le", 8),
    ts.toArrayLike(Buffer, "le", 8),
  ]);
}

/** OracleReport::device_message_to_sign(): device_id || nonce || device_timestamp || energy_wh */
function deviceProofMessage(
  deviceId: PublicKey,
  nonce: BN,
  deviceTimestamp: BN,
  energyWh: BN
): Buffer {
  return Buffer.concat([
    deviceId.toBytes(),
    nonce.toArrayLike(Buffer, "le", 8),
    deviceTimestamp.toArrayLike(Buffer, "le", 8),
    energyWh.toArrayLike(Buffer, "le", 8),
  ]);
}

/** OracleReport::oracle_message_to_sign(): device_id || nonce || device_timestamp || verified_at || energy_wh */
function oracleProofMessage(
  deviceId: PublicKey,
  nonce: BN,
  deviceTimestamp: BN,
  verifiedAt: BN,
  energyWh: BN
): Buffer {
  return Buffer.concat([
    deviceId.toBytes(),
    nonce.toArrayLike(Buffer, "le", 8),
    deviceTimestamp.toArrayLike(Buffer, "le", 8),
    verifiedAt.toArrayLike(Buffer, "le", 8),
    energyWh.toArrayLike(Buffer, "le", 8),
  ]);
}

function ed25519Ix(message: Buffer, signer: nacl.SignKeyPair): TransactionInstruction {
  const signature = nacl.sign.detached(message, signer.secretKey);
  // web3.js 1.98.x: publicKey ожидается как Uint8Array (32 байта).
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: signer.publicKey,
    message,
    signature,
  });
}

// ── Address Lookup Table: mint-транзакция с 2× ed25519 + 16 аккаунтами
// не помещается в legacy-лимит (1232 байта), поэтому используем v0-транзакцию. ──

/** Жёсткий таймаут на любую сетевую операцию (валидаторы бывают «виснущими»). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`timeout: ${label} (>${ms}ms)`)), ms)
    ),
  ]);
}

/** RPC-вызов с таймаутом. */
function rpc<T>(p: Promise<T>, label: string, ms = 10_000): Promise<T> {
  return withTimeout(p, ms, label);
}

async function sendAndConfirmLegacy(
  tx: Transaction,
  label: string
): Promise<string> {
  const latest = await rpc(connection.getLatestBlockhash("confirmed"), "latest blockhash");
  tx.feePayer = operator.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(operator);
  const sig = await withTimeout(
    connection.sendRawTransaction(tx.serialize(), {
      preflightCommitment: "confirmed",
      maxRetries: 2,
    }),
    15_000,
    `${label}: send`
  );
  await withTimeout(
    connection.confirmTransaction(
      {
        signature: sig,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    ),
    15_000,
    `${label}: confirm`
  );
  return sig;
}

async function ensureLookupTable(
  addresses: PublicKey[]
): Promise<AddressLookupTableAccount> {
  // Нюанс: у части валидаторов getSlot("confirmed") опережает контекст
  // исполнения транзакции, поэтому recentSlot == current отклоняется
  // программой LUT («not a recent slot»). Перебираем смещения вниз.
  const offsets = [0, -50, -100, -150, -250, -400, -600];
  for (let attempt = 0; attempt < 4; attempt++) {
    const baseSlot = await rpc(connection.getSlot("confirmed"), "getSlot");
    for (const offset of offsets) {
      const recentSlot = Math.max(1, baseSlot + offset);
      const [createIx, lut] = AddressLookupTableProgram.createLookupTable({
        authority: operator.publicKey,
        payer: operator.publicKey,
        recentSlot,
      });
      try {
        await sendAndConfirmLegacy(
          new Transaction().add(createIx),
          "LUT create"
        );
      } catch (e: any) {
        const msg = (e?.message ?? "").toString();
        if (msg.includes("not a recent slot")) {
          console.warn(
            `   ⏳ LUT create: слот ${recentSlot} не принят (offset ${offset}), пробую дальше...`
          );
          continue;
        }
        // Возможен и таймаут/флуктуация — пробуем следующий offset.
        if (msg.includes("timeout") || msg.includes("blockheight exceeded")) {
          console.warn(
            `   ⏳ LUT create: ${msg} (offset ${offset}), пробую дальше...`
          );
          continue;
        }
        throw e;
      }
      const extendIx = AddressLookupTableProgram.extendLookupTable({
        payer: operator.publicKey,
        authority: operator.publicKey,
        lookupTable: lut,
        addresses,
      });
      await sendAndConfirmLegacy(new Transaction().add(extendIx), "LUT extend");

      // RPC может отдавать устаревшее состояние таблицы — читаем с retry,
      // пока в LUT не окажется всех адресов.
      let lutAccount: AddressLookupTableAccount | null = null;
      for (let i = 0; i < 15 && !lutAccount; i++) {
        const { value } = await rpc(
          connection.getAddressLookupTable(lut, { commitment: "confirmed" }),
          "getAddressLookupTable"
        );
        if (value && value.state.addresses.length >= addresses.length) {
          lutAccount = value;
        } else {
          await sleep(400);
        }
      }
      if (!lutAccount) {
        throw new Error(
          `Address Lookup Table ${lut.toBase58()} не содержит всех адресов после extend`
        );
      }
      return lutAccount;
    }
    console.warn(
      `   ⏳ LUT: все offset не подошли (попытка ${attempt + 1}/4), обновляю слот...`
    );
  }
  throw new Error("Не удалось создать Address Lookup Table");
}

async function sendVersioned(
  instructions: TransactionInstruction[],
  lut: AddressLookupTableAccount
): Promise<string> {
  // У части валидаторов подтверждённое состояние LUT «опережает» контекст
  // исполнения транзакции, поэтому после создания таблицы делаем паузу и,
  // если runtime отвечает «invalid index», перечитываем LUT и повторяем.
  let currentLut = lut;
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(1200);
    const latest = await rpc(connection.getLatestBlockhash("confirmed"), "latest blockhash");
    const message = new TransactionMessage({
      payerKey: operator.publicKey,
      recentBlockhash: latest.blockhash,
      instructions,
    }).compileToV0Message([currentLut]);
    const tx = new VersionedTransaction(message);
    tx.sign([operator]);
    try {
      const sig = await withTimeout(
        connection.sendTransaction(tx, {
          preflightCommitment: "confirmed",
          maxRetries: 3,
        }),
        20_000,
        "v0 mint: send"
      );
      await withTimeout(
        connection.confirmTransaction(
          {
            signature: sig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          },
          "confirmed"
        ),
        20_000,
        "v0 mint: confirm"
      );
      return sig;
    } catch (e: any) {
      const msg = (e?.message ?? "").toString();
      if (
        msg.includes("invalid index") ||
        msg.includes("address table lookup") ||
        msg.includes("timeout") ||
        msg.includes("blockheight exceeded")
      ) {
        console.warn(
          `   ⏳ v0 mint (${msg.slice(0, 60)}) — перечитываю LUT, попытка ${attempt + 1}/5...`
        );
        const { value } = await rpc(
          connection.getAddressLookupTable(currentLut.key, {
            commitment: "confirmed",
          }),
          "getAddressLookupTable (retry)"
        );
        if (
          value &&
          value.state.addresses.length >= currentLut.state.addresses.length
        ) {
          currentLut = value;
        }
        continue;
      }
      throw e;
    }
  }
  throw new Error("v0-транзакция с LUT не прошла после повторных попыток");
}

// ════════════════════════════════════════════════════════════════
//  BOOTSTRAP — идемпотентно
// ════════════════════════════════════════════════════════════════

async function bootstrap() {
  console.log("\n📦 STEP 1. Bootstrap протокола\n");

  if (SKIP_BOOTSTRAP) {
    console.log("   ⏭ SKIP_BOOTSTRAP=1 — пропускаем bootstrap.");
    return;
  }

  // ── 1. initialize_token ──
  if (await accountExists(P.tokenMint)) {
    stepLog("initialize_token (уже существует)", false, P.tokenMint.toBase58());
  } else {
    await program.methods
      .initializeToken()
      .accounts({ authority: operator.publicKey })
      .rpc();
    stepLog("initialize_token", true, P.tokenMint.toBase58());
  }

  // ── 2. initialize_vault ──
  if (await accountExists(P.vault)) {
    stepLog("initialize_vault (уже существует)", false, P.vault.toBase58());
  } else {
    await program.methods
      .initializeVault()
      .accounts({ authority: operator.publicKey, mint: P.srcMint })
      .rpc();
    stepLog("initialize_vault", true, P.vault.toBase58());
  }

  // ── 3. fund ATAs (owner = fund PDA) ──
  const fundAtas = {
    buyback: getAssociatedTokenAddressSync(P.srcMint, P.buybackAuthority, true),
    staking: getAssociatedTokenAddressSync(P.srcMint, P.fundStaking, true),
    dao: getAssociatedTokenAddressSync(P.srcMint, P.fundDao, true),
    emergency: getAssociatedTokenAddressSync(P.srcMint, P.fundEmergency, true),
  };
  for (const [name, ata] of Object.entries(fundAtas)) {
    if (await accountExists(ata)) {
      stepLog(`fund ATA ${name} (уже существует)`, false, ata.toBase58());
    } else {
      const owner =
        name === "buyback"
          ? P.buybackAuthority
          : name === "staking"
          ? P.fundStaking
          : name === "dao"
          ? P.fundDao
          : P.fundEmergency;
      const ix = createAssociatedTokenAccountInstruction(
        operator.publicKey,
        ata,
        owner,
        P.srcMint
      );
      await provider.sendAndConfirm(new Transaction().add(ix), []);
      stepLog(`fund ATA ${name}`, true, ata.toBase58());
    }
  }

  // ── 4. initialize_funds (записывает fund ATAs в TokenMint PDA) ──
  const accounts = program.account as any; // account namespace у не-типизированного Program
  let tokenMintAcc: any = null;
  try {
    tokenMintAcc = await accounts.tokenMint.fetch(P.tokenMint);
  } catch (_) {
    /* ещё не инициализирован */
  }
  if (
    tokenMintAcc &&
    tokenMintAcc.buybackAccount.toBase58() !== PublicKey.default.toBase58()
  ) {
    stepLog("initialize_funds (уже выполнен)", false);
  } else {
    await program.methods
      .initializeFunds()
      .accounts({
        vault: P.vault,
        tokenMint: P.tokenMint,
        mint: P.srcMint,
        vaultAuthority: P.vault,
        buybackAccount: fundAtas.buyback,
        stakingAccount: fundAtas.staking,
        daoAccount: fundAtas.dao,
        emergencyAccount: fundAtas.emergency,
        authority: operator.publicKey,
      })
      .rpc();
    stepLog("initialize_funds", true);
  }

  // ── 5. initialize_oracle_registry ──
  if (await accountExists(P.oracleRegistry)) {
    stepLog("initialize_oracle_registry (уже существует)", false, P.oracleRegistry.toBase58());
  } else {
    await program.methods
      .initializeOracleRegistry()
      .accounts({ authority: operator.publicKey })
      .rpc();
    stepLog("initialize_oracle_registry", true, P.oracleRegistry.toBase58());
  }

  // ── 6. add_oracle ──
  let registryAcc: any = null;
  try {
    registryAcc = await accounts.oracleRegistry.fetch(P.oracleRegistry);
  } catch (_) {
    /* registry может быть ещё не создан */
  }
  const alreadyAdded =
    registryAcc &&
    registryAcc.oracles.some(
      (o: PublicKey) => o.toBase58() === oracleId.toBase58()
    );
  if (alreadyAdded) {
    stepLog("add_oracle (уже добавлен)", false, oracleId.toBase58());
  } else {
    await program.methods
      .addOracle(oracleId)
      .accounts({ registry: P.oracleRegistry, authority: operator.publicKey })
      .rpc();
    stepLog("add_oracle", true, oracleId.toBase58());
  }

  // ── 7. initialize_manifest_registry ──
  if (await accountExists(P.manifestRegistry)) {
    stepLog("initialize_manifest_registry (уже существует)", false, P.manifestRegistry.toBase58());
  } else {
    await program.methods
      .initializeManifestRegistry()
      .accounts({ payer: operator.publicKey })
      .rpc();
    stepLog("initialize_manifest_registry", true, P.manifestRegistry.toBase58());
  }

  // ── 8. init_config (oracle + mint binding) ──
  if (await accountExists(P.config)) {
    stepLog("init_config (уже существует)", false, P.config.toBase58());
  } else {
    await program.methods
      .initConfig(oracleId, P.srcMint)
      .accounts({ authority: operator.publicKey })
      .rpc();
    stepLog("init_config", true, P.config.toBase58());
  }
}


// ════════════════════════════════════════════════════════════════
//  DEVICE LIFECYCLE (ADR-0005)
// ════════════════════════════════════════════════════════════════

const deviceId = new PublicKey(device.publicKey);
const oracleId = new PublicKey(oracle.publicKey);
const producerPda = P.producer(deviceId);
const profilePda = P.profile(operator.publicKey);

async function deviceLifecycle() {
  console.log("\n🚗 STEP 2. Device lifecycle\n");

  // ── register_device (подпись устройства: "enrg:device:register" || device_id || ts) ──
  let ts = await nowTs();
  const regMsg = registerMessage(deviceId, ts);
  const regSig = Array.from(nacl.sign.detached(regMsg, device.secretKey));
  const regIx = await program.methods
    .registerDevice(regSig, ts)
    .accounts({
      operator: operator.publicKey,
      producer: producerPda,
      deviceId,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  await provider.sendAndConfirm(
    new Transaction().add(ed25519Ix(regMsg, device), regIx),
    []
  );
  stepLog("register_device", true, deviceId.toBase58());

  // ── claim_device (подпись устройства: claim prefix || device_id || owner || nonce || ts) ──
  ts = await nowTs();
  const claimNonce = new BN(1);
  const claimMsg = claimMessage(deviceId, operator.publicKey, claimNonce, ts);
  const claimSig = Array.from(nacl.sign.detached(claimMsg, device.secretKey));
  const claimIx = await program.methods
    .claimDevice(claimSig, claimNonce, ts)
    .accounts({
      authority: operator.publicKey,
      producer: producerPda,
      ownerDevices: P.ownerDevices(operator.publicKey),
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .instruction();
  await provider.sendAndConfirm(
    new Transaction().add(ed25519Ix(claimMsg, device), claimIx),
    []
  );
  stepLog("claim_device", true, `owner=${operator.publicKey.toBase58()}`);

  // ── provision_device / activate_device (owner-gated) ──
  await program.methods
    .provisionDevice()
    .accounts({ authority: operator.publicKey, producer: producerPda })
    .rpc();
  stepLog("provision_device", true);

  await program.methods
    .activateDevice()
    .accounts({
      authority: operator.publicKey,
      producer: producerPda,
      ownerDevices: P.ownerDevices(operator.publicKey),
    })
    .rpc();
  stepLog("activate_device", true);

  // ── init_energy_profile (CPI в enrg-profile; rated_power=0) ──
  if (!(await accountExists(profilePda))) {
    await program.methods
      .initEnergyProfile()
      .accounts({
        authority: operator.publicKey,
        producer: producerPda,
        profileProgram: PROFILE_PROGRAM_ID,
        profile: profilePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    stepLog("init_energy_profile", true, profilePda.toBase58());
  } else {
    stepLog("init_energy_profile (уже существует)", false, profilePda.toBase58());
  }

  // ── update_metadata в enrg-profile: rated_power ≥ energy_wh ──
  await profileProgram.methods
    .updateMetadata(RATED_POWER, DEVICE_TYPE, LOCATION)
    .accounts({ authority: operator.publicKey, profile: profilePda })
    .rpc();
  stepLog("update_metadata (rated_power)", true, RATED_POWER.toString());
}


// ════════════════════════════════════════════════════════════════
//  ORACLE REPORT + MINT
// ════════════════════════════════════════════════════════════════

async function oracleMint() {
  console.log("\n⚡ STEP 3. Oracle report + mint_energy\n");

  // Проверяем, что enrg-profile реально развёрнут on-chain (нужен для CPI).
  const profileInfo = await connection.getAccountInfo(PROFILE_PROGRAM_ID);
  if (!profileInfo || !profileInfo.executable) {
    throw new Error(
      `Программа enrg-profile НЕ обнаружена на ${RPC_ENDPOINT} по адресу ` +
        `${PROFILE_PROGRAM_ID.toBase58()}. Деплой: solana program deploy ` +
        `programs/enrg-profile/target/deploy/enrg_profile.so. Без неё mint_energy ` +
        `не сможет выполнить CPI record_production.`
    );
  }

  // User ATA для наград (владелец = authority/owner).
  const userAta = getAssociatedTokenAddressSync(P.srcMint, operator.publicKey, false);
  if (!(await accountExists(userAta))) {
    const ix = createAssociatedTokenAccountInstruction(
      operator.publicKey,
      userAta,
      operator.publicKey,
      P.srcMint
    );
    await provider.sendAndConfirm(new Transaction().add(ix), []);
    stepLog("user ATA", true, userAta.toBase58());
  } else {
    stepLog("user ATA (уже существует)", false, userAta.toBase58());
  }

  const now = await nowTs();
  const nonce = new BN(1);

  // ── Два сообщения и две Ed25519-подписи (device + oracle) ──
  const devMsg = deviceProofMessage(deviceId, nonce, now, ENERGY_WH);
  const oraMsg = oracleProofMessage(deviceId, nonce, now, now, ENERGY_WH);
  const devSig = nacl.sign.detached(devMsg, device.secretKey);
  const oraSig = nacl.sign.detached(oraMsg, oracle.secretKey);

  const report = {
    oracle: oracleId,
    deviceId,
    nonce,
    deviceTimestamp: now,
    verifiedAt: now,
    energyWh: ENERGY_WH,
    deviceSignature: Array.from(devSig),
    oracleSignature: Array.from(oraSig),
  };

  const fundAtas = {
    buyback: getAssociatedTokenAddressSync(P.srcMint, P.buybackAuthority, true),
    staking: getAssociatedTokenAddressSync(P.srcMint, P.fundStaking, true),
    dao: getAssociatedTokenAddressSync(P.srcMint, P.fundDao, true),
    emergency: getAssociatedTokenAddressSync(P.srcMint, P.fundEmergency, true),
  };

  const mintIx = await program.methods
    .mintEnergy(report)
    .accounts({
      producer: producerPda,
      vault: P.vault,
      tokenMint: P.tokenMint,
      mint: P.srcMint,
      mintAuthority: P.mintAuthority,
      userTokenAccount: userAta,
      buybackAccount: fundAtas.buyback,
      stakingAccount: fundAtas.staking,
      daoAccount: fundAtas.dao,
      emergencyAccount: fundAtas.emergency,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      oracleRegistry: P.oracleRegistry,
      tokenProgram: TOKEN_PROGRAM_ID,
      profileProgram: PROFILE_PROGRAM_ID,
      authority: operator.publicKey,
      profile: profilePda,
      // Опциональные аккаунты (Anchor 0.32 требует явный null).
      reputation: null,
      pool: null,
      poolShare: null,
      // ADR-0003: Policy Registry — опционален (null = дефолтные политики).
      policyRegistry: null,
    })
    .instruction();

  // Порядок важен: обе ed25519-прекомпиляции ДО mint_energy.
  // Транзакция не помещается в legacy-лимит (2× ed25519 + 16 аккаунтов),
  // поэтому используем v0-транзакцию с Address Lookup Table.
  const lut = await ensureLookupTable([
    producerPda,
    P.vault,
    P.tokenMint,
    P.srcMint,
    P.mintAuthority,
    userAta,
    fundAtas.buyback,
    fundAtas.staking,
    fundAtas.dao,
    fundAtas.emergency,
    SYSVAR_INSTRUCTIONS_PUBKEY,
    P.oracleRegistry,
    TOKEN_PROGRAM_ID,
    PROFILE_PROGRAM_ID,
    operator.publicKey,
    profilePda,
    Ed25519Program.programId,
  ]);
  const sig = await sendVersioned(
    [ed25519Ix(devMsg, device), ed25519Ix(oraMsg, oracle), mintIx],
    lut
  );
  stepLog("mint_energy (v0+LUT)", true, `sig=${sig}`);

  // ── Верификация результата ──
  const accounts = program.account as any;
  const producer = await accounts.energyProducer.fetch(producerPda);
  const userBal = (await connection.getTokenAccountBalance(userAta)).value.uiAmount;
  console.log(
    `   ℹ️  Producer state=${JSON.stringify(producer.state)} nonce=${producer.nonce.toString()} ` +
      `energy_wh=${producer.energyWh.toString()}`
  );
  console.log(`   ℹ️  User SRC balance: ${userBal}`);
}


// ════════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════════

async function main() {
  console.log("══════════════════════════════════════════════════════");
  console.log(` ENRG E2E — ${SMOKE ? "SMOKE (dry-run)" : "full lifecycle + mint"}`);
  console.log(` Cluster:  ${CLUSTER}  (${RPC_ENDPOINT})`);
  console.log(` enrg_mvp:       ${PROGRAM_ID.toBase58()}`);
  console.log(` enrg-profile:   ${PROFILE_PROGRAM_ID.toBase58()}`);
  console.log(` Operator wallet:${operator.publicKey.toBase58()}`);
  console.log(` Device (Ed25519):${deviceId.toBase58()}`);
  console.log(` Oracle (Ed25519):${oracleId.toBase58()}`);
  console.log("══════════════════════════════════════════════════════\n");

  await ensureFunded(operator.publicKey);

  // ВАЖНО: проверка программ до bootstrap (иначе ошибки будут непонятными).
  const progInfo = await connection.getAccountInfo(PROGRAM_ID);
  if (!progInfo || !progInfo.executable) {
    throw new Error(
      `Программа enrg_mvp НЕ обнаружена на ${RPC_ENDPOINT} по адресу ${PROGRAM_ID.toBase58()}. ` +
        `Сначала задеплойте (см. plan: anchor deploy / solana program deploy).`
    );
  }

  await bootstrap();

  if (SMOKE) {
    // Регистрация — единственное, что делает smoke-режим (mainnet dry-run).
    const regTs = await nowTs();
    const regMsg = registerMessage(deviceId, regTs);
    const regSig = Array.from(nacl.sign.detached(regMsg, device.secretKey));
    const regIx = await program.methods
      .registerDevice(regSig, regTs)
      .accounts({
        operator: operator.publicKey,
        producer: producerPda,
        deviceId,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    await provider.sendAndConfirm(
      new Transaction().add(ed25519Ix(regMsg, device), regIx),
      []
    );
    stepLog("register_device (smoke)", true, deviceId.toBase58());

    console.log("\n── SMOKE PASSED ─────────────────────────────────────");
    console.log(" Bootstrap + register_device выполнены с реальной Ed25519-подписью.");
    console.log(" (claim/provision/mint пропущены — dry-run.)\n");
    printSummary();
    return;
  }

  await deviceLifecycle();
  await oracleMint();

  console.log("\n── E2E PASSED ────────────────────────────────────────");
  printSummary();
}

function printSummary() {
  const fundAtas = {
    buyback: getAssociatedTokenAddressSync(P.srcMint, P.buybackAuthority, true),
    staking: getAssociatedTokenAddressSync(P.srcMint, P.fundStaking, true),
    dao: getAssociatedTokenAddressSync(P.srcMint, P.fundDao, true),
    emergency: getAssociatedTokenAddressSync(P.srcMint, P.fundEmergency, true),
  };
  const userAta = getAssociatedTokenAddressSync(P.srcMint, operator.publicKey, false);
  console.log("──────────────────────────────────────────────────────");
  console.log(" Сводка адресов (зафиксируйте для production):");
  console.log(`   enrg_mvp program       ${PROGRAM_ID.toBase58()}`);
  console.log(`   enrg-profile program   ${PROFILE_PROGRAM_ID.toBase58()}`);
  console.log(`   operator / authority   ${operator.publicKey.toBase58()}`);
  console.log(`   device_id (Ed25519)    ${deviceId.toBase58()}`);
  console.log(`   oracle (Ed25519)       ${oracleId.toBase58()}`);
  console.log("   ── PDAs (enrg_mvp) ──");
  console.log(`   vault                  ${P.vault.toBase58()}`);
  console.log(`   token_mint             ${P.tokenMint.toBase58()}`);
  console.log(`   src-mint (SRC Mint)    ${P.srcMint.toBase58()}`);
  console.log(`   mint-authority         ${P.mintAuthority.toBase58()}`);
  console.log(`   oracle-registry        ${P.oracleRegistry.toBase58()}`);
  console.log(`   manifest-registry      ${P.manifestRegistry.toBase58()}`);
  console.log(`   config                 ${P.config.toBase58()}`);
  console.log(`   producer (device)      ${producerPda.toBase58()}`);
  console.log("   ── Fund PDAs / ATAs ──");
  console.log(`   fund-buyback           ${P.buybackAuthority.toBase58()} -> ${fundAtas.buyback.toBase58()}`);
  console.log(`   fund-staking           ${P.fundStaking.toBase58()} -> ${fundAtas.staking.toBase58()}`);
  console.log(`   fund-dao               ${P.fundDao.toBase58()} -> ${fundAtas.dao.toBase58()}`);
  console.log(`   fund-emergency         ${P.fundEmergency.toBase58()} -> ${fundAtas.emergency.toBase58()}`);
  console.log(`   user ATA (owner)       ${userAta.toBase58()}`);
  console.log("   ── enrg-profile PDA ──");
  console.log(`   profile (owner)        ${profilePda.toBase58()}`);
  console.log("──────────────────────────────────────────────────────");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("\n❌ E2E failed:", e.message ?? e);
    if (e.logs) console.error(e.logs.slice(-12).join("\n"));
    process.exit(1);
  }
);

