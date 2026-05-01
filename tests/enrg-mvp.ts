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

describe("ENRG MVP with minting", () => {
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

    destinationAta = getAssociatedTokenAddressSync(
      mint,
      authority.publicKey
    );
  });

  it("Initialize Vault, create producer and mint tokens", async () => {
    await program.methods
      .initializeVault()
      .accounts({
        vault: vaultPda,
        authority: authority.publicKey,
        mint: mint,
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
      vaultPda
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

    const nonce = 1;
    const timestamp = Math.floor(Date.now() / 1000);
    const energyWh = 150;

    const msgBuf = Buffer.alloc(24);
    msgBuf.writeBigUInt64LE(BigInt(nonce), 0);
    msgBuf.writeBigInt64LE(BigInt(timestamp), 8);
    msgBuf.writeBigUInt64LE(BigInt(energyWh), 16);

    // ИСПРАВЛЕНО: убираем .slice(0, 32), передаём полный 64-байтный secretKey
    const signature = nacl.sign.detached(msgBuf, deviceKeypair.secretKey);
    const sigArray = Array.from(signature);

    await program.methods
      .mintEnergy({
        nonce: new anchor.BN(nonce),
        timestamp: new anchor.BN(timestamp),
        energyWh: new anchor.BN(energyWh),
        signature: sigArray,
      } as any)
      .accounts({
        producer: producerPda,
        authority: authority.publicKey,
        vault: vaultPda,
        mint: mint,
        destination: destinationAta,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([authority])
      .rpc();

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority,
      mint,
      authority.publicKey
    );
    expect(Number(tokenAccount.amount)).to.equal(energyWh);
    console.log("✅ Token balance:", Number(tokenAccount.amount), "ENRG");
  });
});