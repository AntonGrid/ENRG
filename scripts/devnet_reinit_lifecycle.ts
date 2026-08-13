#!/usr/bin/env ts-node
/**
 * ENRG — повторная инициализация жизненного цикла на чистой цепочке (Devnet).
 *
 * Выполняет release-цикл (docs/STATE.md, раздел 5) на СВЕЖИХ PDA нового program id:
 *   initialize_token → initialize_vault → fund ATAs → initialize_funds
 *   → allocate_founder (премайн 2e17) → initialize_founder_vesting (bootstrap-путь)
 *   → initialize_governance (authority + 3 генезис-члена)
 *
 * Каждый шаг идемпотентен (существующие аккаунты не пересоздаются), после каждого
 * шага — проверка owner/дешифрация. Транзакции с приоритетной комиссией
 * (ComputeBudget: setComputeUnitLimit + setComputeUnitPrice).
 *
 * Конфигурация (env):
 *   RPC_ENDPOINT                по умолчанию https://api.devnet.solana.com
 *   AUTHORITY_KEYPAIR_PATH      по умолчанию ~/.config/solana/id.json (оператор)
 *   FOUNDER_KEYPAIR_PATH        по умолчанию ~/.config/solana/founder-wallet.json
 *   GOVERNANCE_MEMBER_KEYPAIR   по умолчанию ~/.config/solana/governance-member.json
 *   PRIORITY_MICRO_LAMPORTS     по умолчанию 10000 (за CU)
 *
 * Запуск:
 *   cd ~/Axis-workspace/ENRG
 *   RPC_ENDPOINT=https://api.devnet.solana.com yarn ts-node scripts/devnet_reinit_lifecycle.ts
 */
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { patchIdl } from "../tests/helpers/patch-idl";

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || "https://api.devnet.solana.com";
const AUTHORITY_KEYPAIR_PATH =
  process.env.AUTHORITY_KEYPAIR_PATH || path.join(os.homedir(), ".config/solana/id.json");
const FOUNDER_KEYPAIR_PATH =
  process.env.FOUNDER_KEYPAIR_PATH || path.join(os.homedir(), ".config/solana/founder-wallet.json");
const GOV_MEMBER_PATH =
  process.env.GOVERNANCE_MEMBER_KEYPAIR || path.join(os.homedir(), ".config/solana/governance-member.json");
const PRIORITY_MICRO_LAMPORTS = Number(process.env.PRIORITY_MICRO_LAMPORTS || 10_000);
const COMPUTE_UNIT_LIMIT = 300_000;

const MAX_SUPPLY_ATOMIC = new BN("1000000000000000000"); // 1e18
const FOUNDER_ALLOCATION_ATOMIC = new BN("200000000000000000"); // 2e17
const SRC_DECIMALS = 9;

// ── Ключи ──
const operator = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(AUTHORITY_KEYPAIR_PATH, "utf8")))
);
const founder = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(FOUNDER_KEYPAIR_PATH, "utf8")))
);

function loadOrCreateMember(): Keypair {
  if (!fs.existsSync(GOV_MEMBER_PATH)) {
    const kp = Keypair.generate();
    fs.writeFileSync(GOV_MEMBER_PATH, JSON.stringify(Array.from(kp.secretKey)));
    console.log(`[governance] создан member-ключ: ${GOV_MEMBER_PATH} -> ${kp.publicKey.toBase58()}`);
    return kp;
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(GOV_MEMBER_PATH, "utf8"))));
}

const connection = new Connection(RPC_ENDPOINT, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(operator), {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});
const rawIdl = JSON.parse(fs.readFileSync(path.join(process.cwd(), "target/idl/enrg_mvp.json"), "utf8"));
const PROGRAM_ID = new PublicKey(rawIdl.address || "HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");
rawIdl.address = PROGRAM_ID.toBase58();
const program: any = new Program(patchIdl(rawIdl), provider);

const find = (seed: string) => PublicKey.findProgramAddressSync([Buffer.from(seed)], PROGRAM_ID)[0];
const vault = find("vault");
const tokenMint = find("token-mint");
const srcMint = find("src-mint");
const mintAuth = find("mint-authority");
const buybackAuth = find("fund-buyback");
const fundStaking = find("fund-staking");
const fundDao = find("fund-dao");
const fundEmergency = find("fund-emergency");
const [vesting] = PublicKey.findProgramAddressSync([Buffer.from("founder-vesting")], PROGRAM_ID);
const [governance] = PublicKey.findProgramAddressSync([Buffer.from("governance")], PROGRAM_ID);
const founderAta = getAssociatedTokenAddressSync(srcMint, founder.publicKey, false);

const fundAtas = {
  buyback: getAssociatedTokenAddressSync(srcMint, buybackAuth, true),
  staking: getAssociatedTokenAddressSync(srcMint, fundStaking, true),
  dao: getAssociatedTokenAddressSync(srcMint, fundDao, true),
  emergency: getAssociatedTokenAddressSync(srcMint, fundEmergency, true),
};

let failures = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  console.log(`  ${cond ? "✔" : "✘"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!cond) failures += 1;
}

async function exists(pk: PublicKey): Promise<boolean> {
  return (await connection.getAccountInfo(pk)) !== null;
}

/** Отправляет транзакцию с приоритетной комиссией через provider. */
async function sendWithPriorityFee(tx: Transaction, signers: Keypair[] = []): Promise<string> {
  tx.instructions.unshift(
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS })
  );
  tx.feePayer = operator.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  const sig = await provider.sendAndConfirm(tx, signers);
  console.log(`     tx: ${sig}`);
  return sig;
}

async function airdropIfNeeded(pk: PublicKey, min = 1 * 1e9): Promise<void> {
  const bal = await connection.getBalance(pk);
  if (bal >= min) return;
  console.log(`[funding] ${pk.toBase58()} balance=${bal}, requestAirdrop...`);
  try {
    await connection.requestAirdrop(pk, 2 * 1e9);
  } catch (e: any) {
    console.warn(`[funding] airdrop failed: ${e?.message ?? e} (продолжаем, если баланс достаточен)`);
  }
  await new Promise((r) => setTimeout(r, 3000));
}

async function main(): Promise<void> {
  console.log("ENRG — re-init lifecycle (fresh chain state)");
  console.log(`  RPC       : ${RPC_ENDPOINT}`);
  console.log(`  program   : ${PROGRAM_ID.toBase58()}`);
  console.log(`  operator  : ${operator.publicKey.toBase58()}`);
  console.log(`  founder   : ${founder.publicKey.toBase58()}`);

  const govMember = loadOrCreateMember();
  console.log(`  gov member: ${govMember.publicKey.toBase58()}`);

  await airdropIfNeeded(operator.publicKey);
  await airdropIfNeeded(founder.publicKey);

  // ── 1. initialize_token ──
  console.log("\n── 1. initialize_token ──");
  if (await exists(tokenMint)) {
    console.log("  ⏭ token-mint уже существует");
  } else {
    await sendWithPriorityFee(
      await program.methods.initializeToken().accounts({
        tokenMint, mint: srcMint, mintAuthority: mintAuth, buybackAuthority: buybackAuth,
        authority: operator.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
      }).transaction()
    );
  }
  const tmInfo = await connection.getAccountInfo(tokenMint);
  ok("token-mint: owner == program", !!tmInfo && tmInfo.owner.equals(PROGRAM_ID), `len=${tmInfo?.data.length}`);
  const tm: any = await program.account.tokenMint.fetch(tokenMint);
  ok("token-mint: decimals == 9", tm.decimals === SRC_DECIMALS, `decimals=${tm.decimals}`);
  ok("token-mint: mint == src-mint PDA", tm.mint.equals(srcMint), tm.mint.toBase58());
  ok("token-mint: mint_authority == PDA", tm.mintAuthority.equals(mintAuth), tm.mintAuthority.toBase58());
  const mintParsed: any = await connection.getParsedAccountInfo(srcMint);
  ok("src-mint: SPL + decimals 9", mintParsed.value?.owner.toBase58() === TOKEN_PROGRAM_ID.toBase58() &&
    mintParsed.value?.data?.parsed?.info?.decimals === SRC_DECIMALS);

  // ── 2. initialize_vault ──
  console.log("\n── 2. initialize_vault ──");
  if (await exists(vault)) {
    console.log("  ⏭ vault уже существует");
  } else {
    await sendWithPriorityFee(
      await program.methods.initializeVault().accounts({
        vault, authority: operator.publicKey, mint: srcMint, tokenMint,
        systemProgram: SystemProgram.programId,
      }).transaction()
    );
  }
  const v: any = await program.account.vault.fetch(vault);
  ok("vault: max_supply == 1e18", v.maxSupply.eq(MAX_SUPPLY_ATOMIC), `max=${v.maxSupply.toString()}`);
  ok("vault: deployer == operator", v.deployer.equals(operator.publicKey), v.deployer.toBase58());
  ok("vault: authority == operator", v.authority.equals(operator.publicKey), v.authority.toBase58());

  // ── 3. Fund ATAs ──
  console.log("\n── 3. fund ATAs ──");
  for (const [name, ata] of Object.entries(fundAtas)) {
    if (await exists(ata as PublicKey)) continue;
    const owner = name === "buyback" ? buybackAuth : name === "staking" ? fundStaking
      : name === "dao" ? fundDao : fundEmergency;
    await sendWithPriorityFee(
      new Transaction().add(createAssociatedTokenAccountInstruction(operator.publicKey, ata as PublicKey, owner, srcMint))
    );
    ok(`fund ATA ${name}`, await exists(ata as PublicKey), (ata as PublicKey).toBase58());
  }



  // ── 4. initialize_funds ──
  console.log("\n── 4. initialize_funds ──");
  const tmBefore: any = await program.account.tokenMint.fetch(tokenMint);
  if (tmBefore.buybackAccount.toBase58() !== PublicKey.default.toBase58()) {
    console.log("  ⏭ initialize_funds уже выполнен");
  } else {
    await sendWithPriorityFee(
      await program.methods.initializeFunds().accounts({
        vault, tokenMint, mint: srcMint, vaultAuthority: vault,
        buybackAccount: fundAtas.buyback, stakingAccount: fundAtas.staking,
        daoAccount: fundAtas.dao, emergencyAccount: fundAtas.emergency,
        authority: operator.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).transaction()
    );
  }
  const tmAfter: any = await program.account.tokenMint.fetch(tokenMint);
  ok("funds: buyback записан", tmAfter.buybackAccount.equals(fundAtas.buyback), tmAfter.buybackAccount.toBase58());
  ok("funds: dao записан", tmAfter.daoAccount.equals(fundAtas.dao), tmAfter.daoAccount.toBase58());

  // ── 5. allocate_founder (премайн 2e17) ──
  console.log("\n── 5. allocate_founder ──");
  if (tmAfter.founderMinted === 1) {
    console.log("  ⏭ премайн уже выполнен");
  } else {
    if (!(await exists(founderAta))) {
      const ix = createAssociatedTokenAccountInstruction(operator.publicKey, founderAta, founder.publicKey, srcMint);
      await sendWithPriorityFee(new Transaction().add(ix));
    }
    await sendWithPriorityFee(
      await program.methods.allocateFounder().accounts({
        vault, tokenMint, mint: srcMint, mintAuthority: mintAuth,
        founderTokenAccount: founderAta, payer: founder.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).transaction(),
      [founder]
    );
  }
  const fBal = (await connection.getTokenAccountBalance(founderAta)).value.amount;
  const vAfter: any = await program.account.vault.fetch(vault);
  ok("founder ATA == 2e17", fBal === FOUNDER_ALLOCATION_ATOMIC.toString(), `balance=${fBal}`);
  ok("vault.total_supply == 2e17", vAfter.totalSupply.eq(FOUNDER_ALLOCATION_ATOMIC), `total=${vAfter.totalSupply.toString()}`);


  // ── 6. initialize_founder_vesting (bootstrap-путь) ──
  console.log("\n── 6. initialize_founder_vesting ──");
  await sendWithPriorityFee(
    await program.methods.initializeFounderVesting().accounts({
      vesting, authority: founder.publicKey, systemProgram: SystemProgram.programId,
    }).transaction(),
    [founder]
  );
  const vestInfo = await connection.getAccountInfo(vesting);
  const vest: any = await program.account.founderVesting.fetch(vesting);
  ok("vesting: owner == program, len == 88", !!vestInfo && vestInfo.owner.equals(PROGRAM_ID) && vestInfo.data.length === 88,
    `len=${vestInfo?.data.length}`);
  ok("vesting.founder == founder", vest.founder.equals(founder.publicKey), vest.founder.toBase58());
  ok("vesting.total_amount == 2e17", vest.totalAmount.eq(FOUNDER_ALLOCATION_ATOMIC), vest.totalAmount.toString());
  ok("vesting.cliff == 1y / release == 3y",
    vest.cliff.toNumber() === 365 * 24 * 60 * 60 && vest.release.toNumber() === 3 * 365 * 24 * 60 * 60,
    `cliff=${vest.cliff.toNumber()}, release=${vest.release.toNumber()}`);

  // ── 7. initialize_governance ──
  console.log("\n── 7. initialize_governance ──");
  const members = [operator.publicKey, founder.publicKey, govMember.publicKey];
  if (await exists(governance)) {
    console.log("  ⏭ governance уже существует");
  } else {
    await sendWithPriorityFee(
      await program.methods.initializeGovernance(members).accounts({
        governance, authority: operator.publicKey, systemProgram: SystemProgram.programId,
      }).transaction()
    );
  }
  const g: any = await program.account.governanceState.fetch(governance);
  ok("governance.authority == operator", g.authority.equals(operator.publicKey), g.authority.toBase58());
  ok("governance.members 3..=5", g.members.length >= 3 && g.members.length <= 5, `members=${g.members.length}`);

  // ── Итог ──
  console.log(`\n════════════════════════════════════════════════════`);
  console.log(`  RESULT: ${failures === 0 ? "ALL OK ✔" : `${failures} FAILED ✘`}`);
  console.log(`  vault        ${vault.toBase58()}`);
  console.log(`  token-mint   ${tokenMint.toBase58()}`);
  console.log(`  src-mint     ${srcMint.toBase58()}`);
  console.log(`  mint-auth    ${mintAuth.toBase58()}`);
  console.log(`  vesting      ${vesting.toBase58()}`);
  console.log(`  governance   ${governance.toBase58()}`);
  console.log(`  founder ATA  ${founderAta.toBase58()}`);
  console.log(`  members      ${members.map((m) => m.toBase58()).join(", ")}`);
  console.log(`════════════════════════════════════════════════════`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("❌ reinit failed:", e?.message ?? e);
  if (e?.logs) console.error(e.logs.slice(-10).join("\n"));
  process.exit(2);
});
