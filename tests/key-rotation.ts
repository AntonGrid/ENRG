/**
 * ENRG Key Rotation & Revocation (ADR-0007).
 *
 * - revoke_device: владелец (или админ) отзывает устройство — устанавливается
 *   флаг revoked=true (терминальное состояние); отозванное устройство не может
 *   минтить и менять состояние.
 * - rotate_device_key: владелец меняет публичный ключ устройства. НОВЫЙ ключ
 *   обязан подписать b"enrg:device:rotate" || new(32) || owner(32) || nonce || ts
 *   (proof-of-possession нового ключа). Старая запись → revoked + rotated_to,
 *   новая наследует состояние (authority, nonce, энергию, tier, state).
 *
 * Запуск (нужен solana-test-validator + задеплоенная программа):
 *   anchor test --skip-build   (или ts-mocha tests/key-rotation.ts)
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
  Registered: { registered: {} },
  Claimed: { claimed: {} },
  Provisioned: { provisioned: {} },
  Active: { active: {} },
  Revoked: { revoked: {} },
};

// ── Канонические сообщения (должны совпадать с security::lifecycle в Rust) ──
const REGISTER_PREFIX = Buffer.from("enrg:device:register");
const CLAIM_PREFIX = Buffer.from("enrg:device:claim");
const ROTATE_PREFIX = Buffer.from("enrg:device:rotate");

function registerMessage(deviceId: PublicKey, ts: BN): Buffer {
  return Buffer.concat([REGISTER_PREFIX, deviceId.toBytes(), ts.toArrayLike(Buffer, "le", 8)]);
}
function claimMessage(deviceId: PublicKey, owner: PublicKey, nonce: BN, ts: BN): Buffer {
  return Buffer.concat([
    CLAIM_PREFIX, deviceId.toBytes(), owner.toBytes(),
    nonce.toArrayLike(Buffer, "le", 8), ts.toArrayLike(Buffer, "le", 8),
  ]);
}
function rotateMessage(newDeviceId: PublicKey, owner: PublicKey, nonce: BN, ts: BN): Buffer {
  return Buffer.concat([
    ROTATE_PREFIX, newDeviceId.toBytes(), owner.toBytes(),
    nonce.toArrayLike(Buffer, "le", 8), ts.toArrayLike(Buffer, "le", 8),
  ]);
}

function ed25519Ix(message: Buffer, signer: Keypair): TransactionInstruction {
  const signature = nacl.sign.detached(message, signer.secretKey);
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: signer.publicKey.toBytes(),
    message,
    signature,
  });
}

function producerPda(deviceId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("producer"), deviceId.toBytes()], PROGRAM_ID
  );
  return pda;
}
function ownerDevicesPda(owner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("owner-devices"), owner.toBytes()], PROGRAM_ID
  );
  return pda;
}

describe("ENRG Key Rotation & Revocation (ADR-0007)", () => {
  const connection = new Connection(ENDPOINT, "confirmed");
  const provider = new AnchorProvider(connection, new anchor.Wallet(loadAuthority()), {
    commitment: "confirmed", preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new Program(patchIdl(rawIdl), provider) as any;

  const operator = Keypair.generate();
  const owner = Keypair.generate();
  const stranger = Keypair.generate();
  const device = Keypair.generate();
  const newDevice = Keypair.generate();

  const nowTs = (): BN => new BN(Math.floor(Date.now() / 1000));

  async function register(dev: Keypair, op: Keypair): Promise<PublicKey> {
    const pda = producerPda(dev.publicKey);
    const ts = nowTs();
    const msg = registerMessage(dev.publicKey, ts);
    const sig = Array.from(nacl.sign.detached(msg, dev.secretKey));
    const ix = await program.methods.registerDevice(sig, ts)
      .accounts({ operator: op.publicKey, producer: pda, deviceId: dev.publicKey,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY, systemProgram: SystemProgram.programId })
      .instruction();
    await provider.sendAndConfirm(new Transaction().add(ed25519Ix(msg, dev), ix), [op]);
    return pda;
  }

  async function claim(dev: Keypair, own: Keypair, pda: PublicKey): Promise<void> {
    const nonce = new BN(1);
    const ts = nowTs();
    const msg = claimMessage(dev.publicKey, own.publicKey, nonce, ts);
    const sig = Array.from(nacl.sign.detached(msg, dev.secretKey));
    const ix = await program.methods.claimDevice(sig, nonce, ts)
      .accounts({ authority: own.publicKey, producer: pda,
        ownerDevices: ownerDevicesPda(own.publicKey), instructions: SYSVAR_INSTRUCTIONS_PUBKEY })
      .instruction();
    await provider.sendAndConfirm(new Transaction().add(ed25519Ix(msg, dev), ix), [own]);
  }

  async function provision(own: Keypair, pda: PublicKey): Promise<void> {
    await program.methods.provisionDevice()
      .accounts({ authority: own.publicKey, producer: pda, ownerDevices: ownerDevicesPda(own.publicKey) })
      .signers([own]).rpc();
  }

  async function activate(own: Keypair, pda: PublicKey): Promise<void> {
    await program.methods.activateDevice()
      .accounts({ authority: own.publicKey, producer: pda, ownerDevices: ownerDevicesPda(own.publicKey) })
      .signers([own]).rpc();
  }

  /** Полный жизненный цикл до ACTIVE (для revoke/rotate). */
  async function registerToActive(dev: Keypair, own: Keypair): Promise<PublicKey> {
    const pda = await register(dev, operator);
    await claim(dev, own, pda);
    await provision(own, pda);
    await activate(own, pda);
    return pda;
  }

  before(async () => {
    await ensureFunded(connection, provider.wallet.publicKey);
    for (const kp of [operator, owner, stranger]) await ensureFunded(connection, kp.publicKey);
  });

  it("1. revoke: владелец отзывает устройство → revoked=true, state=Revoked, событие", async () => {
    const d = Keypair.generate();
    const pda = await registerToActive(d, owner);

    const before = await program.account.energyProducer.fetch(pda);
    assert.strictEqual(before.revoked, false, "до отзыва revoked=false");
    assert.deepStrictEqual(before.state, STATE.Active);

    const tx = await program.methods.revokeDevice()
      .accounts({ authority: owner.publicKey, producer: pda,
        ownerDevices: ownerDevicesPda(owner.publicKey), vault: null })
      .signers([owner]).rpc();
    assert.ok(tx, "revoke tx подтверждена");

    const p = await program.account.energyProducer.fetch(pda);
    assert.strictEqual(p.revoked, true, "revoked=true после отзыва");
    assert.deepStrictEqual(p.state, STATE.Revoked, "state=Revoked (терминальное)");
  });

  it("2. revoke: не-владелец не может отозвать (Unauthorized)", async () => {
    const d = Keypair.generate();
    const pda = await registerToActive(d, owner);

    await assert.rejects(
      program.methods.revokeDevice()
        .accounts({ authority: stranger.publicKey, producer: pda,
          ownerDevices: null, vault: null })
        .signers([stranger]).rpc(),
      /Unauthorized/
    );
  });

  it("3. revoked: повторный отзыв отклоняется (DeviceAlreadyRevoked)", async () => {
    const d = Keypair.generate();
    const pda = await registerToActive(d, owner);
    await program.methods.revokeDevice()
      .accounts({ authority: owner.publicKey, producer: pda,
        ownerDevices: ownerDevicesPda(owner.publicKey), vault: null })
      .signers([owner]).rpc();

    await assert.rejects(
      program.methods.revokeDevice()
        .accounts({ authority: owner.publicKey, producer: pda,
          ownerDevices: ownerDevicesPda(owner.publicKey), vault: null })
        .signers([owner]).rpc(),
      /already revoked|Invalid parameter/i
    );
  });

  it("4. revoked: отозванное устройство не может менять состояние (проверка revoked-флага)", async () => {
    const d = Keypair.generate();
    const pda = await registerToActive(d, owner);
    await program.methods.revokeDevice()
      .accounts({ authority: owner.publicKey, producer: pda,
        ownerDevices: ownerDevicesPda(owner.publicKey), vault: null })
      .signers([owner]).rpc();

    // Попытка quarantine отозванного устройства → DeviceRevoked (явная проверка флага).
    await assert.rejects(
      program.methods.quarantineDevice()
        .accounts({ authority: owner.publicKey, producer: pda,
          ownerDevices: ownerDevicesPda(owner.publicKey) })
        .signers([owner]).rpc(),
      /revoked|not allowed|transition/i
    );
  });

  it("5. rotate: владелец меняет ключ → новый producer Active, старый revoked + rotated_to", async () => {
    const d = Keypair.generate();
    const pda = await registerToActive(d, owner);
    const newPda = producerPda(newDevice.publicKey);

    const nonce = new BN(2);
    const ts = nowTs();
    const msg = rotateMessage(newDevice.publicKey, owner.publicKey, nonce, ts);
    const sig = Array.from(nacl.sign.detached(msg, newDevice.secretKey));

    const ix = await program.methods.rotateDeviceKey(newDevice.publicKey, sig, nonce, ts)
      .accounts({ authority: owner.publicKey, oldProducer: pda,
        newDeviceId: newDevice.publicKey, newProducer: newPda, vault: null,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY, systemProgram: SystemProgram.programId })
      .instruction();
    const tx = new Transaction().add(ed25519Ix(msg, newDevice), ix);
    await provider.sendAndConfirm(tx, [owner]);

    // Старая запись → revoked + rotated_to.
    const old = await program.account.energyProducer.fetch(pda);
    assert.strictEqual(old.revoked, true);
    assert.deepStrictEqual(old.state, STATE.Revoked);
    assert.strictEqual(old.rotatedTo.toBase58(), newDevice.publicKey.toBase58(), "rotated_to = новый ключ");

    // Новая запись наследует состояние (Active, тот же владелец).
    const np = await program.account.energyProducer.fetch(newPda);
    assert.deepStrictEqual(np.state, STATE.Active, "новая запись Active (наследование state)");
    assert.strictEqual(np.authority.toBase58(), owner.publicKey.toBase58(), "authority сохранён");
    assert.strictEqual(np.revoked, false, "новая запись не отозвана");
    assert.strictEqual(np.deviceId.toBase58(), newDevice.publicKey.toBase58(), "device_id = новый ключ");
  });

  it("6. rotate: подпись не того нового ключа → отклоняется", async () => {
    const d = Keypair.generate();
    const pda = await registerToActive(d, owner);
    const claimedNew = Keypair.generate(); // заявляемый новый ключ
    const newPda = producerPda(claimedNew.publicKey);
    const fakeNew = Keypair.generate();

    const nonce = new BN(2);
    const ts = nowTs();
    // Подпись ДРУГОГО ключа, хотя заявляется claimedNew.
    const msg = rotateMessage(claimedNew.publicKey, owner.publicKey, nonce, ts);
    const sig = Array.from(nacl.sign.detached(msg, fakeNew.secretKey));

    const ix = await program.methods.rotateDeviceKey(claimedNew.publicKey, sig, nonce, ts)
      .accounts({ authority: owner.publicKey, oldProducer: pda,
        newDeviceId: claimedNew.publicKey, newProducer: newPda, vault: null,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY, systemProgram: SystemProgram.programId })
      .instruction();
    const tx = new Transaction().add(ed25519Ix(msg, fakeNew), ix);

    await assert.rejects(provider.sendAndConfirm(tx, [owner]), /Ed25519 verification failed/);
  });

  it("7. rotate: не-владелец не может ротировать (Unauthorized)", async () => {
    const d = Keypair.generate();
    const pda = await registerToActive(d, owner);
    const claimedNew = Keypair.generate(); // заявляемый новый ключ
    const newPda = producerPda(claimedNew.publicKey);

    const nonce = new BN(2);
    const ts = nowTs();
    const msg = rotateMessage(claimedNew.publicKey, owner.publicKey, nonce, ts);
    const sig = Array.from(nacl.sign.detached(msg, claimedNew.secretKey));

    const ix = await program.methods.rotateDeviceKey(claimedNew.publicKey, sig, nonce, ts)
      .accounts({ authority: stranger.publicKey, oldProducer: pda,
        newDeviceId: claimedNew.publicKey, newProducer: newPda, vault: null,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY, systemProgram: SystemProgram.programId })
      .instruction();
    const tx = new Transaction().add(ed25519Ix(msg, claimedNew), ix);

    await assert.rejects(provider.sendAndConfirm(tx, [stranger]), /Unauthorized/);
  });
});
