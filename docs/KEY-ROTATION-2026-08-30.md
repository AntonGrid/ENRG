# Key Rotation — operational rollout (2026-08-30, P0-1a)

The founder key leaked at `d3664c1` (base58 `6gM2…`) is **compromised and
retired**. All protocol keys were rotated. This document is the rollout log
and the operator instructions for the live services.

## New keys

Generated at `~/keys/enrg-mainnet` (0600, outside the repo; never commit):

| Role | Public key | Where wired |
|---|---|---|
| founder / deployer | `FnqKH4bjMRM6hzrw6tjcpfyszovbRsvyNjuNwALmcZNC` | program constants, oracle, firmware |
| deployer (upgrade auth) | `H3tXm4ZHzNPKotuV7QbWjvd5Bjvv2ATmkvp35z7L7ixM` | Solana program upgrade authority |
| oracle (report) | `HC8WasTjgWYtdqmo9CFMo4EFbxibxSXjXHsRyse2FX77` | OracleRegistry on-chain |
| oracle-tx | `Hm7Ym7EFhJXcYnsGimHRHrmbJyHzY2sZVgA7CHrrEs4C` | tx signing (optional split) |
| firmware (cold OTA) | `D6dnErMYaAusxTtDRB5xeERGWeGNBn2cnGmheqbJx14q` | firmware `ENRG_FIRMWARE_PUBKEY_HEX` |

## Devnet — DONE (2026-08-30)

1. **Program upgraded** `HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb`
   with the freshly built `.so` (sha256 `4d8f9472…`); verified the on-chain
   binary matches the local build byte-for-byte.
2. **Upgrade authority** → `H3tXm4…` (new deployer key signed the change).
3. **New oracle key** `HC8Was…` added to the on-chain `OracleRegistry`
   (`add_oracle`, signed by the devnet founder authority `6gM2…`).
4. **IDL** on-chain updated to the 49-instruction build (includes
   `commit_contribution`).
5. `anchor test` → **59 passing** (local, with the rotated keys).

## Render — operator steps

The oracle on Render reads the keys from environment variables. Update and
redeploy:

| Variable | Old value | New value |
|---|---|---|
| `FOUNDER_KEY_PATH` | path to the old `founder-wallet.json` | path to the **new** `founder-wallet.json` (`FnqKH4…`) |
| `ORACLE_KEY_PATH` | path to the old oracle key | path to the **new** `oracle-keypair.json` (`HC8Was…`) |
| `FIRMWARE_SIGNING_KEY_PATH` | old firmware key | path to the **new** `firmware-signing-keypair.json` (`D6dnErM…`) |

> Prefer `*_KEY_PATH` (0600 files) over inline `*_KEY` envs. After the redeploy,
> check `GET /health` and `GET /api/v1/stats` — proofs must still mint (the
> new oracle key is already in the on-chain OracleRegistry).

## ESP32 firmware — operator steps

The new public keys are already compiled into the firmware
(`ENRG_FOUNDER_PUBKEY_HEX` = `dbc1…`, `ENRG_FIRMWARE_PUBKEY_HEX` = `b3bd…`).
To roll out:

```bash
cd firmware/esp32_proof_sender
# mainnet build (SE050-only) or dev build, as appropriate:
pio run -e esp32dev-mainnet -t upload        # fleet devices
pio run -e esp32dev -t upload                # dev units only
```

1. Reflash the fleet in batches (a device keeps its old `device_id` only if
   the SE050/NVS key is preserved — the SE050 keeps the key on-chip, so the
   `device_id` is stable; NVS devices keep their seed too).
2. If a device needs a NEW key, register it via the oracle
   (`POST /api/v1/device/register`) and the on-chain `register_device`.
3. Verify: `device_id` appears in `GET /api/v1/proofs` and mints succeed.

## Post-conditions

- The old founder key `6gM2…` must never sign mainnet operations.
- The old firmware key `393561…` must never sign OTA images.
- Consider `git filter-repo` to purge `founder-wallet.json` from history
  (owner-approved, impacts all clones).
