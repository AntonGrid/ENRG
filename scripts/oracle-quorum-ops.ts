#!/usr/bin/env node
/**
 * ENRG — oracle quorum operations (P3-6): stake, attest (vote), claim, status.
 *
 * An oracle operator uses this CLI to participate in the on-chain attestation
 * quorum: deposit a reputation stake, vote on a proof (submit_oracle_attestation
 * with the canonical SHA-256 proof hash), and claim SRC rewards for votes in
 * finalized attestations.
 *
 * Usage: npx ts-node scripts/oracle-quorum-ops.ts <command> [args]
 *   stake  <sol_amount>                     — deposit the oracle reputation stake
 *   attest <device> <nonce> <device_ts> <verified_at> <energy_wh>
 *                                          — vote on a report (canonical proof hash)
 *   claim  <attestation>                    — claim SRC reward for this oracle's vote
 *   status <device> <nonce>                 — show the attestation state
 *   config                                  — show the OracleQuorumConfig
 *   init <true|false> [threshold] [reward]  — init the quorum config (registry authority)
 *   set-required <true|false> [threshold] [reward]
 *                                          — flip mint gate / reward (config authority)
 *
 * Env:
 *   ORACLE_KEY_PATH      oracle keypair (REQUIRED for stake/attest/claim)
 *   ANCHOR_WALLET        founder keypair (only for init_oracle_quorum)
 *   ANCHOR_PROVIDER_URL  default https://api.devnet.solana.com
 */
import * as anchor from "@coral-xyz/anchor";
import type { AccountClient, IdlAccounts } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import fs from "fs";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { EnrgMvp } from "../target/types/enrg_mvp";
import * as policy from "../policy";

const PROGRAM_ID = new PublicKey("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");

type OracleAttestation = IdlAccounts<EnrgMvp>["oracleAttestation"];
type OracleQuorumConfig = IdlAccounts<EnrgMvp>["oracleQuorumConfig"];
type OracleRegistry = IdlAccounts<EnrgMvp>["oracleRegistry"];

const ENDPOINT = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const ORACLE_KEY_PATH = process.env.ORACLE_KEY_PATH || "";
const WALLET_PATH =
  process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/founder-wallet.json`;
const IDL = JSON.parse(fs.readFileSync("idls/enrg_mvp.json", "utf8"));
IDL.address = "HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb";

function loadKeypair(p: string, label: string): Keypair {
  if (!p || !fs.existsSync(p)) {
    throw new Error(
      `${label} keypair not found at ${p} (set ${label === "oracle" ? "ORACLE_KEY_PATH" : "ANCHOR_WALLET"})`
    );
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

const find = (seed: string, extra: Buffer[] = []): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...extra],
    new PublicKey("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb")
  )[0];

const attestPda = (device: PublicKey, nonce: anchor.BN) =>
  find("oracle-attest", [Buffer.from(device.toBytes()), nonce.toArrayLike(Buffer, "le", 8)]);
const votePda = (attestation: PublicKey, oracle: PublicKey) =>
  find("oracle-vote", [Buffer.from(attestation.toBytes()), Buffer.from(oracle.toBytes())]);
const stakePda = (oracle: PublicKey) => find("oracle-stake", [Buffer.from(oracle.toBytes())]);

/** OracleVote account layout (8 discriminator + 32+32+32+8+1). */
const ORACLE_VOTE_SIZE = 8 + 32 + 32 + 32 + 8 + 1;

/** Claim the SRC reward for one finalized attestation (creates the ATA if needed). */
async function claimReward(
  program: anchor.Program,
  connection: Connection,
  oracle: Keypair,
  attestation: PublicKey
) {
  const mintPk = find("src-mint");
  const oracleAta = getAssociatedTokenAddressSync(mintPk, oracle.publicKey);
  // The staking fund is the VAULT-owned ATA of the [b"fund-staking"] PDA.
  const stakingAta = getAssociatedTokenAddressSync(mintPk, find("fund-staking"), true);
  if (!(await connection.getAccountInfo(oracleAta))) {
    const ix = createAssociatedTokenAccountInstruction(oracle.publicKey, oracleAta, oracle.publicKey, mintPk);
    await anchor.web3.sendAndConfirmTransaction(connection, new anchor.web3.Transaction().add(ix), [oracle]);
  }
  await program.methods
    .claimOracleReward()
    .accounts({
      oracleVote: votePda(attestation, oracle.publicKey),
      attestation,
      oracleQuorumConfig: find("oracle-quorum-config"),
      oracleSigner: oracle.publicKey,
      tokenMint: find("token-mint"),
      stakingAccount: stakingAta,
      oracleAta,
      mint: mintPk,
      stakingAuthority: find("fund-staking"),
      tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    })
    .signers([oracle])
    .rpc();
}



async function main() {
  const cmd = process.argv[2];
  if (!cmd) {
    console.error("usage: oracle-quorum-ops.ts <stake|attest|claim|claim-all|status|config|init|set-required> ...");
    process.exit(1);
  }
  const oracle = ["config", "init", "set-required"].includes(cmd)
    ? null
    : loadKeypair(ORACLE_KEY_PATH, "oracle");
  const connection = new Connection(ENDPOINT, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(oracle ?? loadKeypair(WALLET_PATH, "founder")),
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(IDL, provider);

  // Typed account clients bound to the generated IDL (target/types/enrg_mvp.ts).
  // The `methods` namespace stays untyped (loose) to match the dynamic IDL
  // load; the account fetches below get the real generated types.
  type AccountNamespace = {
    [K in keyof IdlAccounts<EnrgMvp>]: AccountClient<EnrgMvp, K>;
  };
  const accounts = program.account as unknown as AccountNamespace;

  const registry = find("oracle-registry");
  const configPda = find("oracle-quorum-config");

  switch (cmd) {
    case "config": {
      const cfg = await accounts.oracleQuorumConfig.fetch(configPda).catch(() => null);
      const reg = await accounts.oracleRegistry.fetch(registry);
      if (!cfg) {
        console.log("OracleQuorumConfig: NOT INITIALIZED (legacy single-oracle flow).");
      } else {
        console.log(
          "required:", cfg.required, "| threshold:", cfg.threshold,
          "| reward_per_vote:", cfg.rewardPerVote.toString(), "| authority:", cfg.authority.toBase58()
        );
      }
      console.log("oracles:", reg.oracles.map((o: PublicKey) => o.toBase58()).join(", "));
      return;
    }

    case "init": {
      const [required, threshold, reward] = process.argv.slice(3);
      await program.methods
        .initOracleQuorum(
          required === "true",
          threshold ? Number(threshold) : 2,
          new anchor.BN(reward || 0)
        )
        .accounts({
          oracleQuorumConfig: configPda,
          oracleRegistry: registry,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("✅ OracleQuorumConfig initialized:", required, "/ threshold", threshold || 2, "/ reward", reward || 0);
      return;
    }

    case "set-required": {
      const [required, threshold, reward] = process.argv.slice(3);
      await program.methods
        .setOracleQuorum(
          required === "true",
          threshold ? Number(threshold) : 2,
          new anchor.BN(reward || 0)
        )
        .accounts({
          oracleQuorumConfig: configPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("✅ set_oracle_quorum: required =", required, "| threshold =", threshold || 2, "| reward =", reward || 0);
      return;
    }

    case "stake": {
      const sol = parseFloat(process.argv[3] || "1");
      await program.methods
        .stakeOracle(new anchor.BN(Math.floor(sol * 1e9)))
        .accounts({
          oracleStake: stakePda(oracle!.publicKey),
          oracleRegistry: registry,
          oracleSigner: oracle!.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([oracle!])
        .rpc();
      console.log("✅ staked", sol, "SOL on", oracle!.publicKey.toBase58());
      return;
    }

    case "attest": {
      const [device, nonce, devTs, verifiedAt, energyWh] = process.argv.slice(3);
      if (!device || !nonce || !devTs || !verifiedAt || !energyWh) {
        console.error("usage: attest <device> <nonce> <device_ts> <verified_at> <energy_wh>");
        process.exit(1);
      }
      const devicePk = new PublicKey(device);
      const nonceBN = new anchor.BN(nonce);
      // Canonical proof hash MUST come from DEVICE data (identical across
      // oracles) — NOT from the oracle message (verified_at differs per oracle).
      const deviceMsg = policy.buildDeviceMessage(
        devicePk, Number(nonce), Number(devTs), Number(energyWh)
      );
      const proofHash = policy.proofHashOf(deviceMsg); // canonical SHA-256
      const msg = policy.buildAttestMessage(devicePk, Number(nonce), proofHash);
      const signature = nacl.sign.detached(msg, oracle!.secretKey);

      const a = attestPda(devicePk, nonceBN);
      await program.methods
        .submitOracleAttestation(nonceBN, Array.from(proofHash), Array.from(signature))
        .accounts({
          attestation: a,
          vote: votePda(a, oracle!.publicKey),
          deviceId: devicePk,
          oracle: oracle!.publicKey,
          oracleRegistry: registry,
          oracleStake: stakePda(oracle!.publicKey),
          oracleQuorumConfig: configPda,
          payer: oracle!.publicKey,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          Ed25519Program.createInstructionWithPublicKey({
            publicKey: oracle!.publicKey.toBytes(),
            message: msg,
            signature,
          }),
        ])
        .signers([oracle!])
        .rpc();
      const att = await accounts.oracleAttestation.fetch(a);
      console.log(
        "✅ attestation", a.toBase58(), "| votes:", att.votes,
        "| finalized:", att.finalized, "| conflict:", att.conflict
      );
      return;
    }

    case "claim": {
      const attestation = new PublicKey(process.argv[3] || "");
      if (attestation.equals(PublicKey.default)) {
        console.error("usage: claim <attestation_pubkey>");
        process.exit(1);
      }
      await claimReward(program, connection, oracle!, attestation);
      console.log("✅ claimed reward for", attestation.toBase58());
      return;
    }

    case "claim-all": {
      // Batch reward claim: find every OracleVote of this oracle via GPA
      // (memcmp on the first account field, offset 8 past the discriminator),
      // and claim the ones whose attestation is FINALIZED and not yet claimed.
      const votes = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          { dataSize: ORACLE_VOTE_SIZE },
          { memcmp: { offset: 8, bytes: oracle!.publicKey.toBase58() } },
        ],
      });
      let claimed = 0;
      let skipped = 0;
      let failed = 0;
      for (const { pubkey } of votes) {
        const vote = await accounts.oracleVote.fetch(pubkey).catch(() => null);
        if (!vote) { skipped++; continue; }
        if (vote.rewardClaimed) { skipped++; continue; }
        const att = await accounts.oracleAttestation
          .fetch(vote.attestation)
          .catch(() => null);
        if (!att || !att.finalized) { skipped++; continue; }
        try {
          await claimReward(program, connection, oracle!, vote.attestation);
          claimed++;
          console.log("  ✅ claimed", vote.attestation.toBase58());
        } catch (e: any) {
          failed++;
          console.warn("  ⚠️ claim failed:", vote.attestation.toBase58(), "-", e.message);
        }
      }
      console.log(`✅ claim-all: claimed=${claimed} skipped=${skipped} failed=${failed}`);
      return;
    }

    case "status": {
      const [device, nonce] = process.argv.slice(3);
      if (!device || !nonce) {
        console.error("usage: status <device> <nonce>");
        process.exit(1);
      }
      const a = attestPda(new PublicKey(device), new anchor.BN(nonce));
      const att = await accounts.oracleAttestation.fetch(a).catch(() => null);
      if (!att) {
        console.log("attestation", a.toBase58(), "— not found");
        return;
      }
      console.log(
        "attestation:", a.toBase58(), "| device:", att.deviceId.toBase58(),
        "| nonce:", att.nonce.toString(), "| votes:", att.votes,
        "| finalized:", att.finalized, "| conflict:", att.conflict,
        "| hash:", Buffer.from(att.proofHash).toString("hex").slice(0, 16) + "…"
      );
      return;
    }

    default:
      console.error("unknown command:", cmd);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});

