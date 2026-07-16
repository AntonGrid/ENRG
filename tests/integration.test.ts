import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { EnrgMvp } from "../target/types/enrg_mvp";
import nacl from "tweetnacl";

// Собирает message так же, как OracleReport::message_to_sign() в Rust:
// device_id.to_bytes() + nonce(le, u64) + device_timestamp(le, i64) + energy_wh(le, u64)
function buildOracleMessage(params: {
  deviceId: PublicKey;
  nonce: BN;
  deviceTimestamp: BN;
  energyWh: BN;
}): Buffer {
  const { deviceId, nonce, deviceTimestamp, energyWh } = params;

  const deviceBytes = deviceId.toBytes(); // 32 байта

  // BN -> 8 байт LE (как to_le_bytes() в Rust)
  const le64 = (v: BN) => Buffer.from(v.toArray("le", 8));

  const nonceBytes = le64(nonce);
  const tsBytes = le64(deviceTimestamp);
  const energyBytes = le64(energyWh);

  return Buffer.concat([
    Buffer.from(deviceBytes),
    nonceBytes,
    tsBytes,
    energyBytes,
  ]);
}

describe("ENRG Protocol — Core Flow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.EnrgMvp as Program<EnrgMvp>;
  const wallet = provider.wallet as anchor.Wallet;

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );
  const [tokenMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token-mint")],
    program.programId
  );
  const [srcMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("src-mint")],
    program.programId
  );
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    program.programId
  );
  const [oracleRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle-registry")],
    program.programId
  );
  const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );

  const producerKeypair = Keypair.generate();

  // Ed25519-ключ устройства: именно им подписывается сообщение
  const deviceKeypair = nacl.sign.keyPair();
  const deviceId = new PublicKey(deviceKeypair.publicKey);

  const maxPowerW = new BN(1000);
  const oracleKeypair = Keypair.generate();

  before(async () => {
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        producerKeypair.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL
      )
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        oracleKeypair.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL
      )
    );
  });

  it("1. Full Flow: Token -> Vault -> Oracle -> Producer -> Mint", async () => {
    // Token
    let txSig = await program.methods
      .initializeToken()
      .accounts({
        tokenMint: tokenMintPda,
        mint: srcMintPda,
        mintAuthority: mintAuthorityPda,
        authority: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    console.log("Token:", txSig);

    // Vault
    txSig = await program.methods
      .initializeVault()
      .accounts({
        vault: vaultPda,
        authority: wallet.publicKey,
        mint: srcMintPda,
        tokenMint: tokenMintPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Vault:", txSig);

    // Create 4 separate token accounts for protocol funds
    const fundPdas = {
      buyback: PublicKey.findProgramAddressSync(
        [Buffer.from("fund-buyback")],
        program.programId
      )[0],
      staking: PublicKey.findProgramAddressSync(
        [Buffer.from("fund-staking")],
        program.programId
      )[0],
      dao: PublicKey.findProgramAddressSync(
        [Buffer.from("fund-dao")],
        program.programId
      )[0],
      emergency: PublicKey.findProgramAddressSync(
        [Buffer.from("fund-emergency")],
        program.programId
      )[0],
    };

    const fundAtas = {
      buyback: getAssociatedTokenAddressSync(
        srcMintPda,
        fundPdas.buyback,
        true
      ),
      staking: getAssociatedTokenAddressSync(
        srcMintPda,
        fundPdas.staking,
        true
      ),
      dao: getAssociatedTokenAddressSync(srcMintPda, fundPdas.dao, true),
      emergency: getAssociatedTokenAddressSync(
        srcMintPda,
        fundPdas.emergency,
        true
      ),
    };

    console.log("Creating fund ATAs...");
    for (const [name, ata] of Object.entries(fundAtas)) {
      const owner = fundPdas[name as keyof typeof fundPdas];
      try {
        const ix = createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          ata,
          owner,
          srcMintPda
        );
        await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), [
          wallet.payer,
        ]);
        console.log(`  ${name}: ${ata.toBase58()}`);
      } catch (e: any) {
        console.log(`  ${name}: already exists (${ata.toBase58()})`);
      }
    }

    // Initialize Funds (stores ATA addresses in TokenMint PDA)
    txSig = await program.methods
      .initializeFunds()
      .accounts({
        vault: vaultPda,
        tokenMint: tokenMintPda,
        mint: srcMintPda,
        vaultAuthority: vaultAuthorityPda,
        buybackAccount: fundAtas.buyback,
        stakingAccount: fundAtas.staking,
        daoAccount: fundAtas.dao,
        emergencyAccount: fundAtas.emergency,
        authority: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Funds:", txSig);

    // Oracle Registry
    txSig = await program.methods
      .initializeOracleRegistry()
      .accounts({
        registry: oracleRegistryPda,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Oracle Registry:", txSig);

    // Add Oracle
    txSig = await program.methods
      .addOracle(oracleKeypair.publicKey)
      .accounts({ registry: oracleRegistryPda, authority: wallet.publicKey })
      .rpc();
    console.log("Oracle added:", txSig);

    // Producer
    const [producerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("producer"), producerKeypair.publicKey.toBuffer()],
      program.programId
    );
    txSig = await program.methods
      .createProducer(deviceId, maxPowerW)
      .accounts({
        producer: producerPda,
        authority: producerKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([producerKeypair])
      .rpc();
    console.log("Producer:", txSig);

    // Create ATA for producer (user token account)
    const [userAta] = PublicKey.findProgramAddressSync(
      [
        producerKeypair.publicKey.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        srcMintPda.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    try {
      const ix = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        userAta,
        producerKeypair.publicKey,
        srcMintPda
      );
      await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), [
        wallet.payer,
      ]);
      console.log(`User ATA: ${userAta.toBase58()}`);
    } catch (e: any) {
      console.log(`User ATA exists: ${userAta.toBase58()}`);
    }

    // Mint Energy — get current blockchain time via blockhash
    const slot = await provider.connection.getSlot("finalized");
    const blockTime = await provider.connection.getBlockTime(slot);
    const now = new BN(blockTime ?? Math.floor(Date.now() / 1000));
    console.log(
      "DEBUG verified_at:",
      now.toString(),
      "blockTime:",
      blockTime,
      "Date.now():",
      Math.floor(Date.now() / 1000)
    );

    // Take realistic energy: 10 kWh = 10_000_000 Wh (well below 36_000_000 Wh max)
    const energyWh = new BN(10_000_000);
    const nonce = new BN(1);

    // Собираем message так же, как OracleReport::message_to_sign() в Rust
    const message = buildOracleMessage({
      deviceId,
      nonce,
      deviceTimestamp: now,
      energyWh,
    });

    // Подписываем Ed25519-ключом устройства (реальная подпись, как в проде)
    const signature = nacl.sign.detached(message, deviceKeypair.secretKey);

    // ВАЖНО: на ончейне подпись пока не проверяется, но формат и данные уже зафиксированы.
    const sigArray = Array.from(signature);

    const mintSig = await program.methods
      .mintEnergy({
        report: {
          oracle: oracleKeypair.publicKey,
          deviceId: deviceId,
          nonce,
          deviceTimestamp: now,
          verifiedAt: now,
          energyWh,
          deviceSignature: sigArray,
        },
      })
      .accounts({
        producer: producerPda,
        vault: vaultPda,
        tokenMint: tokenMintPda,
        mint: srcMintPda,
        mintAuthority: mintAuthorityPda,
        userTokenAccount: userAta,
        buybackAccount: fundAtas.buyback,
        stakingAccount: fundAtas.staking,
        daoAccount: fundAtas.dao,
        emergencyAccount: fundAtas.emergency,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Energy Minted:", mintSig);
  });
});
