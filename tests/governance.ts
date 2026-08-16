/**
 * ENRG — Governance MVP (ADR-0009) runtime baseline (localnet).
 *
 * Образец: tests/founder-vesting.ts. Provider+Program построены на authority-ключе
 * (getProgram() использует loadAuthority и не сможет подписать governance-транзакции).
 *
 * Покрывает рантайм: initialize_governance, update_members, create_proposal,
 * vote (majority/minority/collision), governance_mint (TimelockNotElapsed).
 *
 * ОГРАНИЧЕНИЕ РАНТАЙМ-ТЕСТА governance_mint после timelock:
 *   approved_at фиксируется on-chain Clock (warp невозможен). Полный проход
 *   «Approved → 7 дней → Executed» покрыт юнит-инвариантом
 *   `approved_after_majority_and_timelock` (state/governance.rs). В TS проверяем,
 *   что немедленный вызов падает с TimelockNotElapsed (стандартная практика).
 */
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { BN, AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Connection,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PROGRAM_ID, LOCAL_ENDPOINT } from "./helpers/program";
import { ensureFunded, loadAuthority } from "./helpers/accounts";
import { patchIdl } from "./helpers/patch-idl";
import rawIdl from "../target/idl/enrg_mvp.json";
import * as assert from "assert";

const TIMELOCK_SEC = 7 * 24 * 60 * 60; // 604_800
const AMOUNT_CAP = new BN("1000000000000000"); // PROPOSAL_AMOUNT_MAX_ATOMIC = 1e15
const MAX_SUPPLY_ATOMIC = new BN("1000000000000000000"); // 1e18

const [governancePda] = PublicKey.findProgramAddressSync([Buffer.from("governance")], PROGRAM_ID);
const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);
const [tokenMintPda] = PublicKey.findProgramAddressSync([Buffer.from("token-mint")], PROGRAM_ID);
const [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("src-mint")], PROGRAM_ID);
const [mintAuthPda] = PublicKey.findProgramAddressSync([Buffer.from("mint-authority")], PROGRAM_ID);
const [buybackPda] = PublicKey.findProgramAddressSync([Buffer.from("fund-buyback")], PROGRAM_ID);

function proposalPda(id: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), id.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  )[0];
}

describe("ENRG — Governance MVP (ADR-0009) runtime", () => {
  let provider: AnchorProvider;
  let program: any;
  let connection: Connection;
  let authority: Keypair;
  let members: Keypair[];

  before(async () => {
    // H-2: инициализация протокола разрешена только EXPECTED_DEPLOYER
    // (адрес основателя) — bootstrap-инструкции подписываем founder-ключом.
    authority = loadAuthority(
      process.env.FOUNDER_KEYPAIR_PATH ||
        path.join(os.homedir(), ".config/solana/founder-wallet.json")
    );
    members = Array.from({ length: 5 }, () => Keypair.generate());

    connection = new Connection(LOCAL_ENDPOINT, "confirmed");
    provider = new AnchorProvider(connection, new anchor.Wallet(authority), {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    anchor.setProvider(provider);
    program = new Program(patchIdl(rawIdl), provider);

    await ensureFunded(connection, authority.publicKey);
    for (const m of members) await ensureFunded(connection, m.publicKey);

    // ── Bootstrap token/vault (идемпотентно: founder-vesting.ts может создать их ранее) ──
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
  });

  it("initialize_governance: PDA создан, authority и members зафиксированы", async () => {
    const memberKeys = members.map((m) => m.publicKey);
    await program.methods
      .initializeGovernance(memberKeys)
      .accounts({
        governance: governancePda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const gov = await program.account.governanceState.fetch(governancePda);
    assert.strictEqual(gov.authority.toBase58(), authority.publicKey.toBase58());
    assert.strictEqual(gov.members.length, 5);
    assert.strictEqual(gov.proposalCount.toNumber(), 0);
    assert.strictEqual(gov.activeProposalId.toNumber(), 0);
  });

  it("update_members: добавление/удаление, границы 3..=5", async () => {
    const newMembers = Array.from({ length: 5 }, () => Keypair.generate().publicKey);
    await program.methods
      .updateMembers(newMembers)
      .accounts({ governance: governancePda, authority: authority.publicKey })
      .rpc();
    let gov = await program.account.governanceState.fetch(governancePda);
    assert.strictEqual(gov.members.length, 5);
    assert.strictEqual(gov.members[0].toBase58(), newMembers[0].toBase58());

    // Границы: 2 → InvalidMemberList, 6 → InvalidMemberList.
    const two = newMembers.slice(0, 2);
    await assert.rejects(
      program.methods
        .updateMembers(two)
        .accounts({ governance: governancePda, authority: authority.publicKey })
        .rpc(),
      /InvalidMemberList|member list/,
    );
    const six = [...newMembers, Keypair.generate().publicKey];
    await assert.rejects(
      program.methods
        .updateMembers(six)
        .accounts({ governance: governancePda, authority: authority.publicKey })
        .rpc(),
      /InvalidMemberList|member list/,
    );

    // Возвращаем исходный список (оригинальные 5 членов с ключами) для голосования.
    await program.methods
      .updateMembers(members.map((m) => m.publicKey))
      .accounts({ governance: governancePda, authority: authority.publicKey })
      .rpc();
    gov = await program.account.governanceState.fetch(governancePda);
    assert.strictEqual(gov.members.length, 5);
  });

  it("create_proposal: создание, amount, лимит", async () => {
    const dest = Keypair.generate().publicKey;
    await program.methods
      .createProposal(new BN(1), "proposal-1", new BN(1_000_000_000_000), dest)
      .accounts({
        governance: governancePda,
        prevProposal: null,
        proposal: proposalPda(new BN(1)),
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const p = await program.account.proposal.fetch(proposalPda(new BN(1)));
    assert.strictEqual(p.id.toNumber(), 1);
    assert.strictEqual(p.proposer.toBase58(), authority.publicKey.toBase58());
    assert.ok(p.amountAtomic.eq(new BN(1_000_000_000_000)));
    assert.ok(p.pending !== undefined || p.status?.pending !== undefined, "status Pending");

    // Лимит: amount > cap → AmountCapExceeded.
    await assert.rejects(
      program.methods
        .createProposal(new BN(2), "over-cap", AMOUNT_CAP.addn(1), dest)
        .accounts({
          governance: governancePda,
          prevProposal: null,
          proposal: proposalPda(new BN(2)),
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
      /AmountCapExceeded|amount exceeds/,
    );
  });


  it("vote: majority (3/5 yes) → Approved", async () => {
    // После update_members список = 5 членов (текущие members).
    const memberKeys = (await program.account.governanceState.fetch(governancePda)).members;

    // Голосуем «за» тремя членами.
    for (const m of members.slice(0, 3)) {
      await program.methods
        .vote(new BN(1), true)
        .accounts({ governance: governancePda, proposal: proposalPda(new BN(1)), voter: m.publicKey })
        .signers([m])
        .rpc();
    }
    const p = await program.account.proposal.fetch(proposalPda(new BN(1)));
    const st: any = p.status ?? p;
    assert.ok(st.approved !== undefined, `ожидали Approved, получили ${JSON.stringify(st)}`);
    assert.strictEqual(p.yesVotes, 3);
    assert.ok(p.approvedAt.toNumber() > 0, "approved_at зафиксирован");
    // Активного предложения больше нет.
    const gov = await program.account.governanceState.fetch(governancePda);
    assert.strictEqual(gov.activeProposalId.toNumber(), 0);
  });

  it("vote: не-member и повторный голос отклоняются", async () => {
    const outsider = Keypair.generate();
    await ensureFunded(connection, outsider.publicKey);

    const dest = Keypair.generate().publicKey;
    // После majority (proposal #1) proposal_count=1 → следующий id=2.
    await program.methods
      .createProposal(new BN(2), "proposal-2", new BN(1000), dest)
      .accounts({
        governance: governancePda,
        prevProposal: null,
        proposal: proposalPda(new BN(2)),
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await assert.rejects(
      program.methods
        .vote(new BN(2), true)
        .accounts({ governance: governancePda, proposal: proposalPda(new BN(2)), voter: outsider.publicKey })
        .signers([outsider])
        .rpc(),
      /NotGovernanceMember|not a governance member/,
    );

    // Повторный голос тем же member → MemberAlreadyVoted.
    await program.methods
      .vote(new BN(2), true)
      .accounts({ governance: governancePda, proposal: proposalPda(new BN(2)), voter: members[0].publicKey })
      .signers([members[0]])
      .rpc();
    await assert.rejects(
      program.methods
        .vote(new BN(2), true)
        .accounts({ governance: governancePda, proposal: proposalPda(new BN(2)), voter: members[0].publicKey })
        .signers([members[0]])
        .rpc(),
      /MemberAlreadyVoted|already voted/,
    );
  });


  it("vote: minority (все проголосовали без кворума) → Rejected", async () => {
    // Активное — proposal #2 (после не-member теста active=2).
    const gov0 = await program.account.governanceState.fetch(governancePda);
    assert.strictEqual(gov0.activeProposalId.toNumber(), 2);

    // 1 «за» (уже от members[0]), 4 «против» → yes(1) > no(4)? нет → Rejected.
    for (const m of members.slice(1, 5)) {
      await program.methods
        .vote(new BN(2), false)
        .accounts({ governance: governancePda, proposal: proposalPda(new BN(2)), voter: m.publicKey })
        .signers([m])
        .rpc();
    }
    const p = await program.account.proposal.fetch(proposalPda(new BN(2)));
    const st: any = p.status ?? p;
    assert.ok(st.rejected !== undefined, `ожидали Rejected, получили ${JSON.stringify(st)}`);
    const gov = await program.account.governanceState.fetch(governancePda);
    assert.strictEqual(gov.activeProposalId.toNumber(), 0);
  });

  it("collision: второе предложение при активном требует prev (auto-cancel)", async () => {
    // После minority proposal_count=2 → следующий id=3.
    const dest = Keypair.generate().publicKey;
    await program.methods
      .createProposal(new BN(3), "proposal-3", new BN(1000), dest)
      .accounts({
        governance: governancePda,
        prevProposal: null,
        proposal: proposalPda(new BN(3)),
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Без prev → коллизия (ProposalNotActive).
    await assert.rejects(
      program.methods
        .createProposal(new BN(4), "proposal-4", new BN(1000), dest)
        .accounts({
          governance: governancePda,
          prevProposal: null,
          proposal: proposalPda(new BN(4)),
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
      /ProposalNotActive|collision/,
    );

    // С prev → старое #3 Cancelled, новое #4 активно.
    await program.methods
      .createProposal(new BN(4), "proposal-4", new BN(1000), dest)
      .accounts({
        governance: governancePda,
        prevProposal: proposalPda(new BN(3)),
        proposal: proposalPda(new BN(4)),
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const p3 = await program.account.proposal.fetch(proposalPda(new BN(3)));
    const st3: any = p3.status ?? p3;
    assert.ok(st3.cancelled !== undefined, `ожидали Cancelled, получили ${JSON.stringify(st3)}`);
    const gov = await program.account.governanceState.fetch(governancePda);
    assert.strictEqual(gov.activeProposalId.toNumber(), 4);
  });

  it("governance_mint: немедленно после одобрения → TimelockNotElapsed", async () => {
    // Одобряем #4 (majority: 3 yes из 5).
    for (const m of members.slice(0, 3)) {
      await program.methods
        .vote(new BN(4), true)
        .accounts({ governance: governancePda, proposal: proposalPda(new BN(4)), voter: m.publicKey })
        .signers([m])
        .rpc();
    }
    const p4 = await program.account.proposal.fetch(proposalPda(new BN(4)));
    const st4: any = p4.status ?? p4;
    assert.ok(st4.approved !== undefined, "ожидали Approved");

    const destAta = await getOrCreateAssociatedTokenAccount(
      connection,
      authority,
      mintPda,
      authority.publicKey,
    );
    await assert.rejects(
      program.methods
        .governanceMint(new BN(4))
        .accounts({
          governance: governancePda,
          proposal: proposalPda(new BN(4)),
          vault: vaultPda,
          tokenMint: tokenMintPda,
          mint: mintPda,
          mintAuthority: mintAuthPda,
          destination: destAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      /TimelockNotElapsed|timelock/,
    );
  });

  // ── SNAPSHOT (документация, НЕ рантайм-тест) ──
  // Полный проход «Approved → 7 дней (TIMELOCK_DELAY) → governance_mint Executed»
  // покрыт юнит-инвариантом approved_after_majority_and_timelock (state/governance.rs):
  // `approved_at` фиксируется on-chain Clock, warp невозможен. На мейннете
  // governance_mint сработает по приходу Clock после timelock (стандартная практика).
  it.skip("governance_mint: полный проход после timelock (юнит-покрытие)", () => {});
});

