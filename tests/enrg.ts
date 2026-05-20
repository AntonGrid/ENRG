import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";

describe("ENRG Protocol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.EnrgMvp as Program<any>;

  let mint: PublicKey;
  let vaultPda: PublicKey;
  let producerPda: PublicKey;
  let buybackAccount: PublicKey;
  let stakingPool: PublicKey;
  let daoReserve: PublicKey;
  let emergencyFund: PublicKey;
  let userDestination: PublicKey;
  let vestingPda: PublicKey;
  let vestingVaultPda: PublicKey;
  let founderTokenAccount: PublicKey;

  const authority = (provider.wallet as anchor.Wallet).payer;
  const founder = authority;

  before(async () => {
    const airdropSig = await provider.connection.requestAirdrop(
      authority.publicKey,
      10_000_000_000
    );
    await provider.connection.confirmTransaction(airdropSig);

    [vaultPda] = await PublicKey.findProgramAddress(
      [Buffer.from("vault")],
      program.programId
    );

    mint = await createMint(
      provider.connection,
      authority,
      vaultPda,
      null,
      6
    );

    await program.methods
      .initializeVault()
      .accounts({
        vault: vaultPda,
        authority: authority.publicKey,
        mint,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    [producerPda] = await PublicKey.findProgramAddress(
      [Buffer.from("producer"), authority.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .createProducer(
        new PublicKey("11111111111111111111111111111111"),
        new anchor.BN(600_000_000)
      )
      .accounts({
        producer: producerPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    [buybackAccount] = await PublicKey.findProgramAddress(
      [Buffer.from("buyback"), mint.toBuffer()],
      program.programId
    );
    [stakingPool] = await PublicKey.findProgramAddress(
      [Buffer.from("staking"), mint.toBuffer()],
      program.programId
    );
    [daoReserve] = await PublicKey.findProgramAddress(
      [Buffer.from("dao"), mint.toBuffer()],
      program.programId
    );
    [emergencyFund] = await PublicKey.findProgramAddress(
      [Buffer.from("emergency"), mint.toBuffer()],
      program.programId
    );

    userDestination = await getAssociatedTokenAddress(mint, authority.publicKey);
    founderTokenAccount = await getAssociatedTokenAddress(mint, founder.publicKey);

    // Initialize founder vesting (contract creates vesting_vault automatically)
    [vestingPda] = await PublicKey.findProgramAddress(
      [Buffer.from("founder-vesting"), founder.publicKey.toBuffer()],
      program.programId
    );
    [vestingVaultPda] = await PublicKey.findProgramAddress(
      [Buffer.from("vesting-vault"), mint.toBuffer()],
      program.programId
    );

    await program.methods
      .initializeFounderVesting(new anchor.BN(200_000_000))
      .accounts({
        vesting: vestingPda,
        vestingVault: vestingVaultPda,
        mint,
        founder: founder.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([founder])
      .rpc();

    const preMintProof = {
      nonce: new anchor.BN(1),
      timestamp: new anchor.BN(Math.floor(Date.now() / 1000)),
      energyWh: new anchor.BN(100_000_000),
      signature: Array.from(Buffer.alloc(64)),
    };
    await program.methods
      .mintEnergy(preMintProof)
      .accounts({
        producer: producerPda,
        authority: authority.publicKey,
        vault: vaultPda,
        mint,
        destination: userDestination,
        buybackAccount,
        stakingPool,
        daoReserve,
        emergencyFund,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  });

  // ---- NEGATIVE SCENARIOS ----
  it("should reject zero energy mint", async () => {
    const proof = {
      nonce: new anchor.BN(100),
      timestamp: new anchor.BN(Math.floor(Date.now() / 1000)),
      energyWh: new anchor.BN(0),
      signature: Array.from(Buffer.alloc(64)),
    };
    try {
      await program.methods
        .mintEnergy(proof)
        .accounts({
          producer: producerPda,
          authority: authority.publicKey,
          vault: vaultPda,
          mint,
          destination: userDestination,
          buybackAccount,
          stakingPool,
          daoReserve,
          emergencyFund,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      assert.fail("Should have thrown error");
    } catch (err: any) {
      const errMsg = err.toString();
      assert.ok(
        errMsg.includes("ZeroAmountMint") ||
        errMsg.includes("overflow") ||
        errMsg.includes("zero") ||
        errMsg.includes("0x1771")
      );
    }
  });

  it("should reject mint with nonce not greater than previous", async () => {
    const proof1 = {
      nonce: new anchor.BN(200),
      timestamp: new anchor.BN(Math.floor(Date.now() / 1000)),
      energyWh: new anchor.BN(1_000_000),
      signature: Array.from(Buffer.alloc(64)),
    };
    await program.methods
      .mintEnergy(proof1)
      .accounts({
        producer: producerPda,
        authority: authority.publicKey,
        vault: vaultPda,
        mint,
        destination: userDestination,
        buybackAccount,
        stakingPool,
        daoReserve,
        emergencyFund,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const proof2 = { ...proof1 };
    try {
      await program.methods
        .mintEnergy(proof2)
        .accounts({
          producer: producerPda,
          authority: authority.publicKey,
          vault: vaultPda,
          mint,
          destination: userDestination,
          buybackAccount,
          stakingPool,
          daoReserve,
          emergencyFund,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      assert.fail("Should have thrown InvalidNonce");
    } catch (err: any) {
      assert.ok(err.toString().includes("InvalidNonce") || err.toString().includes("0x1774"));
    }
  });

  it("should reject excessive energy", async () => {
    const proof = {
      nonce: new anchor.BN(300),
      timestamp: new anchor.BN(Math.floor(Date.now() / 1000)),
      energyWh: new anchor.BN(100_000_001),
      signature: Array.from(Buffer.alloc(64)),
    };
    try {
      await program.methods
        .mintEnergy(proof)
        .accounts({
          producer: producerPda,
          authority: authority.publicKey,
          vault: vaultPda,
          mint,
          destination: userDestination,
          buybackAccount,
          stakingPool,
          daoReserve,
          emergencyFund,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      assert.fail("Should have thrown ExcessiveEnergy");
    } catch (err: any) {
      assert.ok(err.toString().includes("ExcessiveEnergy") || err.toString().includes("0x1773"));
    }
  });

  it("should mint with correct distribution", async () => {
    const energyWh = 10_000_000;
    const proof = {
      nonce: new anchor.BN(400),
      timestamp: new anchor.BN(Math.floor(Date.now() / 1000)),
      energyWh: new anchor.BN(energyWh),
      signature: Array.from(Buffer.alloc(64)),
    };

    const beforeUser = (await getAccount(provider.connection, userDestination)).amount;
    const beforeBuyback = (await getAccount(provider.connection, buybackAccount)).amount;
    const beforeStaking = (await getAccount(provider.connection, stakingPool)).amount;
    const beforeDao = (await getAccount(provider.connection, daoReserve)).amount;
    const beforeEmergency = (await getAccount(provider.connection, emergencyFund)).amount;

    await program.methods
      .mintEnergy(proof)
      .accounts({
        producer: producerPda,
        authority: authority.publicKey,
        vault: vaultPda,
        mint,
        destination: userDestination,
        buybackAccount,
        stakingPool,
        daoReserve,
        emergencyFund,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const afterUser = (await getAccount(provider.connection, userDestination)).amount;
    const afterBuyback = (await getAccount(provider.connection, buybackAccount)).amount;
    const afterStaking = (await getAccount(provider.connection, stakingPool)).amount;
    const afterDao = (await getAccount(provider.connection, daoReserve)).amount;
    const afterEmergency = (await getAccount(provider.connection, emergencyFund)).amount;

    const userGot = afterUser - beforeUser;
    const buybackGot = afterBuyback - beforeBuyback;
    const stakingGot = afterStaking - beforeStaking;
    const daoGot = afterDao - beforeDao;
    const emergencyGot = afterEmergency - beforeEmergency;

    const totalMint = Math.floor(energyWh / 1_000_000);
    const expectedUser = Math.floor(totalMint * 85 / 100);
    const commission = totalMint - expectedUser;
    const expectedBuyback = Math.floor(commission * 20 / 100);
    const expectedStaking = Math.floor(commission * 40 / 100);
    const expectedDao = Math.floor(commission * 30 / 100);
    const expectedEmergency = commission - expectedBuyback - expectedStaking - expectedDao;

    assert.equal(Number(userGot), expectedUser);
    assert.equal(Number(buybackGot), expectedBuyback);
    assert.equal(Number(stakingGot), expectedStaking);
    assert.equal(Number(daoGot), expectedDao);
    assert.equal(Number(emergencyGot), expectedEmergency);
  });

  it("should burn tokens from buyback account", async () => {
    const buybackBefore = (await getAccount(provider.connection, buybackAccount)).amount;
    const burnAmount = 2;
    await program.methods
      .buybackAndBurn(new anchor.BN(burnAmount))
      .accounts({
        mint,
        buybackAccount,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    const buybackAfter = (await getAccount(provider.connection, buybackAccount)).amount;
    assert.equal(Number(buybackAfter), Number(buybackBefore) - burnAmount);
  });

  it("should stake tokens", async () => {
    const stakeAmount = 10;
    const userBefore = (await getAccount(provider.connection, userDestination)).amount;
    assert.isAtLeast(Number(userBefore), stakeAmount, "Not enough balance to stake");

    const [stakeInfoPda] = await PublicKey.findProgramAddress(
      [Buffer.from("stake"), authority.publicKey.toBuffer()],
      program.programId
    );
    const [stakingVaultPda] = await PublicKey.findProgramAddress(
      [Buffer.from("staking-vault"), mint.toBuffer()],
      program.programId
    );

    await program.methods
      .stake(new anchor.BN(stakeAmount))
      .accounts({
        stakeInfo: stakeInfoPda,
        user: authority.publicKey,
        userTokenAccount: userDestination,
        stakingVault: stakingVaultPda,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const userAfter = (await getAccount(provider.connection, userDestination)).amount;
    const vaultBalance = (await getAccount(provider.connection, stakingVaultPda)).amount;
    assert.equal(Number(userAfter), Number(userBefore) - stakeAmount);
    assert.equal(Number(vaultBalance), stakeAmount);
  });

  it("should reject unstake with insufficient stake", async () => {
    const [stakeInfoPda] = await PublicKey.findProgramAddress(
      [Buffer.from("stake"), authority.publicKey.toBuffer()],
      program.programId
    );
    const [stakingVaultPda] = await PublicKey.findProgramAddress(
      [Buffer.from("staking-vault"), mint.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .unstake(new anchor.BN(100))
        .accounts({
          stakeInfo: stakeInfoPda,
          user: authority.publicKey,
          userTokenAccount: userDestination,
          stakingVault: stakingVaultPda,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();
      assert.fail("Should have thrown InsufficientStake");
    } catch (err: any) {
      assert.ok(
        err.toString().includes("InsufficientStake") ||
        err.toString().includes("0x1775")
      );
    }
  });

  // ---- VESTING TESTS ----
  it("should initialize founder vesting", async () => {
    const vestingAccount = await program.account.founderVesting.fetch(vestingPda);
    assert.equal(vestingAccount.totalAmount.toNumber(), 200_000_000);
    assert.equal(vestingAccount.founder.toBase58(), founder.publicKey.toBase58());
    assert.isAbove(vestingAccount.startTime.toNumber(), 0);

    // vesting_vault should exist and have 0 balance
    const vaultInfo = await getAccount(provider.connection, vestingVaultPda);
    assert.equal(Number(vaultInfo.amount), 0);
  });

  it("should not allow claim before cliff", async () => {
    try {
      await program.methods
        .claimVested()
        .accounts({
          vesting: vestingPda,
          vestingVault: vestingVaultPda,
          founderTokenAccount,
          founder: founder.publicKey,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([founder])
        .rpc();
      assert.fail("Should have thrown CliffNotReached");
    } catch (err: any) {
      assert.ok(
        err.toString().includes("CliffNotReached") ||
        err.toString().includes("0x1778")
      );
    }
  });
});
