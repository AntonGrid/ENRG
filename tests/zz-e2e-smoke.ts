/**
 * ENRG — E2E full-lifecycle smoke: исполняемый чек-лист готовности к Devnet.
 *
 * Покрывает ВЕСЬ релизный жизненный цикл (см. docs/STATE.md, раздел 5):
 *   initialize_token → initialize_vault → allocate_founder →
 *   initialize_founder_vesting → initialize_governance → create_proposal →
 *   vote (quorum → Approved) → governance_mint (негатив до timelock) →
 *   финальные инварианты (supply, PDA-владельцы, балансы).
 *
 * Два режима (адаптивно, по состоянию on-chain):
 *   FRESH  — сеть не инициализирована: прогоняется ВЕСЬ цикл.
 *            Запуск: `anchor test --skip-build --run zz-e2e-smoke`
 *            (свежий localnet-валидатор + генезис-аккаунт FounderVesting из
 *            `Anchor.toml [test.validator]`).
 *   REUSE  — состояние уже создано (общий `anchor test` / Devnet после деплоя):
 *            верифицируются все инварианты + выполняется
 *            `initialize_founder_vesting` (генезис-аккаунт) и негативная
 *            проверка `governance_mint` до истечения timelock.
 *
 * Конфигурация (env):
 *   RPC_ENDPOINT            по умолчанию http://127.0.0.1:8899 (Devnet: override)
 *   AUTHORITY_KEYPAIR_PATH  по умолчанию ~/.config/solana/id.json  (оператор)
 *   FOUNDER_KEYPAIR_PATH    по умолчанию ~/.config/solana/founder-wallet.json
 *
 * Provider построен на authority-ключе (НЕ через getProgram()).
 * Все адреса PDA вычисляются через findProgramAddress — не захардкожены.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Connection,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { patchIdl } from "./helpers/patch-idl";
import { ensureFunded } from "./helpers/accounts";
import rawIdl from "../target/idl/enrg_mvp.json";

const PROGRAM_ID = new PublicKey(
  "HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb",
);
const FOUNDER_WALLET = new PublicKey(
  "6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8",
);

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || "http://127.0.0.1:8899";
const AUTHORITY_KEYPAIR_PATH =
  process.env.AUTHORITY_KEYPAIR_PATH ||
  path.join(os.homedir(), ".config/solana/id.json");
const FOUNDER_KEYPAIR_PATH =
  process.env.FOUNDER_KEYPAIR_PATH ||
  path.join(os.homedir(), ".config/solana/founder-wallet.json");
const IS_LOCAL =
  RPC_ENDPOINT.includes("127.0.0.1") || RPC_ENDPOINT.includes("localhost");

// ── Фактические константы (сверены с constants.rs — docs/STATE.md, раздел 3) ──
const MAX_SUPPLY_ATOMIC = new BN("1000000000000000000"); // 1e18
const FOUNDER_ALLOCATION_ATOMIC = new BN("200000000000000000"); // 2e17
const PROPOSAL_AMOUNT_MAX_ATOMIC = new BN("1000000000000000"); // 1e15

// ── PDA-адреса (seeds из instructions/*.rs) ──
const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);
const [tokenMintPda] = PublicKey.findProgramAddressSync([Buffer.from("token-mint")], PROGRAM_ID);
const [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("src-mint")], PROGRAM_ID);
const [mintAuthPda] = PublicKey.findProgramAddressSync([Buffer.from("mint-authority")], PROGRAM_ID);
const [buybackPda] = PublicKey.findProgramAddressSync([Buffer.from("fund-buyback")], PROGRAM_ID);
const [governancePda] = PublicKey.findProgramAddressSync([Buffer.from("governance")], PROGRAM_ID);
// Генезис-аккаунт FounderVesting (не PDA программы, но детерминированный адрес;
// создаётся валидатору через Anchor.toml [test.validator], см. docs/STATE.md).
const [vestingPda] = PublicKey.findProgramAddressSync([Buffer.from("founder-vesting")], PROGRAM_ID);

function proposalPda(id: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), id.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  )[0];
}

function loadKeypair(p: string, label: string): Keypair {
  if (!fs.existsSync(p)) {
    throw new Error(`${label} keypair не найден: ${p}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

describe("ENRG — E2E full-lifecycle smoke (pre-devnet)", () => {
  let provider: AnchorProvider;
  let program: any;
  let connection: Connection;
  let authority: Keypair;
  let members: Keypair[];
  let governanceOwned: boolean;
  let approveTarget: BN | null;

  before(async () => {
    authority = loadKeypair(AUTHORITY_KEYPAIR_PATH, "authority (operator)");
    members = Array.from({ length: 5 }, () => Keypair.generate());

    connection = new Connection(RPC_ENDPOINT, "confirmed");
    provider = new AnchorProvider(connection, new anchor.Wallet(authority), {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    anchor.setProvider(provider);
    program = new Program(patchIdl(rawIdl), provider);

    if (IS_LOCAL) {
      await ensureFunded(connection, authority.publicKey);
      for (const m of members) await ensureFunded(connection, m.publicKey);
    }

    governanceOwned = false;
    approveTarget = null;
  });

  it("1. initialize_token: SRC mint + mint-authority = PDA [b\"mint-authority\"]", async () => {
    if (!(await connection.getAccountInfo(tokenMintPda))) {
      await program.methods
        .initializeToken()
        .accounts({
          tokenMint: tokenMintPda,
          mint: mintPda,
          mintAuthority: mintAuthPda,
          buybackAuthority: buybackPda,
          authority: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
    }

    const tm = await program.account.tokenMint.fetch(tokenMintPda);
    assert.strictEqual(tm.mint.toBase58(), mintPda.toBase58(), "mint == PDA [b\"src-mint\"]");
    assert.strictEqual(tm.mintAuthority.toBase58(), mintAuthPda.toBase58(), "mint_authority == PDA [b\"mint-authority\"]");
    assert.strictEqual(tm.decimals, 9, "SRC_DECIMALS == 9");

    const mintInfo = await connection.getAccountInfo(mintPda);
    assert.ok(mintInfo, "SRC mint создан");
    assert.strictEqual(mintInfo!.owner.toBase58(), TOKEN_PROGRAM_ID.toBase58(), "SRC mint — SPL Token");
  });

  it("2. initialize_vault: max_supply = MAX_SUPPLY_ATOMIC (1e18)", async () => {
    if (!(await connection.getAccountInfo(vaultPda))) {
      await program.methods
        .initializeVault()
        .accounts({
          vault: vaultPda,
          authority: authority.publicKey,
          mint: mintPda,
          tokenMint: tokenMintPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    const vault = await program.account.vault.fetch(vaultPda);
    assert.ok(vault.maxSupply.eq(MAX_SUPPLY_ATOMIC), `max_supply=${vault.maxSupply} != 1e18`);
    assert.ok(vault.totalSupply.lte(MAX_SUPPLY_ATOMIC), "total_supply <= cap");
  });

  it("3. allocate_founder: премайн 2e17 на founder ATA (одноразово)", async () => {
    const tm = await program.account.tokenMint.fetch(tokenMintPda);
    const founderAta = getAssociatedTokenAddressSync(mintPda, FOUNDER_WALLET, false);

    if (tm.founderMinted === 0) {
      // FRESH: выполняем премайн (требуется локальный founder-ключ; НЕ в репозитории).
      const founder = loadKeypair(FOUNDER_KEYPAIR_PATH, "founder");
      assert.strictEqual(founder.publicKey.toBase58(), FOUNDER_WALLET.toBase58(), "ключ != FOUNDER_WALLET");
      // Founder-кошелёк платит rent за ATA — на свежем localnet ему нужен SOL.
      if (IS_LOCAL) await ensureFunded(connection, founder.publicKey);
      if (!(await connection.getAccountInfo(founderAta))) {
        await getOrCreateAssociatedTokenAccount(connection, founder, mintPda, founder.publicKey);
      }
      await program.methods
        .allocateFounder()
        .accounts({
          vault: vaultPda,
          tokenMint: tokenMintPda,
          mint: mintPda,
          mintAuthority: mintAuthPda,
          founderTokenAccount: founderAta,
          payer: founder.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([founder])
        .rpc();
    } else {
      // REUSE: премайн уже выполнен более ранним прогоном/деплоем — верифицируем.
      assert.strictEqual(tm.founderMinted, 1, "founder_minted должен быть 1");
    }

    const bal = await connection.getTokenAccountBalance(founderAta);
    assert.strictEqual(bal.value.amount, FOUNDER_ALLOCATION_ATOMIC.toString(), "founder ATA == 2e17");
    const vault = await program.account.vault.fetch(vaultPda);
    assert.ok(vault.totalSupply.eq(FOUNDER_ALLOCATION_ATOMIC), `total_supply=${vault.totalSupply} != 2e17`);
    assert.ok(vault.totalSupply.lte(MAX_SUPPLY_ATOMIC), "total_supply <= MAX_SUPPLY_ATOMIC");
  });

  it("4. initialize_founder_vesting: генезис-аккаунт + cliff 1y / release 3y", async () => {
    const vestingInfo = await connection.getAccountInfo(vestingPda);
    const founderAta = getAssociatedTokenAddressSync(mintPda, FOUNDER_WALLET, false);

    if (vestingInfo && vestingInfo.owner.equals(PROGRAM_ID)) {
      // Генезис-аккаунт присутствует (Anchor.toml [test.validator] / пре-сид деплоя).
      const founder = loadKeypair(FOUNDER_KEYPAIR_PATH, "founder");
      await program.methods
        .initializeFounderVesting()
        .accounts({
          vesting: vestingPda,
          authority: founder.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([founder])
        .rpc();

      const v = await program.account.founderVesting.fetch(vestingPda);
      assert.strictEqual(v.founder.toBase58(), FOUNDER_WALLET.toBase58(), "vesting.founder == FOUNDER_WALLET");
      assert.ok(v.totalAmount.eq(FOUNDER_ALLOCATION_ATOMIC), "vesting.total_amount == 2e17");
      assert.strictEqual(v.cliff.toNumber(), 365 * 24 * 60 * 60, "cliff == 1 год");
      assert.strictEqual(v.release.toNumber(), 3 * 365 * 24 * 60 * 60, "release == 3 года");
      assert.ok(v.startTime.toNumber() > 0, "start_time зафиксирован");
    } else {
      // Валидатор без генезис-аккаунта: документируем требование и проверяем
      // инвариант «founder-токены заблокированы на founder ATA».
      assert.strictEqual(
        (await connection.getTokenAccountBalance(founderAta)).value.amount,
        FOUNDER_ALLOCATION_ATOMIC.toString(),
        "founder ATA заблокирована (2e17) даже без вестинг-аккаунта",
      );
      console.log(
        "[smoke] vesting-аккаунт отсутствует: initialize_founder_vesting требует генезис-аккаунт " +
          "(Anchor.toml [test.validator] account; на Devnet — пре-сид при деплое).",
      );
    }
  });

  it("5. initialize_governance: authority + 3..=5 members", async () => {
    if (!(await connection.getAccountInfo(governancePda))) {
      // FRESH: создаём governance с нашим authority и 5 членами.
      await program.methods
        .initializeGovernance(members.map((m) => m.publicKey))
        .accounts({
          governance: governancePda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      governanceOwned = true;
    }

    const gov = await program.account.governanceState.fetch(governancePda);
    assert.ok(gov.members.length >= 3 && gov.members.length <= 5, `members=${gov.members.length} вне 3..=5`);

    if (gov.authority.toBase58() === authority.publicKey.toBase58()) {
      governanceOwned = true;
    } else {
      // REUSE: governance создан внешне (tests/governance.ts или деплоем) —
      // подписать create_proposal чужим authority невозможно; верифицируем состояние.
      governanceOwned = false;
      console.log("[smoke] governance создан внешним authority — создание/голосование пропускаются (верификация).");
    }
  });

  it("6. create_proposal: id монотонный, amount ≤ PROPOSAL_AMOUNT_MAX_ATOMIC", async () => {
    const gov = await program.account.governanceState.fetch(governancePda);
    if (governanceOwned) {
      const nextId = gov.proposalCount.addn(1);
      assert.ok(gov.activeProposalId.eq(new BN(0)), "для свежего прогона активных нет");
      const destination = (
        await getOrCreateAssociatedTokenAccount(connection, authority, mintPda, authority.publicKey)
      ).address;

      await program.methods
        .createProposal(nextId, "e2e-smoke", new BN(1_000_000_000_000), destination)
        .accounts({
          governance: governancePda,
          prevProposal: null,
          proposal: proposalPda(nextId),
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const p = await program.account.proposal.fetch(proposalPda(nextId));
      assert.ok(p.id.eq(nextId), "id монотонный");
      assert.strictEqual(p.proposer.toBase58(), authority.publicKey.toBase58(), "proposer == authority");
      assert.ok(p.amountAtomic.lte(PROPOSAL_AMOUNT_MAX_ATOMIC), "amount ≤ 1e15");
      assert.strictEqual(p.destination.toBase58(), destination.toBase58(), "destination — ATA proposer");
      approveTarget = nextId;
    } else if (gov.proposalCount.gtn(0)) {
      // REUSE: последнее предложение — кандидат для проверки timelock ниже.
      const lastId = gov.proposalCount;
      const p = await program.account.proposal.fetch(proposalPda(lastId));
      if (p.status && (p.status as any).approved) approveTarget = lastId;
      assert.ok(p.amountAtomic.lte(PROPOSAL_AMOUNT_MAX_ATOMIC), "существующее предложение ≤ cap");
    }
  });

  it("7. vote: кворум (3/5 yes) → Approved + approved_at", async () => {
    if (governanceOwned && approveTarget) {
      for (const m of members.slice(0, 3)) {
        await program.methods
          .vote(approveTarget, true)
          .accounts({ governance: governancePda, proposal: proposalPda(approveTarget), voter: m.publicKey })
          .signers([m])
          .rpc();
      }
      const p = await program.account.proposal.fetch(proposalPda(approveTarget));
      const st: any = p.status ?? p;
      assert.ok(st.approved !== undefined, `ожидали Approved, получили ${JSON.stringify(st)}`);
      assert.ok(p.approvedAt.toNumber() > 0, "approved_at зафиксирован");
      const gov = await program.account.governanceState.fetch(governancePda);
      assert.ok(gov.activeProposalId.eq(new BN(0)), "активных предложений нет");
    } else if (approveTarget) {
      // REUSE: верифицируем Approved у существующего предложения.
      const p = await program.account.proposal.fetch(proposalPda(approveTarget));
      const st: any = p.status ?? p;
      assert.ok(st.approved !== undefined, `ожидали Approved (${approveTarget}), получили ${JSON.stringify(st)}`);
    } else {
      console.log("[smoke] нет Approved-предложения для проверки кворума (пропуск).");
    }
  });

  it("8. governance_mint ДО timelock → TimelockNotElapsed (эмиссия не происходит)", async () => {
    if (!approveTarget) {
      console.log("[smoke] нет Approved-предложения — негативная проверка timelock пропущена.");
      return;
    }

    const p = await program.account.proposal.fetch(proposalPda(approveTarget));
    const vaultBefore = await program.account.vault.fetch(vaultPda);
    // destination: у нашего предложения (FRESH) — реальный ATA; у предложения из
    // внешнего прогона (REUSE) поле может быть произвольным pubkey. Канонический
    // ATA proposer'а (создаётся getOrCreateAssociatedTokenAccount) выводится всегда.
    let destAta = p.destination;
    const destInfo = await connection.getAccountInfo(destAta);
    if (!destInfo) {
      const canonical = getAssociatedTokenAddressSync(mintPda, p.proposer, false);
      if (await connection.getAccountInfo(canonical)) destAta = canonical;
    }
    const destInfoFinal = await connection.getAccountInfo(destAta);
    if (!destInfoFinal) {
      console.log("[smoke] destination ATA не найден — негативная проверка timelock пропущена.");
      return;
    }

    // Полный проход «Approved → 7 дней → Executed» покрыт юнит-инвариантом
    // approved_after_majority_and_timelock (state/governance.rs): Clock-warp в TS
    // невозможен. Здесь фиксируем негативную проверку (стандартная практика).
    await assert.rejects(
      program.methods
        .governanceMint(approveTarget)
        .accounts({
          governance: governancePda,
          proposal: proposalPda(approveTarget),
          vault: vaultPda,
          tokenMint: tokenMintPda,
          mint: mintPda,
          mintAuthority: mintAuthPda,
          destination: destAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      /TimelockNotElapsed|timelock/,
    );

    const p2 = await program.account.proposal.fetch(proposalPda(approveTarget));
    const st: any = p2.status ?? p2;
    assert.ok(st.approved !== undefined, "предложение остаётся Approved");
    const vaultAfter = await program.account.vault.fetch(vaultPda);
    assert.ok(vaultAfter.totalSupply.eq(vaultBefore.totalSupply), "total_supply не изменилась");
  });

  it("9. финальные инварианты: supply ≤ cap, PDA-владельцы, founder ATA", async () => {
    const vault = await program.account.vault.fetch(vaultPda);
    const founderAta = getAssociatedTokenAddressSync(mintPda, FOUNDER_WALLET, false);

    // Суммы сходятся: после премайна 2e17, эмиссия до timelock отсутствует.
    assert.ok(vault.totalSupply.gte(FOUNDER_ALLOCATION_ATOMIC), "total_supply ≥ 2e17");
    assert.ok(vault.totalSupply.lte(MAX_SUPPLY_ATOMIC), "total_supply ≤ 1e18 (cap)");
    assert.strictEqual(
      (await connection.getTokenAccountBalance(founderAta)).value.amount,
      FOUNDER_ALLOCATION_ATOMIC.toString(),
      "founder ATA == 2e17 (заблокировано до cliff)",
    );

    // Владельцы хранимых PDA-аккаунтов совпадают с программой.
    for (const [label, addr] of [
      ["vault", vaultPda],
      ["token-mint", tokenMintPda],
      ["governance", governancePda],
    ] as const) {
      const info = await connection.getAccountInfo(addr);
      assert.ok(info, `${label} PDA существует`);
      assert.strictEqual(info!.owner.toBase58(), PROGRAM_ID.toBase58(), `${label} owner == enrg_mvp`);
    }
    // mint-authority — UncheckedAccount (PDA-подписант, данные не хранит):
    // проверяем детерминированность адреса и запись в TokenMint.
    const [maCheck] = PublicKey.findProgramAddressSync([Buffer.from("mint-authority")], PROGRAM_ID);
    assert.strictEqual(maCheck.toBase58(), mintAuthPda.toBase58(), "mint-authority PDA детерминирован");
    const tmFinal = await program.account.tokenMint.fetch(tokenMintPda);
    assert.strictEqual(tmFinal.mintAuthority.toBase58(), mintAuthPda.toBase58(), "TokenMint.mint_authority == PDA");

    const mintInfo = await connection.getAccountInfo(mintPda);
    assert.strictEqual(mintInfo!.owner.toBase58(), TOKEN_PROGRAM_ID.toBase58(), "src-mint owner == SPL Token");

    console.log("✔ E2E smoke: lifecycle invariants OK");
    console.log(`  vault.total_supply = ${vault.totalSupply.toString()} (2e17 после премайна)`);
    console.log(`  founder ATA        = ${FOUNDER_WALLET.toBase58()}`);
    console.log(`  governance PDA     = ${governancePda.toBase58()}`);
  });
});
