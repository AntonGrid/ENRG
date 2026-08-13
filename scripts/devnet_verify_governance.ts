#!/usr/bin/env ts-node
/**
 * ENRG — Devnet verify-only: governance & vesting chain.
 *
 * Читает фактическое состояние Devnet и проверяет инварианты
 * governance/vesting/премайн-цепочки (docs/DEVNET_VERIFICATION_BASELINE.md,
 * docs/STATE.md). НЕ отправляет ни одной мутирующей транзакции — только
 * getAccountInfo / deserialize / getTokenAccountBalance + assert.
 *
 * Запуск:
 *   RPC_ENDPOINT=https://api.devnet.solana.com 
 *     yarn ts-node scripts/devnet_verify_governance.ts
 *
 * Exit code: 0 — все проверки зелёные (состояние консистентно с текущим кодом);
 *            1 — расхождения с baseline (подробности в логе); 2 — ошибка RPC.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { BN, AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { patchIdl } from "../tests/helpers/patch-idl";

// ════════════════════════════════════════════════════════════════
//  Конфигурация
// ════════════════════════════════════════════════════════════════

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || "https://api.devnet.solana.com";

const PROGRAM_ID = new PublicKey("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");
const PROGRAM_DATA = new PublicKey("ARg2GmnWHMPXaMwv5RYNVhTw4F2NZSoEFUkyT1pBLX8M");
const EXPECTED_AUTHORITY = new PublicKey("GkdhQQgUBi2Q422nTBP27LADkejijRwJEAnfhPYsUJSV");
const FOUNDER_WALLET = new PublicKey("6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8");
const BPF_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const MAX_SUPPLY_ATOMIC = new BN("1000000000000000000");
const FOUNDER_ALLOCATION_ATOMIC = new BN("200000000000000000");
const PROPOSAL_AMOUNT_MAX_ATOMIC = new BN("1000000000000000");
const CLIFF_SEC = 365 * 24 * 60 * 60;
const RELEASE_SEC = 3 * 365 * 24 * 60 * 60;

// ── PDA-адреса (findProgramAddress, без хардкода) ──
const findPda = (seed: string): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from(seed)], PROGRAM_ID)[0];

const vaultPda = findPda("vault");
const tokenMintPda = findPda("token-mint");
const mintPda = findPda("src-mint");
const mintAuthPda = findPda("mint-authority");
const governancePda = findPda("governance");
const [vestingPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("founder-vesting")],
  PROGRAM_ID
);
const proposalPda = (id: BN): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), id.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];
const founderAta = getAssociatedTokenAddressSync(mintPda, FOUNDER_WALLET, false);

// ════════════════════════════════════════════════════════════════
//  Отчёт
// ════════════════════════════════════════════════════════════════

let failures = 0;

function check(name: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "✔" : "✘"} ${name}: ${detail}`);
  if (!ok) failures += 1;
}

function section(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(2, 56 - title.length))}`);
}

// Чистая функция vested_at (зеркалит state/vesting.rs::vested_at).
function vestedAt(total: BN, start: number, cliff: number, release: number, now: number): BN {
  if (release <= 0) return new BN(0);
  const sinceStart = now - start;
  if (sinceStart < cliff) return new BN(0);
  const elapsed = Math.min(sinceStart - cliff, release);
  return total.mul(new BN(elapsed)).div(new BN(release));
}


async function main(): Promise<number> {
  console.log("ENRG — Devnet verify-only (governance & vesting chain)");
  console.log(`  RPC      : ${RPC_ENDPOINT}`);
  console.log(`  program  : ${PROGRAM_ID.toBase58()}`);
  console.log(`  time     : ${new Date().toISOString()}`);

  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  // Dummy-wallet: скрипт только читает, транзакции не отправляются.
  const provider = new AnchorProvider(
    connection,
    new Wallet(Keypair.generate()),
    { commitment: "confirmed" }
  );
  const rawIdl = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "target/idl/enrg_mvp.json"), "utf8")
  );
  rawIdl.address = PROGRAM_ID.toBase58();
  rawIdl.metadata = rawIdl.metadata ?? {};
  rawIdl.metadata.address = PROGRAM_ID.toBase58();
  const program: any = new Program(patchIdl(rawIdl), provider);

  // ── 1. Соединение ──
  section("1. Connection");
  try {
    const ver = await connection.getVersion();
    check("RPC reachable", true, `solana-core ${ver["solana-core"]}`);
  } catch (e: any) {
    check("RPC reachable", false, `${e?.message ?? e}`);
    return 2;
  }

  // ── 2. Программа и upgrade authority ──
  section("2. Program / ProgramData / authority");
  const progInfo = await connection.getAccountInfo(PROGRAM_ID);
  check("program account exists", !!progInfo, progInfo ? `len=${progInfo.data.length}` : "MISSING");
  if (progInfo) {
    check("program executable", progInfo.executable, "");
    check("program owner == BPFLoaderUpgradeable", progInfo.owner.equals(BPF_UPGRADEABLE),
      progInfo.owner.toBase58());
  }


  const pdInfo = await connection.getAccountInfo(PROGRAM_DATA);
  check("ProgramData exists", !!pdInfo, pdInfo ? `len=${pdInfo.data.length}` : "MISSING");
  let deployedSlot = 0n;
  if (pdInfo) {
    const d = pdInfo.data;
    const tag = d.readUInt32LE(0);
    deployedSlot = d.readBigUInt64LE(4);
    const opt = d.readUInt8(12);
    let programAuthority: PublicKey | null = null;
    if (tag === 3 && opt === 1 && d.length >= 45) {
      programAuthority = new PublicKey(d.subarray(13, 45));
    }
    check("ProgramData layout (ProgramData/slot/authority)", tag === 3 && opt === 1,
      `tag=${tag}, slot=${deployedSlot.toString()}`);
    if (programAuthority) {
      check("ProgramData upgrade authority == GkdhQQ…", programAuthority.equals(EXPECTED_AUTHORITY),
        programAuthority.toBase58());
    } else {
      check("ProgramData upgrade authority == GkdhQQ…", false, "authority не найден в layout");
    }
    const localSo = path.join(process.cwd(), "target/deploy/enrg_mvp.so");
    if (fs.existsSync(localSo)) {
      const deployedBin = d.subarray(45);
      const localBin = fs.readFileSync(localSo);
      const dh = crypto.createHash("sha256").update(deployedBin).digest("hex");
      const lh = crypto.createHash("sha256").update(localBin).digest("hex");
      check("deployed binary == local build (SHA-256)", dh === lh,
        `deployed=${dh.slice(0, 16)}…, local=${lh.slice(0, 16)}…`);
    }
  }


  // ── 3. Vault / TokenMint ──
  section("3. Vault / TokenMint");
  let vaultTotal = new BN(0);
  let vaultMax = new BN(0);
  const vaultInfo = await connection.getAccountInfo(vaultPda);
  check("vault PDA exists", !!vaultInfo, vaultInfo ? `owner=${vaultInfo.owner.toBase58()}` : "MISSING");
  if (vaultInfo) {
    check("vault owner == program", vaultInfo.owner.equals(PROGRAM_ID), vaultInfo.owner.toBase58());
    try {
      const v = await program.account.vault.fetch(vaultPda);
      vaultTotal = v.totalSupply;
      vaultMax = v.maxSupply;
      check("vault decodes (current IDL)", true, "");
      check("vault.authority == GkdhQQ…", v.authority.equals(EXPECTED_AUTHORITY), v.authority.toBase58());
      check("vault.max_supply == MAX_SUPPLY_ATOMIC (1e18)", v.maxSupply.eq(MAX_SUPPLY_ATOMIC),
        `max_supply=${v.maxSupply.toString()} (ожидалось 1e18)`);
      check("vault.total_supply ≤ max_supply", v.totalSupply.lte(v.maxSupply),
        `total_supply=${v.totalSupply.toString()} ≤ ${v.maxSupply.toString()}`);
    } catch (e: any) {
      check("vault decodes (current IDL)", false, `${e?.message ?? e}`);
    }
  }

  const tmInfo = await connection.getAccountInfo(tokenMintPda);
  check("token-mint PDA exists", !!tmInfo, tmInfo ? `len=${tmInfo.data.length}` : "MISSING");
  if (tmInfo) {
    check("token-mint owner == program", tmInfo.owner.equals(PROGRAM_ID), tmInfo.owner.toBase58());
    try {
      const t = await program.account.tokenMint.fetch(tokenMintPda);
      check("token-mint decodes (current IDL)", true, `len=${tmInfo.data.length}`);
      check("token-mint.mint == src-mint PDA", t.mint.equals(mintPda), t.mint.toBase58());
      check("token-mint.mint_authority == [b\"mint-authority\"]", t.mintAuthority.equals(mintAuthPda),
        t.mintAuthority.toBase58());
      check("token-mint.decimals == 9", t.decimals === SRC_DECIMALS, `decimals=${t.decimals}`);
    } catch (e: any) {
      check("token-mint decodes (current IDL)", false,
        `layout mismatch (len=${tmInfo.data.length}, ожидалось ~238): ${e?.message ?? e}`);
    }
  }



  // ── 4. SRC mint ──
  section("4. SRC mint");
  const mintParsed = await connection.getParsedAccountInfo(mintPda);
  const mintAcct = mintParsed.value;
  const TOKEN_PROG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  check("src-mint exists (SPL Token)", !!mintAcct && mintAcct.owner.toBase58() === TOKEN_PROG,
    mintAcct ? `owner=${mintAcct.owner.toBase58()}` : "MISSING");
  let mintSupply = new BN(0);
  if (mintAcct && mintAcct.data && (mintAcct.data as any).parsed) {
    const info = (mintAcct.data as any).parsed.info;
    mintSupply = new BN(info.supply as string);
    check("src-mint.decimals == 9", info.decimals === SRC_DECIMALS, `decimals=${info.decimals}`);
    const ma = new PublicKey(info.mintAuthority as string);
    check("src-mint.mintAuthority == [b\"mint-authority\"]", ma.equals(mintAuthPda), ma.toBase58());
    check("src-mint.supply == vault.total_supply", mintSupply.eq(vaultTotal),
      `supply=${mintSupply.toString()}, vault.total_supply=${vaultTotal.toString()}`);
  } else {
    check("src-mint parsed", false, "не удалось распарсить SPL mint");
  }


  // ── 5. Founder premine / founder ATA ──
  section("5. Founder premine / founder ATA");
  const ataInfo = await connection.getAccountInfo(founderAta);
  check("founder ATA exists", !!ataInfo,
    ataInfo ? `owner=${ataInfo.owner.toBase58()}` : "MISSING (премайн не выполнен)");
  if (ataInfo) {
    const bal = await connection.getTokenAccountBalance(founderAta);
    const fb = new BN(bal.value.amount);
    check("founder ATA == 2e17 (после премайна)", fb.eq(FOUNDER_ALLOCATION_ATOMIC),
      `balance=${fb.toString()}`);
  } else {
    check("founder ATA == 2e17 (после премайна)", false, "ATA отсутствует");
  }
  check("vault.total_supply учитывает премайн (>= 2e17)", vaultTotal.gte(FOUNDER_ALLOCATION_ATOMIC),
    `total_supply=${vaultTotal.toString()} (ожидалось >= 2e17 после премайна)`);


  // ── 6. Founder vesting (генезис-аккаунт) ──
  section("6. Founder vesting");
  const vestInfo = await connection.getAccountInfo(vestingPda);
  check("vesting account exists (genesis)", !!vestInfo,
    vestInfo ? `owner=${vestInfo.owner.toBase58()}, len=${vestInfo.data.length}` : "MISSING (не задеплоен)");
  if (vestInfo && vestInfo.owner.equals(PROGRAM_ID)) {
    try {
      const v = await program.account.founderVesting.fetch(vestingPda);
      const now = Math.floor(Date.now() / 1000);
      check("vesting.founder == FOUNDER_WALLET", v.founder.equals(FOUNDER_WALLET), v.founder.toBase58());
      check("vesting.total_amount == 2e17", v.totalAmount.eq(FOUNDER_ALLOCATION_ATOMIC),
        `total=${v.totalAmount.toString()}`);
      check("vesting.cliff == 1 год", v.cliff.toNumber() === CLIFF_SEC, `cliff=${v.cliff.toNumber()}s`);
      check("vesting.release == 3 года", v.release.toNumber() === RELEASE_SEC,
        `release=${v.release.toNumber()}s`);
      check("vesting.start_time > 0", v.startTime.toNumber() > 0, `start=${v.startTime.toNumber()}`);
      const vested = vestedAt(v.totalAmount, v.startTime.toNumber(), v.cliff.toNumber(),
        v.release.toNumber(), now);
      check("vesting.withdrawn ≤ vested (consistency)", v.withdrawn.lte(vested),
        `withdrawn=${v.withdrawn.toString()}, vested=${vested.toString()}`);
    } catch (e: any) {
      check("vesting decodes (current IDL)", false, `${e?.message ?? e}`);
    }
  } else if (vestInfo) {
    check("vesting owner == program", vestInfo.owner.equals(PROGRAM_ID), vestInfo.owner.toBase58());
  }

  // ── 7. Governance ──
  section("7. Governance");
  const govInfo = await connection.getAccountInfo(governancePda);
  check("governance PDA exists", !!govInfo,
    govInfo ? `owner=${govInfo.owner.toBase58()}, len=${govInfo.data.length}`
            : "MISSING (не инициализирован)");
  let govProposalCount = 0;
  if (govInfo && govInfo.owner.equals(PROGRAM_ID)) {
    try {
      const g = await program.account.governanceState.fetch(governancePda);
      check("governance decodes (current IDL)", true, "");
      check("governance.authority == GkdhQQ…", g.authority.equals(EXPECTED_AUTHORITY),
        g.authority.toBase58());
      check("governance.members в 3..=5", g.members.length >= 3 && g.members.length <= 5,
        `members=${g.members.length}`);
      govProposalCount = g.proposalCount.toNumber();
      console.log(`     members: ${g.members.map((m: PublicKey) => m.toBase58()).join(", ")}`);
    } catch (e: any) {
      check("governance decodes (current IDL)", false, `${e?.message ?? e}`);
    }
  } else if (govInfo) {
    check("governance owner == program", govInfo.owner.equals(PROGRAM_ID), govInfo.owner.toBase58());
  }



  // ── 8. Proposal (если есть история) ──
  section("8. Proposals");
  if (govProposalCount > 0) {
    for (let id = 1; id <= govProposalCount; id++) {
      const ppda = proposalPda(new BN(id));
      const pinfo = await connection.getAccountInfo(ppda);
      if (!pinfo) {
        check(`proposal #${id} exists`, false, `${ppda.toBase58()} MISSING`);
        continue;
      }
      check(`proposal #${id} owner == program`, pinfo.owner.equals(PROGRAM_ID), pinfo.owner.toBase58());
      try {
        const p = await program.account.proposal.fetch(ppda);
        const statusKey = Object.keys(p.status ?? {})[0] ?? "?";
        check(`proposal #${id} decodes`, true,
          `status=${statusKey}, amount=${p.amountAtomic.toString()}`);
        check(`proposal #${id} amount ≤ 1e15 (cap)`, p.amountAtomic.lte(PROPOSAL_AMOUNT_MAX_ATOMIC),
          `amount=${p.amountAtomic.toString()}`);
        if (statusKey === "approved") {
          check(`proposal #${id} approved_at > 0`, p.approvedAt.toNumber() > 0,
            `approved_at=${p.approvedAt.toNumber()}`);
        }
      } catch (e: any) {
        check(`proposal #${id} decodes (current IDL)`, false, `${e?.message ?? e}`);
      }
    }
  } else {

  // ── 9. Итоговые инварианты ──
  section("9. Final invariants");
  check("vault.total_supply ≤ MAX_SUPPLY_ATOMIC (1e18)", vaultTotal.lte(MAX_SUPPLY_ATOMIC),
    `total_supply=${vaultTotal.toString()} ≤ 1e18`);
  check("src-mint.supply ≤ MAX_SUPPLY_ATOMIC (1e18)", mintSupply.lte(MAX_SUPPLY_ATOMIC),
    `supply=${mintSupply.toString()}`);

  const passed = failures === 0;
  console.log(`\n════════════════════════════════════════════════════════`);
  console.log(`  RESULT: ${passed ? "ALL CHECKS PASSED ✔" : `${failures} FAILED ✘`}`);
  console.log(`  program slot : ${deployedSlot.toString()}`);
  console.log(`  finished     : ${new Date().toISOString()}`);
  console.log(`════════════════════════════════════════════════════════`);
  if (!passed) {
    console.log("⚠️  Найдены расхождения с текущей ревизией кода (см. ✘ выше).");
    console.log("  Ничего не создано/не заминчено — только чтение.");
  }
  return passed ? 0 : 1;
}

    console.log("  (нет proposal-истории — governance не инициализирован или счётчик = 0)");
  }


main()
  .then((code) => process.exit(code))
  .catch((e: any) => {
    console.error("❌ verification failed:", e?.message ?? e);
    process.exit(2);
  });

const SRC_DECIMALS = 9;
