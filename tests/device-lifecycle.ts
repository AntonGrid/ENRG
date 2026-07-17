import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

type EnrgMvp = any;

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

describe("ENRG Protocol — Device Lifecycle (ADR-0005)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.EnrgMvp as Program<EnrgMvp>;

  const authority = Keypair.generate();
  const operator = Keypair.generate();
  const otherWallet = Keypair.generate();
  const deviceKeypair = Keypair.generate();

  let devicePda: PublicKey;

  const airdrop = async (pubkey: PublicKey, amount: number = 10 * anchor.web3.LAMPORTS_PER_SOL) => {
    const sig = await provider.connection.requestAirdrop(pubkey, amount);
    await provider.connection.confirmTransaction(sig);
  };

  before(async () => {
    await airdrop(authority.publicKey);
    await airdrop(operator.publicKey);
    await airdrop(otherWallet.publicKey);
    await airdrop(deviceKeypair.publicKey);

    [devicePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("producer"), deviceKeypair.publicKey.toBytes()],
      program.programId
    );
  });

  it("1. Register Device — UNREGISTERED → REGISTERED", async () => {
    await program.methods
      .registerDevice(new anchor.BN(5000))
      .accounts({
        operator: operator.publicKey,
        producer: devicePda,
        deviceId: deviceKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([operator])
      .rpc();

    const producer = await program.account.energyProducer.fetch(devicePda);
    assert.deepStrictEqual(producer.state, STATE.Registered, "State should be Registered");
  });

  it("2. Claim Device — REGISTERED → CLAIMED", async () => {
    await program.methods
      .claimDevice()
      .accounts({ authority: authority.publicKey, producer: devicePda })
      .signers([authority])
      .rpc();

    const producer = await program.account.energyProducer.fetch(devicePda);
    assert.deepStrictEqual(producer.state, STATE.Claimed, "State should be Claimed");
  });

  it("3. Fail claim on already claimed", async () => {
    try {
      await program.methods
        .claimDevice()
        .accounts({ authority: otherWallet.publicKey, producer: devicePda })
        .signers([otherWallet])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert(err.message.includes("InvalidDeviceState") || err.message.includes("DeviceAlreadyClaimed"));
    }
  });

  it("4. Provision Device — CLAIMED → PROVISIONED", async () => {
    await program.methods
      .provisionDevice()
      .accounts({ authority: authority.publicKey, producer: devicePda })
      .signers([authority])
      .rpc();

    const producer = await program.account.energyProducer.fetch(devicePda);
    assert.deepStrictEqual(producer.state, STATE.Provisioned, "State should be Provisioned");
  });

  it("5. Fail provision from non-authority", async () => {
    try {
      await program.methods
        .provisionDevice()
        .accounts({ authority: otherWallet.publicKey, producer: devicePda })
        .signers([otherWallet])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert(err.message.includes("Unauthorized"));
    }
  });

  it("6. Activate Device — PROVISIONED → ACTIVE", async () => {
    await program.methods
      .activateDevice()
      .accounts({ authority: authority.publicKey, producer: devicePda })
      .signers([authority])
      .rpc();

    const producer = await program.account.energyProducer.fetch(devicePda);
    assert.deepStrictEqual(producer.state, STATE.Active, "State should be Active");
  });

  it("7. Quarantine Device — ACTIVE → QUARANTINE", async () => {
    await program.methods
      .quarantineDevice()
      .accounts({ authority: authority.publicKey, producer: devicePda })
      .signers([authority])
      .rpc();

    const producer = await program.account.energyProducer.fetch(devicePda);
    assert.deepStrictEqual(producer.state, STATE.Quarantine, "State should be Quarantine");
  });

  it("8. Release from Quarantine — QUARANTINE → ACTIVE", async () => {
    await program.methods
      .releaseFromQuarantine()
      .accounts({ authority: authority.publicKey, producer: devicePda })
      .signers([authority])
      .rpc();

    const producer = await program.account.energyProducer.fetch(devicePda);
    assert.deepStrictEqual(producer.state, STATE.Active, "State should be Active");
  });

  it("9. Revoke Device — ACTIVE → REVOKED", async () => {
    await program.methods
      .revokeDevice()
      .accounts({ authority: authority.publicKey, producer: devicePda })
      .signers([authority])
      .rpc();

    const producer = await program.account.energyProducer.fetch(devicePda);
    assert.deepStrictEqual(producer.state, STATE.Revoked, "State should be Revoked");
  });

  it("10. Fail transition from REVOKED", async () => {
    try {
      await program.methods
        .activateDevice()
        .accounts({ authority: authority.publicKey, producer: devicePda })
        .signers([authority])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert(err.message.includes("InvalidStateTransition"));
    }
  });
});
