# ENRG Mainnet Governance — Multi-Signature Setup (P0-4)

**Status:** ops playbook (audit 2026-08-30) · **Owner:** protocol core team

## Why

The current governance bootstrap is a single key: `EXPECTED_DEPLOYER` =
`FOUNDER_WALLET` (`programs/enrg-mvp/src/constants.rs:102`). ADR-0009 requires
a hybrid model (token voting + Guardians multisig + timelocks). Before mainnet
every protocol authority MUST move behind a multisig (Squads v4 on Solana).

## Authorities to transfer

| Role | Instruction | Current holder | Target |
|---|---|---|---|
| Vault authority (funds, admin ops) | `set_vault_authority` | founder | Squads multisig |
| Policy Registry authority | `set_policy_authority` | founder | Squads multisig |
| Oracle Registry authority | `set_oracle_authority` | founder | Squads multisig |
| Governance members | `update_members` | founder-chosen list | Squads members |

> The program-level `FOUNDER_WALLET`/`EXPECTED_DEPLOYER` constants stay as the
> **deploy-time** bootstrap identity. The protocol's *runtime* control must
> move to the multisig.

## Procedure

1. **Create the Squads multisig** (https://app.squads.so), e.g. 3-of-5
   Guardians. Record `SQUADS_PUBKEY`.
2. **Fund the multisig** with SOL (rent + tx fees for the transfer txs).
3. **Run the transfer script** (or execute each tx manually via Squads):

   ```bash
   RPC_ENDPOINT=https://api.mainnet-beta.solana.com \
   AUTHORITY_KEY_PATH=$HOME/.config/solana/founder-wallet.json \
   SQUADS_PUBKEY=<SquadsV4 address> \
   GOVERNANCE_MEMBERS=<member1>,<member2>,<member3>,<member4>,<member5> \
   npx ts-node scripts/transfer-authorities-to-squads.ts
   ```

4. **Verify on-chain** after each transfer (`spl governance` / anchor fetch):
   - `vault.authority == SQUADS_PUBKEY`
   - `policy_registry.authority == SQUADS_PUBKEY`
   - `oracle_registry.authority == SQUADS_PUBKEY`
   - `governance.members == [members…]`
5. **Rotate the founder key** (P0-1a) — after transfer the old key no longer
   controls the protocol; keep it only as the program-deploy bootstrap key
   until the program is redeployed with fresh constants.

## Upgrades

Program and IDL upgrades require the Squads multisig signature (upgrade
authority is `SQUADS_PUBKEY`).

1. Build and test locally: `anchor build && anchor test --skip-build`.
2. Upload the new binary (operator pays; buffer authority → Squads):

   ```bash
   solana program write-buffer -u <CLUSTER> --output json-compact \
     target/deploy/enrg_mvp.so > /tmp/buffer-info.json
   BUFFER=$(python3 -c "import json;print(json.load(open('/tmp/buffer-info.json'))['buffer'])")
   solana program set-buffer-authority -u <CLUSTER> --buffer "$BUFFER" \
     --new-buffer-authority <SQUADS_PUBKEY>
   ```

3. In Squads UI create a transaction: **Program → Upgrade**, args:
   `program_id = HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb`,
   `buffer = $BUFFER`, `spill = <operator>`; guardians sign and execute.
4. Update the IDL the same way (`anchor idl upgrade` with the multisig, or
   `solana program invoke` on the `Upgrade` instruction carrying the IDL).

> On devnet the upgrade authority is `H3tXm4Z…` (Squads); verify with
> `solana program show HkuC3FT… -u devnet`.

## Emergency

Squads supports an emergency (timelocked) flow: freeze minting
(`update_policy { mint_enabled: false }`), revoke a compromised device, or
pause the oracle registry. All critical operations require the multisig quorum.

## Related

- `MAINNET-CHECKLIST.md` (P0-4)
- ADR-0009 (Governance Protocol)
- `programs/enrg-mvp/src/instructions/{initialize,policy_engine,oracle_registry,governance}.rs`
