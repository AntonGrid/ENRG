const { PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram, Connection, clusterApiUrl, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const crypto = require('crypto');

(async () => {
  const founderKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync('/home/enrg/founder-keypair.json', 'utf8')))
  );
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const programId = new PublicKey('8JEw3eD7NgboNYcQQwoSsTG7UF8RrQpRnJzouDr6XQ8a');
  const deviceId = 'device-001';

  // PDA на основе device_id (именно его использует оракул)
  const [producerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(deviceId)],
    programId
  );
  console.log('Producer PDA (device-based):', producerPda.toBase58());

  const accountInfo = await connection.getAccountInfo(producerPda);
  if (accountInfo && accountInfo.data.length > 0) {
    console.log('✅ Producer already initialized with device seed.');
    process.exit(0);
  }

  console.log('⚠️ Producer not initialized. Creating...');

  // Данные для create_producer
  const deviceIdPubkey = new PublicKey('11111111111111111111111111111111');
  const maxPowerW = 600_000_000n;
  const data = Buffer.alloc(48);
  const disc = crypto.createHash('sha256').update('global:create_producer').digest().subarray(0, 8);
  disc.copy(data, 0);
  deviceIdPubkey.toBuffer().copy(data, 8);
  data.writeBigUInt64LE(maxPowerW, 40);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: producerPda, isWritable: true, isSigner: false },
      { pubkey: founderKeypair.publicKey, isWritable: true, isSigner: true },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false }
    ],
    programId,
    data
  });

  const tx = new Transaction().add(instruction);
  const sig = await sendAndConfirmTransaction(connection, tx, [founderKeypair]);
  console.log('✅ Producer created and initialized! TX:', sig);
})();
