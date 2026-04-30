import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { EnrgMvp } from "../target/types/enrg_mvp";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  setAuthority,
  AuthorityType,
} from "@solana/spl-token";
import { expect } from "chai";

describe("ENRG MVP with minting", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.EnrgMvp as Program<EnrgMvp>;

  let authority: anchor.web3.Keypair;
  let mint: anchor.web3.PublicKey;
  let producerPda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let destinationAta: anchor.web3.PublicKey;

  before(async () => {
    authority = anchor.web3.Keypair.generate();

    // Airdrop 10 SOL
    const sig = await provider.connection.requestAirdrop(
      authority.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    // Создаём Mint токена ENRG (пока authority = authority)
    mint = await createMint(
      provider.connection,
      authority,
      authority.publicKey, // временный authority, позже передадим Vault
      null,
      0 // 1 ENRG = 1 кВт·ч, без знаков после запятой
    );

    // Вычисляем PDA
    [producerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("producer"), authority.publicKey.toBuffer()],
      program.programId
    );
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), mint.toBuffer()],
      program.programId
    );

    // Вычисляем адрес ATA получателя
    destinationAta = getAssociatedTokenAddressSync(
      mint,
      authority.publicKey
    );
  });

  it("Initialize Vault, create producer and mint tokens", async () => {
    // 1. Инициализация Vault (привязывает Mint к программе)
    await program.methods
      .initializeVault()
      .accounts({
        vault: vaultPda,
        authority: authority.publicKey,
        mint: mint,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // 2. Передаём право минтинга от authority к Vault PDA
    await setAuthority(
      provider.connection,
      authority,            // текущий authority (подписант)
      mint,                 // mint токена
      authority.publicKey,  // текущий authority
      AuthorityType.MintTokens,
      vaultPda              // новый authority
    );

    // 3. Регистрация производителя
    await program.methods
      .createProducer()
      .accounts({
        producer: producerPda,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // 4. Добавление энергии (150 кВт·ч) – вызовет минтинг
    await program.methods
      .addEnergy(new anchor.BN(150))
      .accounts({
        producer: producerPda,
        authority: authority.publicKey,
        vault: vaultPda,
        mint: mint,
        destination: destinationAta,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Проверяем баланс токенов у authority
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority,
      mint,
      authority.publicKey
    );
    expect(Number(tokenAccount.amount)).to.equal(150);
    console.log("✅ Token balance:", Number(tokenAccount.amount), "ENRG");
  });
});