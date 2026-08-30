/**
 * ENRG — Founder premine & vesting baseline (runtime, localnet).
 *
 * Рантайм-проверка (по образцу device-lifecycle.ts + helpers/program.ts):
 *   - initialize_token: SRC mint + token_mint/vault создаются;
 *   - allocate_founder:  премайн 2e17 на ATA основателя, supply cap, одноразовость.
 *
 * Факты из кода (источник истины):
 *   - FOUNDER_WALLET = FnqKH4bjMRM6hzrw6tjcpfyszovbRsvyNjuNwALmcZNC; тест загружает
 *     founder-ключ из ~/.config/solana/founder-wallet.json (pubkey == FOUNDER_WALLET).
 *   - initialize_vault вызывается в before() как setup (allocate_founder требует vault),
 *     вне it-тестов скопа.
 *   - vault = PDA [b"vault"], token_mint = [b"token-mint"], src_mint = [b"src-mint"],
 *     mint_authority = [b"mint-authority"] (из instructions/*.rs).
 *
 * ОГРАНИЧЕНИЕ РАНТАЙМ-ТЕСТА initialize_founder_vesting:
 *   В коде FounderVesting-аккаунт НЕ имеет PDA-seed (state/vesting.rs — без
 *   `#[account(seeds=..)]`) и initialize_founder_vesting объявляет его как
 *   `Account` БЕЗ `init` — аккаунт обязан существовать заранее (генезис-аккаунт,
 *   как в прод-модели). anchor 0.32 `AccountClient.createInstruction` создаёт
 *   аккаунт с НУЛЕВЫМ дискриминатором (проверено), а системной инструкции
 *   записи произвольных данных в аккаунт из клиента не существует. Поэтому
 *   автономный рантайм-вызов initialize_founder_vesting невозможен без
 *   генезис-аккаунта (solana-test-validator --account) — см. it.skip ниже.
 *   Логика вестинга (cliff/release/vested_at) покрыта юнит-тестом в state/vesting.rs.
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
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PROGRAM_ID, LOCAL_ENDPOINT } from "./helpers/program";
import { loadAuthority, ensureFunded } from "./helpers/accounts";
import { patchIdl } from "./helpers/patch-idl";
import rawIdl from "../target/idl/enrg_mvp.json";
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const FOUNDER_ALLOCATION = new BN("200000000000000000"); // 2e17 atomic
const MAX_SUPPLY_ATOMIC = new BN("1000000000000000000"); // 1e18

describe("ENRG — Founder premine & vesting baseline (runtime)", () => {
  let provider: AnchorProvider;
  let program: any;
  let connection: Connection;
  let founder: Keypair;

  // PDA-адреса (seeds из фактического кода instructions/*.rs).
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);
  const [tokenMintPda] = PublicKey.findProgramAddressSync([Buffer.from("token-mint")], PROGRAM_ID);
  const [mintPda] = PublicKey.findProgramAddressSync([Buffer.from("src-mint")], PROGRAM_ID);
  const [mintAuthPda] = PublicKey.findProgramAddressSync([Buffer.from("mint-authority")], PROGRAM_ID);
  const [buybackPda] = PublicKey.findProgramAddressSync([Buffer.from("fund-buyback")], PROGRAM_ID);

  before(async () => {
    const founderKeyPath =
      process.env.FOUNDER_KEYPAIR_PATH ||
      path.join(os.homedir(), ".config/solana/founder-wallet.json");
    if (!fs.existsSync(founderKeyPath)) {
      throw new Error(
        `founder keypair не найден: ${founderKeyPath}. Без приватного ключа ` +
          `FOUNDER_WALLET (6gM2eEAL...) allocate_founder/initialize_founder_vesting невозможны.`,
      );
    }
    const founderSecret = JSON.parse(fs.readFileSync(founderKeyPath, "utf8")) as number[];
    founder = Keypair.fromSecretKey(Uint8Array.from(founderSecret));
    assert.strictEqual(
      founder.publicKey.toBase58(),
      "FnqKH4bjMRM6hzrw6tjcpfyszovbRsvyNjuNwALmcZNC",
      "founder keypair должен совпадать с FOUNDER_WALLET",
    );

    // Provider строим на founder-ключе (getProgram() использует loadAuthority —
    // им невозможно подписать allocate_founder/initialize_founder_vesting).
    connection = new Connection(LOCAL_ENDPOINT, "confirmed");
    provider = new AnchorProvider(connection, new anchor.Wallet(founder), {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    anchor.setProvider(provider);
    program = new Program(patchIdl(rawIdl), provider);
    await ensureFunded(connection, founder.publicKey);

    // ── Bootstrap (setup вне it-тестов скопа) ──
    // initialize_token: SRC mint + token_mint + mint_authority PDA.
    await program.methods
      .initializeToken()
      .accounts({
        tokenMint: tokenMintPda,
        mint: mintPda,
        mintAuthority: mintAuthPda,
        buybackAuthority: buybackPda,
        authority: founder.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // initialize_vault: vault PDA (требуется allocate_founder).
    await program.methods
      .initializeVault()
      .accounts({
        vault: vaultPda,
        authority: founder.publicKey,
        mint: mintPda,
        tokenMint: tokenMintPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("initialize_token: SRC mint + vault/token_mint создаются", async () => {
    // SRC Mint: supply == 0, mint authority == mint_authority PDA.
    const mintInfo = await connection.getParsedAccountInfo(mintPda);
    const mintData = (mintInfo.value as any)?.data?.parsed?.info;
    assert.ok(mintData, "mint должен существовать");
    assert.strictEqual(mintData.supply, "0");
    assert.strictEqual(mintData.mintAuthority, mintAuthPda.toBase58());

    // token_mint и vault существуют (fetch не бросает).
    const tm = await program.account.tokenMint.fetch(tokenMintPda);
    assert.strictEqual(tm.mint.toBase58(), mintPda.toBase58());
    const v = await program.account.vault.fetch(vaultPda);
    assert.ok(v.totalSupply.eq(new BN(0)), "total_supply до премайна == 0");
  });

  it("allocate_founder: премайн 2e17 на ATA основателя + supply cap", async () => {
    const founderAta = await getOrCreateAssociatedTokenAccount(
      connection,
      founder,
      mintPda,
      founder.publicKey,
    );
    await program.methods
      .allocateFounder()
      .accounts({
        vault: vaultPda,
        tokenMint: tokenMintPda,
        mint: mintPda,
        mintAuthority: mintAuthPda,
        founderTokenAccount: founderAta.address,
        payer: founder.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // ATA основателя == 2e17.
    const bal = await connection.getTokenAccountBalance(founderAta.address);
    assert.strictEqual(bal.value.amount, FOUNDER_ALLOCATION.toString());

    // vault.total_supply == 2e17.
    const vault = await program.account.vault.fetch(vaultPda);
    assert.ok(vault.totalSupply.eq(FOUNDER_ALLOCATION), `total_supply=${vault.totalSupply}`);

    // одноразовый флаг выставлен.
    const tm = await program.account.tokenMint.fetch(tokenMintPda);
    assert.strictEqual(tm.founderMinted, 1);
  });

  it("allocate_founder: одноразовость (повторный вызов → FounderPremineAlreadyMinted)", async () => {
    const founderAta = await getOrCreateAssociatedTokenAccount(
      connection,
      founder,
      mintPda,
      founder.publicKey,
    );
    await assert.rejects(
      program.methods
        .allocateFounder()
        .accounts({
          vault: vaultPda,
          tokenMint: tokenMintPda,
          mint: mintPda,
          mintAuthority: mintAuthPda,
          founderTokenAccount: founderAta.address,
          payer: founder.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
      (err: any) => {
        const msg = `${err?.message ?? ""}\n${(err?.logs ?? []).join("\n")}`;
        return (
          msg.includes("FounderPremineAlreadyMinted") ||
          msg.includes("Founder premine already minted")
        );
      }
    );
  });

  it("allocate_founder: total_supply не превышает MAX_SUPPLY_ATOMIC", async () => {
    const vault = await program.account.vault.fetch(vaultPda);
    // total_supply (после премайна) + 2e17 <= 1e18.
    assert.ok(
      vault.totalSupply.add(FOUNDER_ALLOCATION).lte(MAX_SUPPLY_ATOMIC),
      `total=${vault.totalSupply} + alloc > MAX`,
    );
  });

  // initialize_founder_vesting: FounderVesting-аккаунт создаётся генезисом
  // (без init/seed) — адрес = findProgramAddress([b"founder-vesting"]), файл
  // tests/genesis/founder-vesting.json подкладывается валидатору через
  // Anchor.toml [test.validator] (см. docs/STATE.md, раздел 4).
  it("initialize_founder_vesting: поля cliff/release (генезис-аккаунт)", async () => {
    const [vestingPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("founder-vesting")],
      PROGRAM_ID,
    );
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
    assert.strictEqual(v.founder.toBase58(), founder.publicKey.toBase58(), "founder");
    assert.ok(v.totalAmount.eq(FOUNDER_ALLOCATION), "total_amount == 2e17");
    assert.strictEqual(v.cliff.toNumber(), 365 * 24 * 60 * 60, "cliff == 1 год");
    assert.strictEqual(v.release.toNumber(), 3 * 365 * 24 * 60 * 60, "release == 3 года");
    assert.ok(v.startTime.toNumber() > 0, "start_time зафиксирован");
  });
});

