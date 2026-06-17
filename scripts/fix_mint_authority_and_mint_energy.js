const { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction, SystemProgram } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, getAccount, setAuthority, AuthorityType, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');
const crypto = require('crypto');

(async () => {
  const keypairPath = '/home/enrg/ENRG/scripts/founder-keypair.json';
  if (!fs.existsSync(keypairPath)) {
    console.error('Founder keypair not found at', keypairPath);
    process.exit(1);
  }
  const founder = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')))
  );
  console.log('Signer:', founder.publicKey.toBase58());

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const programId = new PublicKey('8JEw3eD7NgboNYcQQwoSsTG7UF8RrQpRnJzouDr6XQ8a');
  const mint = new PublicKey('HzAWLdrMZiS2wEsnZc6hHmg4CdAZM4CaYMYv53BYqw6G');
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from('vault')], programId);
  const [producerPda] = PublicKey.findProgramAddressSync([Buffer.from('producer'), founder.publicKey.toBuffer()], programId);
  const destination = getAssociatedTokenAddressSync(mint, founder.publicKey, false);

  // Step 1: Transfer mint authority to vault PDA
  console.log('Transferring mint authority to vault PDA...');
  try {
    const txSig = await setAuthority(
      connection, founder, mint, vaultPda,
      AuthorityType.MintTokens, founder.publicKey,
      []
    );
    console.log('Authority transferred. TX:', txSig);
  } catch (e) {
    console.error('Failed to transfer authority:', e);
    process.exit(1);
  }

  console.log('Waiting 5 seconds...');
  await new Promise(r => setTimeout(r, 5000));

  // Step 2: Call mint_energy
  console.log('Calling mint_energy...');
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

  const getDisc = (name) => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
  const disc = getDisc('mint_energy');

  const [buyback] = PublicKey.findProgramAddressSync([Buffer.from('buyback'), mint.toBuffer()], programId);
  const [staking] = PublicKey.findProgramAddressSync([Buffer.from('staking'), mint.toBuffer()], programId);
  const [dao] = PublicKey.findProgramAddressSync([Buffer.from('dao'), mint.toBuffer()], programId);
  const [emergency] = PublicKey.findProgramAddressSync([Buffer.from('emergency'), mint.toBuffer()], programId);

  const instruction = new (require('@solana/web3.js')).TransactionInstruction({
    keys: [
      { pubkey: producerPda, isWritable: true, isSigner: false },
      { pubkey: founder.publicKey, isWritable: true, isSigner: true },
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
    data: Buffer.concat([disc, proof])
  });

  const tx = new Transaction().add(instruction);
  try {
    const mintSig = await sendAndConfirmTransaction(connection, tx, [founder]);
    console.log('🎉 Mint successful! TX:', mintSig);
  } catch (e) {
    console.error('Mint failed:', e);
    process.exit(1);
  }

  // Step 3: Check token balance
  try {
    const tokenAccount = await getAccount(connection, destination);
    console.log('💼 Token balance:', tokenAccount.amount.toString(), 'SRC');
  } catch (e) {
    console.error('Could not fetch token balance:', e);
  }
})();
