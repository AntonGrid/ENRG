/**
 * ENRG — rotate on-chain protocol authorities (ADR-0007 key ceremony).
 *
 * Every role is gated by the CURRENT holder of that role, so the signer for each
 * command is not a free choice: pass the keypair that holds the role being moved
 * via SIGNER_KEY_PATH.
 *
 * Commands (role of the signer in brackets):
 *   oracle-registry-authority <new>    [oracle_registry.authority]
 *   oracle-admin <new>                 [oracle_registry.authority]
 *   policy-authority <new>             [policy_registry.authority]
 *   quorum-authority <new>             [oracle_quorum_config.authority]
 *   governance-authority <new>         [governance.authority]
 *   governance-members k1,k2,k3        [governance.authority]  (3..=5 unique)
 *   vault-authority <new>              [vault.authority]
 *
 * Usage:
 *   SIGNER_KEY_PATH=~/keys/protocol-admin.json \
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   npx ts-node scripts/rotate-authorities.ts oracle-admin <NEW_PUBKEY>
 *
 * Env:
 *   SIGNER_KEY_PATH      keypair holding the role (REQUIRED)
 *   ANCHOR_PROVIDER_URL  default https://api.devnet.solana.com
 *   DRY_RUN=1            print the instruction (program, accounts, arg) and exit
 *
 * Notes:
 *   - `quorum-authority` / `oracle-registry-authority` / `governance-authority`
 *     require an UPGRADED program: those setters were added on 2026-09-16
 *     (the roles had no transfer instruction before).
 *   - After a successful rotation run `scripts/verify-authorities.ts`: it must
 *     print "OK — no forbidden key holds a protocol role".
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import rawIdl from "../target/idl/enrg_mvp.json";
import { patchIdl } from "../tests/helpers/patch-idl";

const PROGRAM_ID = new PublicKey("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");
const ENDPOINT = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const SIGNER_KEY_PATH = process.env.SIGNER_KEY_PATH || "";
const DRY_RUN = process.env.DRY_RUN === "1";

/** Keys that must never be (re)assigned a role (leaked in the public history). */
const FORBIDDEN = ["6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8"];

const find = (seed: string) => PublicKey.findProgramAddressSync([Buffer.from(seed)], PROGRAM_ID)[0];

const PDA = {
  oracleRegistry: find("oracle-registry"),
  policyRegistry: find("policy-registry"),
  quorumConfig: find("oracle-quorum-config"),
  governance: find("governance"),
  vault: find("vault"),
};

function usage(): never {
  console.error(
    [
      "usage: rotate-authorities.ts <command> [args]",
      "  oracle-registry-authority <new>",
      "  oracle-admin <new>",
      "  policy-authority <new>",
      "  quorum-authority <new>",
      "  governance-authority <new>",
      "  governance-members <k1,k2,k3>",
      "  vault-authority <new>",
      "",
      "Env: SIGNER_KEY_PATH (required), ANCHOR_PROVIDER_URL, DRY_RUN=1",
    ].join("\n"),
  );
  process.exit(2);
}

function parsePubkey(raw: string, label: string): PublicKey {
  try {
    return new PublicKey(raw);
  } catch {
    console.error(`invalid ${label}: ${raw}`);
    process.exit(2);
  }
}

function assertNotForbidden(key: PublicKey, label: string): void {
  if (FORBIDDEN.includes(key.toBase58())) {
    console.error(`refusing: ${label} is a FORBIDDEN (leaked) key: ${key.toBase58()}`);
    process.exit(2);
  }
  if (key.equals(PublicKey.default)) {
    console.error(`refusing: ${label} must not be the default pubkey`);
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const fs = await import("fs");
  const cmd = process.argv[2];
  if (!cmd) usage();
  if (!SIGNER_KEY_PATH || !fs.existsSync(SIGNER_KEY_PATH)) {
    console.error(`SIGNER_KEY_PATH not found: ${SIGNER_KEY_PATH || "(empty)"}`);
    console.error("Pass the keypair that CURRENTLY holds the role (its signature is the gate).");
    process.exit(2);
  }

  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(SIGNER_KEY_PATH, "utf8"))),
  );
  const connection = new Connection(ENDPOINT, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(signer), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const idl = patchIdl({ ...(rawIdl as any), address: PROGRAM_ID.toBase58() });
  const program: any = new anchor.Program(idl, provider);

  console.log(
    `rotate ${cmd} @ ${ENDPOINT} | signer=${signer.publicKey.toBase58()}` +
      (DRY_RUN ? " | DRY_RUN (nothing will be sent)" : ""),
  );

  /** Send (or print) one instruction. */
  const send = async (label: string, builder: any): Promise<void> => {
    if (DRY_RUN) {
      const ix = await builder.instruction();
      console.log(`[dry-run] ${label} -> ${ix.programId.toBase58()}`);
      ix.keys.forEach((k: any, i: number) =>
        console.log(
          `   [${i}] ${k.pubkey.toBase58()} signer=${k.isSigner} writable=${k.isWritable}`,
        ),
      );
      return;
    }
    const sig = await builder.rpc();
    console.log(`OK ${label}: ${sig}`);
  };

  switch (cmd) {
    case "oracle-registry-authority": {
      const next = parsePubkey(process.argv[3] || "", "new authority");
      assertNotForbidden(next, "new authority");
      await send(
        "set_oracle_registry_authority",
        program.methods
          .setOracleRegistryAuthority(next)
          .accounts({ registry: PDA.oracleRegistry, authority: signer.publicKey }),
      );
      return;
    }
    case "oracle-admin": {
      const next = parsePubkey(process.argv[3] || "", "new oracle_admin");
      assertNotForbidden(next, "new oracle_admin");
      await send(
        "set_oracle_admin",
        program.methods
          .setOracleAdmin(next)
          .accounts({ registry: PDA.oracleRegistry, authority: signer.publicKey }),
      );
      return;
    }
    case "policy-authority": {
      const next = parsePubkey(process.argv[3] || "", "new authority");
      assertNotForbidden(next, "new authority");
      await send(
        "set_policy_authority",
        program.methods
          .setPolicyAuthority(next)
          .accounts({ policyRegistry: PDA.policyRegistry, authority: signer.publicKey }),
      );
      return;
    }
    case "quorum-authority": {
      const next = parsePubkey(process.argv[3] || "", "new authority");
      assertNotForbidden(next, "new authority");
      await send(
        "set_quorum_authority",
        program.methods
          .setQuorumAuthority(next)
          .accounts({ oracleQuorumConfig: PDA.quorumConfig, authority: signer.publicKey }),
      );
      return;
    }
    case "governance-authority": {
      const next = parsePubkey(process.argv[3] || "", "new authority");
      assertNotForbidden(next, "new authority");
      await send(
        "set_governance_authority",
        program.methods
          .setGovernanceAuthority(next)
          .accounts({ governance: PDA.governance, authority: signer.publicKey }),
      );
      return;
    }
    case "governance-members": {
      const list = (process.argv[3] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => parsePubkey(s, "member"));
      if (list.length < 3 || list.length > 5) {
        console.error(`governance-members needs 3..=5 pubkeys (got ${list.length})`);
        process.exit(2);
      }
      const seen = new Set<string>();
      for (const m of list) {
        assertNotForbidden(m, "governance member");
        if (seen.has(m.toBase58())) {
          console.error(`duplicate member: ${m.toBase58()}`);
          process.exit(2);
        }
        seen.add(m.toBase58());
      }
      await send(
        "update_members",
        program.methods
          .updateMembers(list)
          .accounts({ governance: PDA.governance, authority: signer.publicKey }),
      );
      return;
    }
    case "vault-authority": {
      const next = parsePubkey(process.argv[3] || "", "new authority");
      assertNotForbidden(next, "new authority");
      await send(
        "set_vault_authority",
        program.methods
          .setVaultAuthority(next)
          .accounts({ vault: PDA.vault, authority: signer.publicKey }),
      );
      return;
    }
    default:
      usage();
  }
}

main().catch((e) => {
  console.error(`rotate-authorities failed against ${ENDPOINT}:`, e?.message ?? e);
  process.exit(1);
});
