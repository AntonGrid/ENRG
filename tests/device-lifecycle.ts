/**
 * ENRG Device Lifecycle (ADR-0005) — безопасный claim.
 *
 * Ключевое свойство, которое проверяется здесь:
 *   устройство НЕЛЬЗЯ «захватить» без его Ed25519-подписи (ADR-0001).
 *
 * - register_device требует подпись УСТРОЙСТВА над
 *     b"enrg:device:register" || device_id(32) || register_timestamp(8 LE)
 * - claim_device требует подпись УСТРОЙСТВА над
 *     b"enrg:device:claim" || device_id(32) || owner(32)
 *                          || claim_nonce(8 LE) || claim_timestamp(8 LE)
 *
 * Устройство = Solana Keypair (Ed25519); его publicKey и есть device_id.
 * Подпись кладётся в транзакцию ПЕРЕД инструкцией программы через
 * Ed25519Program.createInstructionWithPublicKey (precompile), а программа
 * сверяет (signature, public_key, message) через sysvar Instructions.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import * as assert from "assert";
import nacl from "tweetnacl";
import rawIdl from "../target/idl/enrg_mvp.json";
import { patchIdl } from "./helpers/patch-idl";
import { loadAuthority, ensureFunded } from "./helpers/accounts";

const PROGRAM_ID = new PublicKey("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");
const ENDPOINT = "http://127.0.0.1:8899";

const STATE = {
  Unregistered: { unregistered: {} },
  Registered: { registered: {} },
  Claimed: { claimed: {} },
  Provisioned: { provisioned: {} },
  Active: { active: {} },
  Quarantine: { quarantine: {} },
  Maintenance: { maintenance: {} },
  Revoked: { revoked: {} },
};

// ── Канонические сообщения (должны совпадать с security::lifecycle в Rust) ──
const REGISTER_PREFIX = Buffer.from("enrg:device:register");
const CLAIM_PREFIX = Buffer.from("enrg:device:claim");

function registerMessage(deviceId: PublicKey, registerTimestamp: BN): Buffer {
  const ts = registerTimestamp.toArrayLike(Buffer, "le", 8);
  return Buffer.concat([REGISTER_PREFIX, deviceId.toBytes(), ts]);
}

function claimMessage(
  deviceId: PublicKey,
  owner: PublicKey,
  nonce: BN,
  claimTimestamp: BN
): Buffer {
  const n = nonce.toArrayLike(Buffer, "le", 8);
  const ts = claimTimestamp.toArrayLike(Buffer, "le", 8);
  return Buffer.concat([CLAIM_PREFIX, deviceId.toBytes(), owner.toBytes(), n, ts]);
}

function ed25519Ix(message: Buffer, signer: Keypair): TransactionInstruction {
  const signature = nacl.sign.detached(message, signer.secretKey);
  // web3.js 1.98.4: publicKey ожидается как Uint8Array (32 байта),
  // а НЕ как экземпляр PublicKey (у него нет .length).
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: signer.publicKey.toBytes(),
    message,
    signature,
  });
}

function producerPda(deviceId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("producer"), deviceId.toBytes()],
    PROGRAM_ID
  );
  return pda;
}

function ownerDevicesPda(owner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("owner-devices"), owner.toBytes()],
    PROGRAM_ID
  );
  return pda;
}

describe("ENRG Device Lifecycle (ADR-0005) — claim требует Ed25519-подпись устройства", () => {
  const connection = new Connection(ENDPOINT, "confirmed");
  const provider = new AnchorProvider(
    connection,
    new anchor.Wallet(loadAuthority()),
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = new Program(patchIdl(rawIdl), provider);

  const operator = Keypair.generate();
  const authority = Keypair.generate(); // владелец (кошелёк)
  const otherWallet = Keypair.generate(); // злоумышленник/чужой кошелёк
  const attacker = Keypair.generate();
  const device = Keypair.generate(); // Ed25519-ключ устройства
  const attackerDevice = Keypair.generate(); // ключ ДРУГОГО устройства

  let devicePda: PublicKey;

  const nowTs = (): BN => new BN(Math.floor(Date.now() / 1000));

  before(async () => {
    await ensureFunded(connection, provider.wallet.publicKey);
    for (const kp of [operator, authority, otherWallet, attacker]) {
      await ensureFunded(connection, kp.publicKey);
    }
    devicePda = producerPda(device.publicKey);
  });

  /** Регистрирует устройство (happy path) и возвращает его PDA. */
  async function register(
    dev: Keypair,
    op: Keypair
  ): Promise<PublicKey> {
    const pda = producerPda(dev.publicKey);
    const ts = nowTs();
    const msg = registerMessage(dev.publicKey, ts);
    const sig = Array.from(nacl.sign.detached(msg, dev.secretKey));
    const ix = await program.methods
      .registerDevice(sig, ts)
      .accounts({
        operator: op.publicKey,
        producer: pda,
        deviceId: dev.publicKey,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const tx = new Transaction().add(ed25519Ix(msg, dev), ix);
    await provider.sendAndConfirm(tx, [op]);
    return pda;
  }


  it("1. register: требует подпись устройства (ADR-0001/0002)", async () => {
    const ts = nowTs();
    const msg = registerMessage(device.publicKey, ts);
    const sig = Array.from(nacl.sign.detached(msg, device.secretKey));

    const ix = await program.methods
      .registerDevice(sig, ts)
      .accounts({
        operator: operator.publicKey,
        producer: devicePda,
        deviceId: device.publicKey,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const tx = new Transaction().add(ed25519Ix(msg, device), ix);
    await provider.sendAndConfirm(tx, [operator]);

    const p = await program.account.energyProducer.fetch(devicePda);
    assert.deepStrictEqual(p.state, STATE.Registered, "State should be Registered");
    assert.strictEqual(
      p.deviceId.toBase58(),
      device.publicKey.toBase58(),
      "device_id должен быть записан"
    );
  });

  it("2. register: падает без подписи устройства", async () => {
    const d2 = Keypair.generate();
    const pda2 = producerPda(d2.publicKey);
    const ts = nowTs();

    await assert.rejects(
      program.methods
        .registerDevice(Array.from(Buffer.alloc(64, 0)), ts)
        .accounts({
          operator: operator.publicKey,
          producer: pda2,
          deviceId: d2.publicKey,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .signers([operator])
        .rpc(),
      /Ed25519 verification failed/
    );
  });

  it("3. register: падает с default device_id (InvalidParameter)", async () => {
    const defaultPk = PublicKey.default;
    const pdaDefault = producerPda(defaultPk);
    const ts = nowTs();

    await assert.rejects(
      program.methods
        .registerDevice(Array.from(Buffer.alloc(64, 0)), ts)
        .accounts({
          operator: operator.publicKey,
          producer: pdaDefault,
          deviceId: defaultPk,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .signers([operator])
        .rpc(),
      /Invalid parameter/
    );
  });

  it("4. claim: устройство подписывает привязку к конкретному кошельку", async () => {
    const nonce = new BN(1);
    const ts = nowTs();
    const msg = claimMessage(device.publicKey, authority.publicKey, nonce, ts);
    const sig = Array.from(nacl.sign.detached(msg, device.secretKey));

    const ix = await program.methods
      .claimDevice(sig, nonce, ts)
      .accounts({
        authority: authority.publicKey,
        producer: devicePda,
        ownerDevices: ownerDevicesPda(authority.publicKey),
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    const tx = new Transaction().add(ed25519Ix(msg, device), ix);
    await provider.sendAndConfirm(tx, [authority]);

    const p = await program.account.energyProducer.fetch(devicePda);
    assert.deepStrictEqual(p.state, STATE.Claimed, "State should be Claimed");
    assert.strictEqual(
      p.authority.toBase58(),
      authority.publicKey.toBase58(),
      "authority должен быть кошельком из подписанного сообщения"
    );
    assert.strictEqual(p.claimNonce.toNumber(), 1, "claim_nonce должен сохраниться");
    assert.ok(p.claimedAt.gt(new BN(0)), "claimed_at должен быть записан");
  });


  it("5. claim: падает без подписи устройства (захват невозможен)", async () => {
    const d5 = Keypair.generate();
    const pda5 = await register(d5, operator);
    const nonce = new BN(1);
    const ts = nowTs();

    await assert.rejects(
      program.methods
        .claimDevice(Array.from(Buffer.alloc(64, 0)), nonce, ts)
        .accounts({
          authority: otherWallet.publicKey,
          producer: pda5,
          ownerDevices: ownerDevicesPda(otherWallet.publicKey),
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .signers([otherWallet])
        .rpc(),
      /Ed25519 verification failed/
    );
  });

  it("6. claim: подпись нельзя перенаправить на другой кошелёк", async () => {
    const d6 = Keypair.generate();
    const pda6 = await register(d6, operator);
    const legit = Keypair.generate();
    await ensureFunded(connection, legit.publicKey);

    // Устройство подписывает claim для legit (законный владелец).
    const nonce = new BN(1);
    const ts = nowTs();
    const msgLegit = claimMessage(d6.publicKey, legit.publicKey, nonce, ts);
    const sig = Array.from(nacl.sign.detached(msgLegit, d6.secretKey));

    // Злоумышленник пытается использовать эту же подпись для своего кошелька.
    const ix = await program.methods
      .claimDevice(sig, nonce, ts)
      .accounts({
        authority: attacker.publicKey,
        producer: pda6,
        ownerDevices: ownerDevicesPda(attacker.publicKey),
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    const tx = new Transaction().add(ed25519Ix(msgLegit, d6), ix);

    await assert.rejects(
      provider.sendAndConfirm(tx, [attacker]),
      /Ed25519 verification failed/
    );

    // Устройство осталось незахваченным.
    const p = await program.account.energyProducer.fetch(pda6);
    assert.deepStrictEqual(p.state, STATE.Registered, "Device must remain Registered");
  });

  it("7. claim: падает с подписью ДРУГОГО устройства", async () => {
    const d7 = Keypair.generate();
    const pda7 = await register(d7, operator);
    const nonce = new BN(1);
    const ts = nowTs();

    // Подписывает attackerDevice, а не само устройство d7.
    const msg = claimMessage(d7.publicKey, otherWallet.publicKey, nonce, ts);
    const sig = Array.from(nacl.sign.detached(msg, attackerDevice.secretKey));

    const ix = await program.methods
      .claimDevice(sig, nonce, ts)
      .accounts({
        authority: otherWallet.publicKey,
        producer: pda7,
        ownerDevices: ownerDevicesPda(otherWallet.publicKey),
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    const tx = new Transaction().add(ed25519Ix(msg, attackerDevice), ix);

    await assert.rejects(
      provider.sendAndConfirm(tx, [otherWallet]),
      /Ed25519 verification failed/
    );
  });

  it("8. claim уже захваченного устройства — падает", async () => {
    const nonce = new BN(2);
    const ts = nowTs();
    const msg = claimMessage(device.publicKey, otherWallet.publicKey, nonce, ts);
    const sig = Array.from(nacl.sign.detached(msg, device.secretKey));

    const ix = await program.methods
      .claimDevice(sig, nonce, ts)
      .accounts({
        authority: otherWallet.publicKey,
        producer: devicePda,
        ownerDevices: ownerDevicesPda(otherWallet.publicKey),
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    const tx = new Transaction().add(ed25519Ix(msg, device), ix);

    await assert.rejects(
      provider.sendAndConfirm(tx, [otherWallet]),
      /already claimed by another wallet|required state/
    );
  });


  it("9. provision: требует владельца (authority)", async () => {
    await assert.rejects(
      program.methods
        .provisionDevice()
        .accounts({ authority: otherWallet.publicKey, producer: devicePda })
        .signers([otherWallet])
        .rpc(),
      /Unauthorized access/
    );
  });

  it("10. полный lifecycle владельцем: provision → activate → quarantine → release → revoke", async () => {
    await program.methods
      .provisionDevice()
      .accounts({ authority: authority.publicKey, producer: devicePda })
      .signers([authority])
      .rpc();
    let p = await program.account.energyProducer.fetch(devicePda);
    assert.deepStrictEqual(p.state, STATE.Provisioned, "Should be Provisioned");

    await program.methods
      .activateDevice()
      .accounts({
        authority: authority.publicKey,
        producer: devicePda,
        ownerDevices: ownerDevicesPda(authority.publicKey),
      })
      .signers([authority])
      .rpc();
    p = await program.account.energyProducer.fetch(devicePda);
    assert.deepStrictEqual(p.state, STATE.Active, "Should be Active");

    await program.methods
      .quarantineDevice()
      .accounts({
        authority: authority.publicKey,
        producer: devicePda,
        ownerDevices: ownerDevicesPda(authority.publicKey),
      })
      .signers([authority])
      .rpc();
    p = await program.account.energyProducer.fetch(devicePda);
    assert.deepStrictEqual(p.state, STATE.Quarantine, "Should be Quarantine");

    await program.methods
      .releaseFromQuarantine()
      .accounts({
        authority: authority.publicKey,
        producer: devicePda,
        ownerDevices: ownerDevicesPda(authority.publicKey),
      })
      .signers([authority])
      .rpc();
    p = await program.account.energyProducer.fetch(devicePda);
    assert.deepStrictEqual(p.state, STATE.Active, "Should be Active again");

    await program.methods
      .revokeDevice()
      .accounts({
        authority: authority.publicKey,
        producer: devicePda,
        ownerDevices: ownerDevicesPda(authority.publicKey),
      })
      .signers([authority])
      .rpc();
    p = await program.account.energyProducer.fetch(devicePda);
    assert.deepStrictEqual(p.state, STATE.Revoked, "Should be Revoked");
  });

  it("11. из REVOKED переходы запрещены (ADR-0005 terminal state)", async () => {
    await assert.rejects(
      program.methods
        .activateDevice()
        .accounts({
          authority: authority.publicKey,
          producer: devicePda,
          ownerDevices: ownerDevicesPda(authority.publicKey),
        })
        .signers([authority])
        .rpc(),
      /state transition is not allowed/
    );
  });
});

