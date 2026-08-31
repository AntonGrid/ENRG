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
 *
 * Env:
 *   ORACLE_KEY_PATH      oracle keypair (REQUIRED for stake/attest/claim)
 *   ANCHOR_WALLET        founder keypair (only for init_oracle_quorum)
 *   ANCHOR_PROVIDER_URL  default https://api.devnet.solana.com
 */
import * as anchor from "@coral-xyz/anchor";
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
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as policy from "../policy";

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
  find("oracle-attest", [device.toBytes(), nonce.toArrayLike(Buffer, "le", 8)]);
const votePda = (attestation: PublicKey, oracle: PublicKey) =>
  find("oracle-vote", [attestation.toBytes(), oracle.toBytes()]);
const stakePda = (oracle: PublicKey) => find("oracle-stake", [oracle.toBytes()]);


async function main() {
  const cmd = process.argv[2];
  if (!cmd) {
    console.error("usage: oracle-quorum-ops.ts <stake|attest|claim|status|config> ...");
    process.exit(1);
  }
  const oracle = ["config", "init"].includes(cmd) ? null : loadKeypair(ORACLE_KEY_PATH, "oracle");
  const connection = new Connection(ENDPOINT, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(oracle ?? loadKeypair(WALLET_PATH, "founder")),
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(IDL, provider);

  const registry = find("oracle-registry");
  const configPda = find("oracle-quorum-config");

  switch (cmd) {
    case "config": {
      const cfg = await program.account.oracleQuorumConfig.fetch(configPda).catch(() => null);
      const reg = await program.account.oracleRegistry.fetch(registry);
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
      const oracleMsg = policy.buildOracleMessage(
        devicePk, Number(nonce), Number(devTs), Number(verifiedAt), Number(energyWh)
      );
      const proofHash = policy.proofHashOf(oracleMsg); // canonical SHA-256
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
      const att = await program.account.oracleAttestation.fetch(a);
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
      const mintPk = find("src-mint");
      const oracleAta = getAssociatedTokenAddressSync(mintPk, oracle!.publicKey);
      await program.methods
        .claimOracleReward()
        .accounts({
          oracleVote: votePda(attestation, oracle!.publicKey),
          attestation,
          oracleQuorumConfig: configPda,
          oracleSigner: oracle!.publicKey,
          tokenMint: find("token-mint"),
          stakingAccount: find("fund-staking"),
          oracleAta,
          mint: mintPk,
          vaultAuthority: find("vault"),
          tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        })
        .signers([oracle!])
        .rpc();
      console.log("✅ claimed reward for", attestation.toBase58());
      return;
    }

    case "status": {
      const [device, nonce] = process.argv.slice(3);
      if (!device || !nonce) {
        console.error("usage: status <device> <nonce>");
        process.exit(1);
      }
      const a = attestPda(new PublicKey(device), new anchor.BN(nonce));
      const att = await program.account.oracleAttestation.fetch(a).catch(() => null);
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

