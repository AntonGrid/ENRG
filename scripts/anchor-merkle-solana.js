// Anchor Merkle root on Solana using Memo program
const { Connection, Keypair, PublicKey, Transaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');
const fetch = require('node-fetch');

const SOLANA_URL = process.env.SOLANA_URL || 'https://api.devnet.solana.com';
const KEYPAIR_PATH = process.env.KEYPAIR || process.env.HOME + '/.config/solana/id.json';
const REGISTRY_URL = process.argv[3] || 'http://localhost:4000';
const SNAPSHOT_ID = process.argv[2];

if (!SNAPSHOT_ID) {
  console.error('Usage: node anchor-merkle-solana.js <snapshot_id> [registry_url]');
  process.exit(1);
}

async function main() {
  const connection = new Connection(SOLANA_URL, 'confirmed');
  const keypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(require('fs').readFileSync(KEYPAIR_PATH, 'utf-8')))
  );
  console.log('Payer:', keypair.publicKey.toBase58());

  // Fetch snapshot from registry
  const resp = await fetch(`${REGISTRY_URL}/api/v1/merkle/${SNAPSHOT_ID}`);
  if (!resp.ok) throw new Error('Snapshot not found');
  const snapshot = await resp.json();

  // Send memo with root
  const memo = Buffer.from(`ENRG:${snapshot.root}:${snapshot.id}`, 'utf8');
  const tx = new Transaction().add({
    keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: true }],
    data: memo,
    programId: new PublicKey('MemoSq4gqABAXKbUqnNdwBEb8zjCcNwCkKRz4HHrN7g')
  });
  const sig = await connection.sendTransaction(tx, [keypair]);
  await connection.confirmTransaction(sig);
  console.log('✅ Anchored:', sig);
}
main().catch(console.error);
