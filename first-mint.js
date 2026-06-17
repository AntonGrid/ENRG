const { PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } = require("@solana/spl-token");
const fs = require("fs");
const crypto = require("crypto");

(async () => {
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync("/home/enrg/founder-keypair.json", "utf8")))
  );
  const connection = new (require("@solana/web3.js").Connection)("https://api.devnet.solana.com");

  const programId = new PublicKey("8JEw3eD7NgboNYcQQwoSsTG7UF8RrQpRnJzouDr6XQ8a");

  const mint = new PublicKey("HzAWLdrMZiS2wEsnZc6hHmg4CdAZM4CaYMYv53BYqw6G");
  console.log("Using existing mint (SRC):", mint.toBase58());

  const [vaultPda] = await PublicKey.findProgramAddress([Buffer.from("vault")], programId);
  const [buyback] = await PublicKey.findProgramAddress([Buffer.from("buyback"), mint.toBuffer()], programId);
  const [staking] = await PublicKey.findProgramAddress([Buffer.from("staking"), mint.toBuffer()], programId);
  const [dao] = await PublicKey.findProgramAddress([Buffer.from("dao"), mint.toBuffer()], programId);
  const [emergency] = await PublicKey.findProgramAddress([Buffer.from("emergency"), mint.toBuffer()], programId);
  const [producerPda] = await PublicKey.findProgramAddress([Buffer.from("producer"), walletKeypair.publicKey.toBuffer()], programId);
  const destination = await getAssociatedTokenAddress(mint, walletKeypair.publicKey);

  const getDisc = (name) => crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

  console.log("Vault:", vaultPda.toBase58());
  console.log("Funds: OK");

  // Producer с паузой
  const producerInfo = await connection.getAccountInfo(producerPda);
  if (!producerInfo) {
    const deviceId = new PublicKey("11111111111111111111111111111111");
    const maxPower = 600_000_000n;
    const cpData = Buffer.alloc(48);
    getDisc("create_producer").copy(cpData, 0);
    deviceId.toBuffer().copy(cpData, 8);
    cpData.writeBigUInt64LE(maxPower, 40);
    const cpIx = new TransactionInstruction({
      keys: [
        { pubkey: producerPda, isWritable: true, isSigner: false },
        { pubkey: walletKeypair.publicKey, isWritable: true, isSigner: true },
        { pubkey: SystemProgram.programId, isWritable: false, isSigner: false }
      ],
      programId,
      data: cpData
    });
    const txSig = await require("@solana/web3.js").sendAndConfirmTransaction(connection, new Transaction().add(cpIx), [walletKeypair]);
    console.log("Producer created:", producerPda.toBase58());
    // Пауза 3 секунды для подтверждения
    await new Promise(r => setTimeout(r, 3000));
  } else {
    console.log("Producer already exists:", producerPda.toBase58());
  }

  // Mint Energy
  const nonce = 1n;
  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const energyWh = 1000n;
  const sign = Buffer.alloc(64);
  const proof = Buffer.alloc(88);
  let off = 0;
  proof.writeBigUInt64LE(nonce, off); off += 8;
  proof.writeBigInt64LE(timestamp, off); off += 8;
  proof.writeBigUInt64LE(energyWh, off); off += 8;
  sign.copy(proof, off);

  const mintIx = new TransactionInstruction({
    keys: [
      { pubkey: producerPda, isWritable: true, isSigner: false },
      { pubkey: walletKeypair.publicKey, isWritable: true, isSigner: true },
      { pubkey: vaultPda, isWritable: false, isSigner: false },
      { pubkey: mint, isWritable: true, isSigner: false },
      { pubkey: destination, isWritable: true, isSigner: false },
      { pubkey: buyback, isWritable: true, isSigner: false },
      { pubkey: staking, isWritable: true, isSigner: false },
      { pubkey: dao, isWritable: true, isSigner: false },
      { pubkey: emergency, isWritable: true, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false }
    ],
    programId,
    data: Buffer.concat([getDisc("mint_energy"), proof])
  });

  try {
    const sig = await require("@solana/web3.js").sendAndConfirmTransaction(connection, new Transaction().add(mintIx), [walletKeypair]);
    console.log("🎉 Mint successful! Transaction:", sig);
    console.log("Check your token account:", destination.toBase58());
  } catch (e) {
    console.error("Mint failed:", e);
  }
})();
