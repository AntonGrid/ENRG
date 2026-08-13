/**
 * ENRG — Trust Levels (v7.0 §15), ERS (v7.0 §16/§27), Pool (v7.0 §14).
 *
 * TS-покрытие новых инструкций (без mint_energy — минт требует 2× Ed25519
 * + LUT/v0, что нестабильно на anchor-валидаторе; mint-интеграция tier-лимита,
 * ERS-обновления и pool-вклада покрыта Rust unit-тестами чистых функций).
 *
 * Покрывает:
 *   - set_device_tier (тиры + authority-гейтинг);
 *   - initialize_reputation / report_anomaly / ers_premium_access;
 *   - create_pool / join_pool (init pool_share) / distribute_pool (порог).
 */
import * as anchor from '@coral-xyz/anchor';
import { BN, AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import {
  PublicKey,
  Connection,
  Keypair,
  Transaction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Ed25519Program,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import nacl from 'tweetnacl';
import { patchIdl } from './helpers/patch-idl';
import rawIdl from '../target/idl/enrg_mvp.json';

const PROGRAM_ID = new PublicKey('HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb');
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'http://127.0.0.1:8899';

const findPda = (seed: string): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from(seed)], PROGRAM_ID)[0];

const vaultPda = findPda('vault');
const tokenMintPda = findPda('token-mint');
const mintPda = findPda('src-mint');
const buybackPda = findPda('fund-buyback');
const fundStaking = findPda('fund-staking');
const fundDao = findPda('fund-dao');
const fundEmergency = findPda('fund-emergency');
const oracleRegistryPda = findPda('oracle-registry');
const producerPda = (deviceId: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('producer'), deviceId.toBytes()],
    PROGRAM_ID
  )[0];
const ownerDevicesPda = (owner: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('owner-devices'), owner.toBytes()],
    PROGRAM_ID
  )[0];
const reputationPda = (owner: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('reputation'), owner.toBytes()],
    PROGRAM_ID
  )[0];
const poolPda = (owner: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), owner.toBytes()],
    PROGRAM_ID
  )[0];
const poolSharePda = (pool: PublicKey, producer: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('pool-share'), pool.toBytes(), producer.toBytes()],
    PROGRAM_ID
  )[0];

const REGISTER_PREFIX = Buffer.from('enrg:device:register');
const CLAIM_PREFIX = Buffer.from('enrg:device:claim');
function registerMessage(deviceId: PublicKey, ts: BN): Buffer {
  return Buffer.concat([REGISTER_PREFIX, deviceId.toBytes(), ts.toArrayLike(Buffer, 'le', 8)]);
}
function claimMessage(deviceId: PublicKey, owner: PublicKey, nonce: BN, ts: BN): Buffer {
  return Buffer.concat([
    CLAIM_PREFIX,
    deviceId.toBytes(),
    owner.toBytes(),
    nonce.toArrayLike(Buffer, 'le', 8),
    ts.toArrayLike(Buffer, 'le', 8),
  ]);
}
function ed25519Ix(message: Buffer, signer: nacl.SignKeyPair): TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: signer.publicKey,
    message,
    signature: nacl.sign.detached(message, signer.secretKey),
  });
}

const connection = new Connection(RPC_ENDPOINT, 'confirmed');
const FOUNDER_KEYPAIR_PATH =
  process.env.FOUNDER_KEYPAIR_PATH ||
  path.join(os.homedir(), '.config/solana/founder-wallet.json');
const authority = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(FOUNDER_KEYPAIR_PATH, 'utf8')))
);
const provider = new AnchorProvider(connection, new Wallet(authority), {
  commitment: 'confirmed',
  preflightCommitment: 'confirmed',
});
anchor.setProvider(provider);
const program: any = new Program(patchIdl(rawIdl), provider);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ensureFunded(pk: PublicKey, amount = LAMPORTS_PER_SOL): Promise<void> {
  const bal = await connection.getBalance(pk);
  if (bal < amount) {
    await connection.requestAirdrop(pk, amount);
    await sleep(1000);
  }
}
async function accountExists(pk: PublicKey): Promise<boolean> {
  return !!(await connection.getAccountInfo(pk));
}
async function nowTs(): Promise<BN> {
  const slot = await connection.getSlot('finalized');
  const bt = await connection.getBlockTime(slot);
  return new BN(bt ?? Math.floor(Date.now() / 1000));
}

describe('ENRG — Trust Levels / ERS / Pool (v7.0 §14/§15/§16)', () => {
  let deviceA: nacl.SignKeyPair;
  let deviceB: nacl.SignKeyPair;
  let oracle: nacl.SignKeyPair;
  let producerA: PublicKey;
  let producerB: PublicKey;
  let userAta: PublicKey;

  async function registerAndClaim(
    device: nacl.SignKeyPair,
    producer: PublicKey,
    id: PublicKey
  ): Promise<void> {
    let ts = await nowTs();
    const regMsg = registerMessage(id, ts);
    const regSig = Array.from(nacl.sign.detached(regMsg, device.secretKey));
    const regIx = await program.methods
      .registerDevice(regSig, ts)
      .accounts({
        operator: authority.publicKey,
        producer,
        deviceId: id,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    await provider.sendAndConfirm(new Transaction().add(ed25519Ix(regMsg, device), regIx), []);

    ts = await nowTs();
    const claimMsg = claimMessage(id, authority.publicKey, new BN(1), ts);
    const claimSig = Array.from(nacl.sign.detached(claimMsg, device.secretKey));
    const claimIx = await program.methods
      .claimDevice(claimSig, new BN(1), ts)
      .accounts({
        authority: authority.publicKey,
        producer,
        ownerDevices: ownerDevicesPda(authority.publicKey),
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    await provider.sendAndConfirm(new Transaction().add(ed25519Ix(claimMsg, device), claimIx), []);
  }

  before(async () => {
    deviceA = nacl.sign.keyPair();
    deviceB = nacl.sign.keyPair();
    oracle = nacl.sign.keyPair();
    producerA = producerPda(new PublicKey(deviceA.publicKey));
    producerB = producerPda(new PublicKey(deviceB.publicKey));

    await ensureFunded(authority.publicKey);
    userAta = getAssociatedTokenAddressSync(mintPda, authority.publicKey, false);
    const fundAtas = {
      buyback: getAssociatedTokenAddressSync(mintPda, buybackPda, true),
      staking: getAssociatedTokenAddressSync(mintPda, fundStaking, true),
      dao: getAssociatedTokenAddressSync(mintPda, fundDao, true),
      emergency: getAssociatedTokenAddressSync(mintPda, fundEmergency, true),
    };

    if (!(await accountExists(tokenMintPda))) {
      await program.methods
        .initializeToken()
        .accounts({
          tokenMint: tokenMintPda,
          mint: mintPda,
          mintAuthority: findPda('mint-authority'),
          buybackAuthority: buybackPda,
          authority: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
    }
    if (!(await accountExists(vaultPda))) {
      await program.methods
        .initializeVault()
        .accounts({
          vault: vaultPda,
          authority: authority.publicKey,
          mint: mintPda,
          tokenMint: tokenMintPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    for (const [name, ata] of Object.entries(fundAtas)) {
      if (!(await accountExists(ata))) {
        const owner =
          name === 'buyback'
            ? buybackPda
            : name === 'staking'
            ? fundStaking
            : name === 'dao'
            ? fundDao
            : fundEmergency;
        await provider.sendAndConfirm(
          new Transaction().add(
            createAssociatedTokenAccountInstruction(authority.publicKey, ata, owner, mintPda)
          ),
          []
        );
      }
    }
    if (!(await accountExists(oracleRegistryPda))) {
      await program.methods
        .initializeOracleRegistry()
        .accounts({ authority: authority.publicKey })
        .rpc();
    }
    const reg = await program.account.oracleRegistry.fetch(oracleRegistryPda).catch(() => null);
    if (!reg || !reg.oracles.some((o: PublicKey) => o.equals(new PublicKey(oracle.publicKey)))) {
      await program.methods
        .addOracle(new PublicKey(oracle.publicKey))
        .accounts({ registry: oracleRegistryPda, authority: authority.publicKey })
        .rpc();
    }

    await registerAndClaim(deviceA, producerA, new PublicKey(deviceA.publicKey));
    await registerAndClaim(deviceB, producerB, new PublicKey(deviceB.publicKey));
  });

  it('Trust: дефолтный тир Basic; set_device_tier меняет тир (только Vault authority)', async () => {
    const p0 = await program.account.energyProducer.fetch(producerA);
    assert.strictEqual(p0.tier.basic !== undefined, true, 'новый девайс — Basic');

    const stranger = Keypair.generate();
    await assert.rejects(
      program.methods
        .setDeviceTier({ verified: {} })
        .accounts({ vault: vaultPda, producer: producerA, authority: stranger.publicKey })
        .signers([stranger])
        .rpc(),
      /Unauthorized|authority/
    );

    await program.methods
      .setDeviceTier({ verified: {} })
      .accounts({ vault: vaultPda, producer: producerA, authority: authority.publicKey })
      .rpc();
    const p1 = await program.account.energyProducer.fetch(producerA);
    assert.strictEqual(p1.tier.verified !== undefined, true, 'tier == Verified');

    await program.methods
      .setDeviceTier({ industrial: {} })
      .accounts({ vault: vaultPda, producer: producerA, authority: authority.publicKey })
      .rpc();
    const p2 = await program.account.energyProducer.fetch(producerA);
    assert.strictEqual(p2.tier.industrial !== undefined, true, 'tier == Industrial');
  });

  it('ERS: initialize_reputation + премиум-доступ + штраф аномалией', async () => {
    const rep = reputationPda(authority.publicKey);
    if (!(await accountExists(rep))) {
      await program.methods
        .initializeReputation()
        .accounts({
          reputation: rep,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    const r0 = await program.account.reputation.fetch(rep);
    assert.ok(r0.score >= 200, `базовый score=${r0.score}`);

    const premium0 = await program.methods.ersPremiumAccess().accounts({ reputation: rep }).view();
    assert.strictEqual(premium0, false, 'score < 700 → нет премиум-доступа');

    const before = r0.score;
    await program.methods
      .reportAnomaly(5)
      .accounts({
        reputation: rep,
        oracleRegistry: oracleRegistryPda,
        oracle: new PublicKey(oracle.publicKey),
      })
      .signers([Keypair.fromSecretKey(Uint8Array.from(oracle.secretKey))])
      .rpc();
    const r2 = await program.account.reputation.fetch(rep);
    assert.ok(r2.score < before, `score ${before} -> ${r2.score} после аномалии`);
    assert.strictEqual(r2.anomalyCount, 1, 'anomaly_count == 1');

    const stranger = Keypair.generate();
    await assert.rejects(
      program.methods
        .reportAnomaly(1)
        .accounts({ reputation: rep, oracleRegistry: oracleRegistryPda, oracle: stranger.publicKey })
        .signers([stranger])
        .rpc(),
      /UntrustedOracle|oracle/
    );
  });

  it('Pool: create/join инициализируют pool_share; distribute до порога отклоняется', async () => {
    const pool = poolPda(authority.publicKey);
    const shareA = poolSharePda(pool, producerA);
    const shareB = poolSharePda(pool, producerB);
    const THRESHOLD = new BN(100_000); // 0.1 МВт·ч

    if (!(await accountExists(pool))) {
      await program.methods
        .createPool(THRESHOLD)
        .accounts({
          pool,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    const poolAcc = await program.account.pool.fetch(pool);
    assert.ok(poolAcc.threshold.eq(new BN(100_000)), `threshold=${poolAcc.threshold}`);

    if (!poolAcc.producers.some((p: PublicKey) => p.equals(producerA))) {
      await program.methods
        .joinPool()
        .accounts({
          pool,
          producer: producerA,
          poolShare: shareA,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    if (!poolAcc.producers.some((p: PublicKey) => p.equals(producerB))) {
      await program.methods
        .joinPool()
        .accounts({
          pool,
          producer: producerB,
          poolShare: shareB,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    // pool_share создан join-ом и принадлежит пулу.
    const sa = await program.account.poolContribution.fetch(shareA);
    assert.strictEqual(sa.pool.toBase58(), pool.toBase58(), 'share.pool == pool');
    assert.strictEqual(sa.producer.toBase58(), producerA.toBase58(), 'share.producer == producerA');
    assert.ok(sa.energyWh.eq(new BN(0)), 'вклад изначально 0');

    // Без mint вклад = 0 → порог не достигнут → PoolThresholdNotReached.
    await assert.rejects(
      program.methods
        .distributePool()
        .accounts({
          pool,
          vault: vaultPda,
          tokenMint: tokenMintPda,
          mint: mintPda,
          mintAuthority: findPda('mint-authority'),
          tokenProgram: TOKEN_PROGRAM_ID,
          authority: authority.publicKey,
        })
        .rpc(),
      /PoolThresholdNotReached|threshold/
    );
  });
});
