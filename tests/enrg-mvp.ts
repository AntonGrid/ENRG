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
import nacl from "tweetnacl";

describe("ENRG Tokenomics", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const program = anchor.workspace.EnrgMvp as Program<EnrgMvp>;
  let authority: anchor.web3.Keypair;
  let deviceKeypair: anchor.web3.Keypair;
  let mint: anchor.web3.PublicKey;
  let producerPda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let destinationAta: anchor.web3.PublicKey;

  before(async () => {
    authority = anchor.web3.Keypair.generate();
    deviceKeypair = anchor.web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      authority.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    mint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      0
    );
    [producerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("producer"), authority.publicKey.toBuffer()],
      program.programId
    );
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), mint.toBuffer()],
      program.programId
    );
    destinationAta = getAssociatedTokenAddressSync(mint, authority.publicKey);
  });

  it("Mint 150 Wh and verify commission distribution", async () => {
    await program.methods
      .initializeVault()
      .accounts({
        vault: vaultPda,
        authority: authority.publicKey,
        mint,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([authority])
      .rpc();

    await setAuthority(
      provider.connection,
      authority,
      mint,
      authority.publicKey,
      AuthorityType.MintTokens,
      vaultPda,
      [authority]
    );

    await program.methods
      .createProducer(deviceKeypair.publicKey, new anchor.BN(1000))
      .accounts({
        producer: producerPda,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([authority])
      .rpc();

    // Получаем реальный слот и время блока от валидатора
    const slot = await provider.connection.getSlot();
    const blockTime = await provider.connection.getBlockTime(slot);
    if (!blockTime) throw new Error("Could not get block time");
    const timestamp = Math.floor(blockTime);

    const energyWh = 150;
    const nonce = 1;
    const msgBuf = Buffer.alloc(24);
    msgBuf.writeBigUInt64LE(BigInt(nonce), 0);
    msgBuf.writeBigInt64LE(BigInt(timestamp), 8);
    msgBuf.writeBigUInt64LE(BigInt(energyWh), 16);
    const signature = nacl.sign.detached(
      msgBuf,
      deviceKeypair.secretKey
    );

    // PDA фондов
    const [buybackPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("buyback"), mint.toBuffer()],
      program.programId
    );
    const [stakingPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("staking"), mint.toBuffer()],
      program.programId
    );
    const [daoPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("dao"), mint.toBuffer()],
      program.programId
    );
    const [emergencyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("emergency"), mint.toBuffer()],
      program.programId
    );

    await program.methods
      .mintEnergy({
        nonce: new anchor.BN(nonce),
        timestamp: new anchor.BN(timestamp),
        energyWh: new anchor.BN(energyWh),
        signature: Array.from(signature),
      } as any)
      .accounts({
        producer: producerPda,
        authority: authority.publicKey,
        vault: vaultPda,
        mint,
        destination: destinationAta,
        buybackAccount: buybackPda,
        stakingPool: stakingPda,
        daoReserve: daoPda,
        emergencyFund: emergencyPda,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([authority])
      .rpc();

    // Читаем балансы
    const userBal = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority,
        mint,
        authority.publicKey
      )
    ).amount;
    const buybackBal = (
      await provider.connection.getTokenAccountBalance(buybackPda)
    ).value.amount;
    const stakingBal = (
      await provider.connection.getTokenAccountBalance(stakingPda)
    ).value.amount;
    const daoBal = (
      await provider.connection.getTokenAccountBalance(daoPda)
    ).value.amount;
    const emergencyBal = (
      await provider.connection.getTokenAccountBalance(emergencyPda)
    ).value.amount;

    console.log("User balance:", Number(userBal));
    console.log("Buyback balance:", buybackBal);
    console.log("Staking pool balance:", stakingBal);
    console.log("DAO balance:", daoBal);
    console.log("Emergency balance:", emergencyBal);

    const expectedUser = 127;
    const commission = 23;
    const expectedBuyback = 4;
    const expectedStaking = 9;
    const expectedDao = 6;
    const expectedEmergency = 4;

    expect(Number(userBal)).to.equal(expectedUser);
    expect(Number(buybackBal)).to.equal(expectedBuyback);
    expect(Number(stakingBal)).to.equal(expectedStaking);
    expect(Number(daoBal)).to.equal(expectedDao);
    expect(Number(emergencyBal)).to.equal(expectedEmergency);
  });
});
