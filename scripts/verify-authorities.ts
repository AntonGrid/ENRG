/**
 * ENRG — protocol authority inventory (READ-ONLY, no keypair required).
 *
 * Prints every on-chain authority that can move the protocol and FAILS (exit 1)
 * when a forbidden key still holds a role. This is the guard for the ADR-0007 key
 * ceremony: the founder key leaked in commit d3664c1 sits in the history of a
 * PUBLIC repository, so it must hold no role anywhere.
 *
 * It also prints the upgrade authorities of both programs (a leaked upgrade
 * authority can replace the program logic entirely) and the quorum / policy /
 * governance state, so one command answers "who can control the protocol?".
 *
 * Usage:
 *   npx ts-node scripts/verify-authorities.ts
 *   ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com npx ts-node scripts/verify-authorities.ts
 *
 * Env:
 *   ANCHOR_PROVIDER_URL          default https://api.devnet.solana.com
 *   FORBIDDEN_AUTHORITIES        comma-separated pubkeys that must hold NO role
 *                                (default: the leaked founder key)
 *   EXPECTED_ORACLE_REGISTRY_AUTHORITY / EXPECTED_ORACLE_ADMIN /
 *   EXPECTED_POLICY_AUTHORITY / EXPECTED_QUORUM_AUTHORITY /
 *   EXPECTED_VAULT_AUTHORITY / EXPECTED_GOVERNANCE_AUTHORITY /
 *   EXPECTED_UPGRADE_AUTHORITY   optional — asserted when provided
 *
 * Exit codes: 0 = clean, 1 = a forbidden key holds a role / an expectation
 * failed, 2 = the program is not deployed at this endpoint.
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { patchIdl } from "../tests/helpers/patch-idl";

/**
 * `target/` is gitignored, so a fresh CI checkout has no build output — the
 * authority guard could never run there (the job was red for that reason).
 * Load the build output first, then fall back to the bundled IDL
 * (`idls/enrg_mvp.json`, same address, same 58 instructions).
 */
function loadEnrgIdl(): any {
  const candidates = ["../target/idl/enrg_mvp.json", "../idls/enrg_mvp.json"];
  for (const rel of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(rel);
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(
    "ENRG IDL not found: run `anchor build` or restore idls/enrg_mvp.json"
  );
}

const rawIdl = loadEnrgIdl();

const ENRG_MVP_ID = new PublicKey("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");
const ENRG_PROFILE_ID = new PublicKey("78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt");
const BPF_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

const ENDPOINT = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";

/** Founder key leaked in commit d3664c1 of the public repository. */
const DEFAULT_FORBIDDEN = ["6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8"];

const FORBIDDEN = (process.env.FORBIDDEN_AUTHORITIES || DEFAULT_FORBIDDEN.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const EXPECTED: Record<string, string | undefined> = {
  "oracle-registry.authority": process.env.EXPECTED_ORACLE_REGISTRY_AUTHORITY,
  "oracle-registry.oracle_admin": process.env.EXPECTED_ORACLE_ADMIN,
  "policy-registry.authority": process.env.EXPECTED_POLICY_AUTHORITY,
  "oracle-quorum-config.authority": process.env.EXPECTED_QUORUM_AUTHORITY,
  "vault.authority": process.env.EXPECTED_VAULT_AUTHORITY,
  "governance.authority": process.env.EXPECTED_GOVERNANCE_AUTHORITY,
  "upgrade.enrg-mvp": process.env.EXPECTED_UPGRADE_AUTHORITY,
  "upgrade.enrg-profile": process.env.EXPECTED_UPGRADE_AUTHORITY,
};

const pda = (seed: string, program = ENRG_MVP_ID) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed)], program)[0];

const show = (k: PublicKey | null | undefined) => (k ? k.toBase58() : "—");

/** Upgrade authority of a program (BPF Upgradeable loader ProgramData layout). */
async function upgradeAuthority(
  connection: Connection,
  programId: PublicKey,
  getAccount: (key: PublicKey) => Promise<anchor.web3.AccountInfo<Buffer> | null>,
): Promise<{ programData: string; authority: string } | null> {
  const [programData] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_UPGRADEABLE,
  );
  const ai = await getAccount(programData);
  if (!ai || ai.data.length < 45 || ai.data[12] !== 1) return null;
  return {
    programData: programData.toBase58(),
    authority: new PublicKey(ai.data.slice(13, 45)).toBase58(),
  };
}

async function main(): Promise<void> {
  // Print the endpoint BEFORE any RPC call: on failure the operator must see
  // which cluster was actually queried (e.g. an ANCHOR_PROVIDER_URL from the
  // shell profile pointing at a stopped local validator).
  console.log(`\nENRG authority inventory @ ${ENDPOINT}`);
  console.log("─".repeat(78));

  const connection = new Connection(ENDPOINT, "confirmed");

  /** getAccountInfo with 3 attempts (public RPC endpoints throttle bursts). */
  const getAccount = async (key: PublicKey) => {
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        return await connection.getAccountInfo(key);
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    throw lastErr;
  };

  const coder = new anchor.BorshCoder(patchIdl(rawIdl));

  const programInfo = await getAccount(ENRG_MVP_ID);
  if (!programInfo) {
    console.error(`enrg-mvp is NOT deployed at ${ENDPOINT}`);
    process.exit(2);
  }

  const decode = async (name: string, seed: string): Promise<any | null> => {
    const ai = await getAccount(pda(seed));
    if (!ai) return null;
    try {
      return coder.accounts.decode(name, ai.data);
    } catch (e) {
      console.warn(`[warn] could not decode ${name}: ${(e as Error).message}`);
      return null;
    }
  };

  const registry = await decode("OracleRegistry", "oracle-registry");
  const policy = await decode("PolicyRegistry", "policy-registry");
  const quorum = await decode("OracleQuorumConfig", "oracle-quorum-config");
  const vault = await decode("Vault", "vault");
  const governance = await decode("GovernanceState", "governance");

  const upMvp = await upgradeAuthority(connection, ENRG_MVP_ID, getAccount);
  const upProfile = await upgradeAuthority(connection, ENRG_PROFILE_ID, getAccount);

  const roles: Array<[string, string]> = [
    ["oracle-registry.authority", show(registry?.authority)],
    ["oracle-registry.oracle_admin", show(registry?.oracle_admin)],
    ["policy-registry.authority", show(policy?.authority)],
    ["oracle-quorum-config.authority", show(quorum?.authority)],
    ["vault.authority", show(vault?.authority)],
    ["governance.authority", show(governance?.authority)],
    ["upgrade.enrg-mvp", upMvp?.authority ?? "—"],
    ["upgrade.enrg-profile", upProfile?.authority ?? "—"],
  ];

  /** Anchor 1.x IDLs decode with snake_case fields; never crash on a rename. */
  const num = (v: unknown) => (v === undefined || v === null ? "?" : String(v));

  for (const [role, who] of roles) {
    const bad = FORBIDDEN.includes(who);
    console.log(`${bad ? "BANNED" : "  ok  "} ${role.padEnd(32)} ${who}`);
  }
  console.log("─".repeat(78));

  if (quorum) {
    console.log(
      `quorum: required=${quorum.required} threshold=${quorum.threshold} ` +
        `reward_per_vote=${num(quorum.reward_per_vote)}`,
    );
  } else {
    console.log("quorum: NOT INITIALIZED (legacy single-oracle flow)");
  }
  if (policy) {
    console.log(
      `policy: mint_enabled=${policy.mint_enabled} whitelist=${policy.enforce_oracle_whitelist} ` +
        `state=${policy.enforce_device_state} tier=${policy.enforce_tier_limits} ` +
        `energy=${policy.enforce_energy_caps} supply=${policy.enforce_supply_cap} ` +
        `max_energy_bps=${num(policy.max_energy_bps)} v${num(policy.version)}`,
    );
  }
  if (registry) console.log(`oracles: ${(registry.oracles ?? []).length}`);
  if (vault) {
    console.log(
      `vault: total_supply=${num(vault.total_supply)} ` +
        `max_supply=${num(vault.max_supply)} proofs=${num(vault.total_proofs)}`,
    );
  }
  if (governance) {
    const members: any[] = governance.members ?? [];
    console.log(
      `governance: members=${members.length} proposals=${num(governance.proposal_count)}`,
    );
    for (const m of members) {
      const bad = FORBIDDEN.includes(m.toBase58());
      console.log(`${bad ? "BANNED" : "  ok  "} member ${m.toBase58()}`);
    }
  }

  // ── Verdict ──────────────────────────────────────────────────────────────
  const violations: string[] = [];
  for (const [role, who] of roles) {
    if (FORBIDDEN.includes(who)) {
      violations.push(`${role} is held by a FORBIDDEN key (${who})`);
    }
  }
  if (governance) {
    for (const m of governance.members ?? []) {
      if (FORBIDDEN.includes(m.toBase58())) {
        violations.push(`governance member is a FORBIDDEN key (${m.toBase58()})`);
      }
    }
  }

  const mismatches: string[] = [];
  for (const [role, expected] of Object.entries(EXPECTED)) {
    if (!expected) continue;
    const actual = roles.find(([r]) => r === role)?.[1];
    if (actual && actual !== expected) {
      mismatches.push(`${role}: expected ${expected}, got ${actual}`);
    }
  }

  console.log("─".repeat(78));
  if (violations.length === 0 && mismatches.length === 0) {
    console.log("OK — no forbidden key holds a protocol role");
    process.exit(0);
  }
  for (const v of violations) console.error(`VIOLATION ${v}`);
  for (const m of mismatches) console.error(`MISMATCH  ${m}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(`verify-authorities failed against ${ENDPOINT}:`, e?.message ?? e);
  if (/127\.0\.0\.1|localhost/.test(ENDPOINT)) {
    console.error(
      "HINT: ANCHOR_PROVIDER_URL points at a local validator. Export the cluster " +
        "explicitly, e.g. ANCHOR_PROVIDER_URL=https://api.devnet.solana.com " +
        "(~/.bashrc exports a localnet default).",
    );
  }
  process.exit(2);
});
