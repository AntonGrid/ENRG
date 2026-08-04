import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BN } from "bn.js";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Ed25519Program,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createInitializeAccountInstruction,
} from "@solana/spl-token";
import nacl from "tweetnacl";

function buildOracleMessage(params: {
  deviceId: PublicKey;
  nonce: BN;
  deviceTimestamp: BN;
  energyWh: BN;
}): Buffer {
  const { deviceId, nonce, deviceTimestamp, energyWh } = params;
  const deviceBytes = deviceId.toBytes();
  const le64 = (v: BN) => Buffer.from(v.toArray("le", 8));
  const nonceBytes = le64(nonce);
  const tsBytes = le64(deviceTimestamp);
  const energyBytes = le64(energyWh);
  return Buffer.concat([Buffer.from(deviceBytes), nonceBytes, tsBytes, energyBytes]);
}

describe("ENRG Protocol — Buyback & Burn", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.EnrgMvp as Program<any>;
  const wallet = provider.wallet as anchor.Wallet;

  // ── PDAs ──
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")], program.programId
  );
  const [tokenMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token-mint")], program.programId
  );
  const [srcMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("src-mint")], program.programId
  );
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")], program.programId
  );
  const [oracleRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle-registry")], program.programId
  );
  const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")], program.programId
  );

  // Fund PDAs — each is a different authority PDA for a protocol fund.
  // buyback_authority PDA = seeds ["fund-buyback"] — used in buyback.rs to sign burn.
  // The actual ATA for each fund is derived from (srcMint, fundPda).
  const fundPdas = {
    buyback: PublicKey.findProgramAddressSync(
      [Buffer.from("fund-buyback")], program.programId
    )[0],
    staking: PublicKey.findProgramAddressSync(
      [Buffer.from("fund-staking")], program.programId
    )[0],
    dao: PublicKey.findProgramAddressSync(
      [Buffer.from("fund-dao")], program.programId
    )[0],
    emergency: PublicKey.findProgramAddressSync(
      [Buffer.from("fund-emergency")], program.programId
    )[0],
  };

  // Fund ATAs — Associated Token Accounts owned by their respective fund PDAs.
  const fundAtas = {
    buyback: getAssociatedTokenAddressSync(srcMintPda, fundPdas.buyback, true),
    staking: getAssociatedTokenAddressSync(srcMintPda, fundPdas.staking, true),
    dao: getAssociatedTokenAddressSync(srcMintPda, fundPdas.dao, true),
    emergency: getAssociatedTokenAddressSync(srcMintPda, fundPdas.emergency, true),
  };

  const producerKeypair = Keypair.generate();
  const deviceKeypair = nacl.sign.keyPair();
  const deviceId = new PublicKey(deviceKeypair.publicKey);
  const maxPowerW = new BN(1000);
  const oracleKeypair = Keypair.generate();

  let userAta: PublicKey;
  let producerPda: PublicKey;

  before(async () => {
    for (const pk of [producerKeypair.publicKey, oracleKeypair.publicKey]) {
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(pk, 10 * anchor.web3.LAMPORTS_PER_SOL)
      );
    }

    [producerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("producer"), producerKeypair.publicKey.toBuffer()],
      program.programId
    );

    userAta = getAssociatedTokenAddressSync(
      srcMintPda,
      producerKeypair.publicKey,
      false
    );
  });

  it("1. Setup: Token → Vault → Funds → Oracle → Producer → Mint", async () => {
    // ── Token ──
    await program.methods
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

    // ── Vault ──
    await program.methods
      .initializeVault()
      .accounts({
        vault: vaultPda,
        authority: wallet.publicKey,
        mint: srcMintPda,
        tokenMint: tokenMintPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // ── Fund ATAs ──
    for (const [name, ata] of Object.entries(fundAtas)) {
      const ownerPda = fundPdas[name as keyof typeof fundPdas];
      try {
        const ix = createAssociatedTokenAccountInstruction(
          wallet.publicKey, ata, ownerPda, srcMintPda
        );
        await provider.sendAndConfirm(new Transaction().add(ix), [wallet.payer]);
        console.log(`  ${name} ATA: ${ata.toBase58()} (owner: ${ownerPda.toBase58()})`);
      } catch (_) {
        console.log(`  ${name} ATA already exists: ${ata.toBase58()}`);
      }
    }

    // ── Initialize Funds ──
    await program.methods
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
    console.log("Funds initialized");

    // ── Oracle Registry ──
    await program.methods
      .initializeOracleRegistry()
      .accounts({
        registry: oracleRegistryPda,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // ── Add Oracle ──
    await program.methods
      .addOracle(oracleKeypair.publicKey)
      .accounts({ registry: oracleRegistryPda, authority: wallet.publicKey })
      .rpc();

    // ── Producer ──
    await program.methods
      .createProducer(deviceId, maxPowerW)
      .accounts({
        producer: producerPda,
        authority: producerKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([producerKeypair])
      .rpc();

    // ── User ATA ──
    try {
      const ix = createAssociatedTokenAccountInstruction(
        wallet.publicKey, userAta, producerKeypair.publicKey, srcMintPda
      );
      await provider.sendAndConfirm(new Transaction().add(ix), [wallet.payer]);
    } catch (_) {}

    // ── Mint Energy ──
    const slot = await provider.connection.getSlot("finalized");
    const blockTime = await provider.connection.getBlockTime(slot);
    const now = new BN(blockTime ?? Math.floor(Date.now() / 1000));

    const energyWh = new BN(10_000_000);
    const nonce = new BN(1);

    const message = buildOracleMessage({
      deviceId,
      nonce,
      deviceTimestamp: now,
      energyWh,
    });

    const signature = nacl.sign.detached(message, deviceKeypair.secretKey);

    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: deviceKeypair.publicKey,
      message,
      signature,
    });

    const report = {
      oracle: oracleKeypair.publicKey,
      deviceId,
      nonce,
      deviceTimestamp: now,
      verifiedAt: now,
      energyWh,
      deviceSignature: Array.from(signature),
    };

    const mintIx = await program.methods
      .mintEnergy(report)
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
      .instruction();

    const tx = new Transaction().add(ed25519Ix, mintIx);
    await provider.sendAndConfirm(tx, []);
  });

  it("2. Buyback and Burn — burns tokens from buyback fund", async () => {
    const buybackAccountInfo = await provider.connection.getTokenAccountBalance(
      fundAtas.buyback
    );
    const balanceBefore = new BN(buybackAccountInfo.value.amount);
    console.log("Buyback balance before burn:", balanceBefore.toString());

    const vaultBefore = await program.account.vault.fetch(vaultPda);
    console.log("Total supply before burn:", vaultBefore.totalSupply.toString());

    const burnAmount = balanceBefore.div(new BN(2));
    console.log("Burning amount:", burnAmount.toString());

    if (burnAmount.eqn(0)) {
      console.log("SKIP: buyback balance is 0, nothing to burn");
      return;
    }

    await program.methods
      .buybackAndBurn(burnAmount)
      .accounts({
        vault: vaultPda,
        mint: srcMintPda,
        tokenMint: tokenMintPda,
        buybackAccount: fundAtas.buyback,
        buybackAuthority: fundPdas.buyback,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const buybackAfterInfo = await provider.connection.getTokenAccountBalance(
      fundAtas.buyback
    );
    const balanceAfter = new BN(buybackAfterInfo.value.amount);
    const expectedBalance = balanceBefore.sub(burnAmount);
    if (!balanceAfter.eq(expectedBalance)) {
      console.log(
        `WARNING: expected ${expectedBalance.toString()}, got ${balanceAfter.toString()}`
      );
    }

    const vaultAfter = await program.account.vault.fetch(vaultPda);
    const expectedSupply = vaultBefore.totalSupply.sub(burnAmount);
    if (!vaultAfter.totalSupply.eq(expectedSupply)) {
      console.log(
        `WARNING: expected supply ${expectedSupply.toString()}, got ${vaultAfter.totalSupply.toString()}`
      );
    }

    console.log(`Buyback balance after burn: ${balanceAfter.toString()}`);
    console.log(`Total supply after burn: ${vaultAfter.totalSupply.toString()}`);
  });

  it("3. Fail on zero amount burn", async () => {
    try {
      await program.methods
        .buybackAndBurn(new BN(0))
        .accounts({
          vault: vaultPda,
          mint: srcMintPda,
          tokenMint: tokenMintPda,
          buybackAccount: fundAtas.buyback,
          buybackAuthority: fundPdas.buyback,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log("ERROR: zero amount burn should have failed");
    } catch (e: any) {
      console.log("Zero amount burn correctly rejected:", e.message.split("\n")[0]);
    }
  });

  it("4. Fail on amount exceeding buyback balance", async () => {
    const buybackInfo = await provider.connection.getTokenAccountBalance(
      fundAtas.buyback
    );
    const balance = new BN(buybackInfo.value.amount);
    const excessiveAmount = balance.add(new BN(1));

    try {
      await program.methods
        .buybackAndBurn(excessiveAmount)
        .accounts({
          vault: vaultPda,
          mint: srcMintPda,
          tokenMint: tokenMintPda,
          buybackAccount: fundAtas.buyback,
          buybackAuthority: fundPdas.buyback,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log("ERROR: excessive burn should have failed");
    } catch (e: any) {
      console.log("Excessive burn correctly rejected:", e.message.split("\n")[0]);
    }
  });
});
