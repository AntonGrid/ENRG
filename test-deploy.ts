import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddress } from "@solana/spl-token";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = new Program(
  require("./target/idl/enrg_mvp.json"),
  new PublicKey("934VCuafJTsGvJ43u2sqAv7VaxNGf8Egtk8wYAXh5crn"),
  provider
);

const authority = (provider.wallet as anchor.Wallet).payer;

async function main() {
  // 1. Create mint
  const mint = await createMint(provider.connection, authority, authority.publicKey, null, 9);
  console.log("Mint:", mint.toBase58());

  // 2. Initialize vault
  const [vaultPda] = await PublicKey.findProgramAddress([Buffer.from("vault")], program.programId);
  await program.methods.initializeVault()
    .accounts({ vault: vaultPda, authority: authority.publicKey, mint, systemProgram: SystemProgram.programId })
    .signers([authority]).rpc();
  console.log("Vault:", vaultPda.toBase58());

  // 3. Initialize funds
  const [buyback] = await PublicKey.findProgramAddress([Buffer.from("buyback"), mint.toBuffer()], program.programId);
  const [staking] = await PublicKey.findProgramAddress([Buffer.from("staking"), mint.toBuffer()], program.programId);
  const [dao] = await PublicKey.findProgramAddress([Buffer.from("dao"), mint.toBuffer()], program.programId);
  const [emergency] = await PublicKey.findProgramAddress([Buffer.from("emergency"), mint.toBuffer()], program.programId);
  await program.methods.initializeFunds()
    .accounts({ buybackAccount: buyback, stakingPool: staking, daoReserve: dao, emergencyFund: emergency, mint, vault: vaultPda, authority: authority.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([authority]).rpc();
  console.log("Funds initialized");

  // 4. Create producer
  const [producerPda] = await PublicKey.findProgramAddress([Buffer.from("producer"), authority.publicKey.toBuffer()], program.programId);
  await program.methods.createProducer(new PublicKey("11111111111111111111111111111111"), new anchor.BN(600_000_000))
    .accounts({ producer: producerPda, authority: authority.publicKey, systemProgram: SystemProgram.programId })
    .signers([authority]).rpc();
  console.log("Producer:", producerPda.toBase58());

  // 5. Mint energy (test with 1 kWh = 1000 Wh)
  const destination = await getAssociatedTokenAddress(mint, authority.publicKey);
  const proof = { nonce: new anchor.BN(1), timestamp: new anchor.BN(Math.floor(Date.now() / 1000)), energyWh: new anchor.BN(1000), signature: Array.from(Buffer.alloc(64)) };
  await program.methods.mintEnergy(proof)
    .accounts({ producer: producerPda, authority: authority.publicKey, vault: vaultPda, mint, destination, buybackAccount: buyback, stakingPool: staking, daoReserve: dao, emergencyFund: emergency, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([authority]).rpc();
  console.log("Mint successful! Check your token account:", destination.toBase58());
}

main().catch(console.error);
