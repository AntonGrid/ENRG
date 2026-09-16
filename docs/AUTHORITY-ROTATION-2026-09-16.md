# Authority rotation — 2026-09-16 (P0 completion)

**Scope:** devnet program `HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb`.
**Reason:** the founder key leaked at commit `d3664c1`
(`6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8`) still held **four** on-chain roles
plus a governance seat, because the code had **no instruction to transfer those
roles** — the 2026-08-30 rotation covered the key material and `FOUNDER_WALLET`,
but three roles could not be moved at all.

## 1. On-chain state before (verified via RPC)

| Role | Holder |
|---|---|
| `oracle-registry.authority` | `6gM2…UN8` — leaked |
| `oracle-registry.oracle_admin` | `6gM2…UN8` — leaked |
| `policy-registry.authority` | `6gM2…UN8` — leaked |
| `oracle-quorum-config.authority` | `6gM2…UN8` — leaked |
| `governance.members[1]` | `6gM2…UN8` — leaked |
| `vault.authority`, `governance.authority` | `GkdhQQ…UJSV` (operator, not leaked) |
| `upgrade.enrg-mvp` | `H3tXm4…L7ixM` (rotated deployer) |
| `upgrade.enrg-profile` | `GkdhQQ…UJSV` (operator) |

Impact: the holder of the leaked key could call `add_oracle(<their key>)`,
`set_oracle_quorum(required=false)` (disable the mint gate) and `update_policy(…)`
(disable every `enforce_*` flag) — i.e. the demonstrated k-of-n guarantee was one
transaction away from being switched off.

## 2. Code changes (program upgrade)

Three roles had **no setter** in the deployed binary (`grep '\.authority = '`
found only `vault` and `policy`) — so the upgrade was mandatory, both to evict the
leaked key now and to make ADR-0007 key rotation possible on mainnet at all:

| Instruction | Role | Gate |
|---|---|---|
| `set_oracle_registry_authority` | `OracleRegistry.authority` | current `registry.authority` |
| `set_quorum_authority` | `OracleQuorumConfig.authority` | current `config.authority` |
| `set_governance_authority` | `GovernanceState.authority` | current `governance.authority` |

All three emit `*AuthorityChanged { old, new, changed_by }`, are single-step
(two-step would need an account-layout migration) and are registered in `lib.rs`.
Covered by `cargo test -p enrg-mvp` (host) and by the on-chain execution below.

Also added: `scripts/verify-authorities.ts` (read-only guard) and
`scripts/rotate-authorities.ts` (DRY_RUN-capable ceremony driver).

## 3. Executed

| Step | Transaction |
|---|---|
| `solana program extend` +40960 bytes | (rent top-up for the larger binary) |
| `anchor upgrade` (deployer `H3tXm4…`) | `487DLZDW8GwMeZsZoGciRR6vPEErCX9tqsfso2eTUqFgSWe2VdSrkRyxnKq152RAW2xqhoX6uZTGCYUijTx6tcNx` |
| `set_oracle_admin` → `H3tXm4…` | `67G3Q9tvzwbGbW8uADfsvjCqpSktA4uCAZcpPcX7YiyWu8ZouTZZGXvWKHpccMsKyT7koTdng9cFzXR45fQX6KXt` |
| `set_oracle_registry_authority` → `H3tXm4…` | `4tpQmEqfAVMqpftcAJdyM1neEfed5cRwHE3xRtsPpEWhH4n3PGgXV27Z293yHifVou31GMo2oYHiTKSqyUuJhg9n` |
| `set_policy_authority` → `H3tXm4…` | `5Rb68fimBLB8PDbMkmZm812xh9Z83BTHEmnywwgw9ZAVXqvq6CGsjRpfH3MNDz9936fte97kDU5n85BNQi5kjQBB` |
| `set_quorum_authority` → `H3tXm4…` | `3szuyGPDZoyvjt9EaDTN9bBzHwXLkdUEVcAxnfbLpBLi6xpYp4negy7NMiksDiyKJ8vK2RadaFs8GQkYo6zhv8Qs` |
| `update_members [operator, deployer, governance-member]` | `Kc83y6UHoAA8CkFmzqaJ2qsNCz8Gf1e5wCc4GjjXoXrVuq2B4ArV7qCBV1PJaP2i8N5xtwu5uVdGPffWXY1aQQG` |

Order mattered: `set_oracle_admin` is gated by `registry.authority`, so the admin
had to move **before** the root authority.

The leaked key file `founder-wallet.json` was moved out of the repository to
`~/keys/retired/founder-wallet-LEAKED-6gM2-20260916.json` (mode 600) after the
last transaction needed it.

## 4. Verification

```
npx ts-node scripts/verify-authorities.ts        # exits 0
OK — no forbidden key holds a protocol role
```

Roles now: admin roles (`oracle-registry.authority`, `oracle_admin`,
`policy-registry.authority`, `oracle-quorum-config.authority`) → the **deployer**
key, deliberately **not** the founder key: `server.js` keeps the founder key in
the online oracle runtime, so runtime and administration are separated.

## 5. Follow-ups (mainnet)

1. Move all four roles + `vault.authority` + `governance.authority` to a **Squads
   multisig** at bootstrap (`scripts/transfer-authorities-to-squads.ts`).
2. `EXPECTED_DEPLOYER` (= `FOUNDER_WALLET`) still initializes fresh accounts on a
   new program id — point it at the multisig before the mainnet deploy, otherwise
   bootstrap recreates a single-key root.
3. Two-step (`pending_authority` + `accept`) instead of single-step needs an
   account-layout migration; tracked in `MAINNET-CHECKLIST.md`.
4. CI runs `scripts/verify-authorities.ts` on pushes to `main`
   (`.github/workflows/ci.yml`, job `authorities`).
