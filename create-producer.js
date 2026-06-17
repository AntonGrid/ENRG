const { PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram, Connection, clusterApiUrl, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const crypto = require('crypto');

(async () => {
  // Загружаем founder-keypair
  const founderKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync('/home/enrg/founder-keypair.json', 'utf8')))
  );
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const programId = new PublicKey('8JEw3eD7NgboNYcQQwoSsTG7UF8RrQpRnJzouDr6XQ8a');

  // Вычисляем PDA для producer
  const [producerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('producer'), founderKeypair.publicKey.toBuffer()],
    programId
  );
  console.log('Producer PDA:', producerPda.toBase58());

  // Проверяем, существует ли уже аккаунт
  const existing = await connection.getAccountInfo(producerPda);
  if (existing) {
    console.log('Producer already exists! No need to create.');
    process.exit(0);
  }

  // Готовим данные для create_producer
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
  console.log('✅ Producer created successfully! TX:', sig);
})();
