# ENRG Mainnet Runbook (P2-4)

**Owner:** protocol core team · **Preconditions:** audit blockers P0-1…P0-4 closed
(keys rotated, multisig ready, oracle queue/RPC-failover deployed, firmware
mainnet build available).

> One-off sequence. Every step produces a verification command. If a step
> fails, stop and fix — do not proceed to the next.

## 0. Key ceremony (offline)

| Key | Owner | Action |
|---|---|---|
| founder/deployer | cold wallet | generate fresh; store in HSM/KMS; update `constants.rs` + rebuild |
| oracle report key | oracle ops | generate; `ORACLE_KEY_PATH` 0600 |
| oracle tx key | oracle ops | optional separate key |
| firmware cold key | firmware owner | generate; `FIRMWARE_SIGNING_KEY_PATH`; embed pubkey in firmware build |
| Squads multisig | guardians | create 3-of-5; `SQUADS_PUBKEY` |

Verify: `solana-keygen pubkey <each-key>.json` prints the expected addresses;
no key ever appears in git/logs/CI (gitleaks enforced).

## 1. Program build & audit

```bash
cd ENRG
anchor build                       # enrg_mvp.so
cargo build-sbf --manifest-path programs/enrg-profile/Cargo.toml
sha256sum target/deploy/enrg_mvp.so programs/enrg-profile/target/deploy/enrg_profile.so
cargo test -p enrg-mvp && npx mocha 'tests/*.test.js' && pytest -q
```
Send the `.so` + IDL to the external auditor; ship only the audited hash.

## 2. Solana mainnet deploy

```bash
solana config set --url https://api.mainnet-beta.solana.com
solana program deploy --program-id <NEW_PROGRAM_ID> target/deploy/enrg_mvp.so
solana program deploy --program-id <NEW_PROFILE_ID> programs/enrg-profile/target/deploy/enrg_profile.so
# upgrade authority -> Squads multisig
spl program set-upgrade-authority <NEW_PROGRAM_ID> <SQUADS_PUBKEY>
anchor idl init --filepath target/idl/enrg_mvp.json <NEW_PROGRAM_ID>
```

## 3. Protocol bootstrap (founder key, once)

```bash
npx ts-node scripts/init-mint.ts          # token, vault, funds, mint-authority
npx ts-node scripts/setup-oracle.ts       # oracle registry
# founder premine + vesting + governance (founder key):
RPC_ENDPOINT=https://api.mainnet-beta.solana.com npx ts-node scripts/devnet_e2e_lifecycle.ts
# transfer authorities to the multisig:
AUTHORITY_KEY_PATH=... SQUADS_PUBKEY=... GOVERNANCE_MEMBERS=... \
  npx ts-node scripts/transfer-authorities-to-squads.ts
```

## 4. Oracle deployment

```bash
# env (never inline secrets):
export RPC_ENDPOINTS="https://mainnet.helius-rpc.com,https://api.mainnet-beta.solana.com"
export FOUNDER_KEY_PATH=/secure/founder-wallet.json     # or removed after bootstrap
export ORACLE_KEY_PATH=/secure/oracle-keypair.json
export FIRMWARE_SIGNING_KEY_PATH=/secure/firmware-keypair.json
export DATABASE_URL=postgres://...                     # managed Postgres, backups
export MINT_QUEUE_MAX=10000 MINT_MAX_ATTEMPTS=8 DEVICE_MIN_INTERVAL_MS=0
docker compose up -d oracle
```
Health: `GET /health`; watch `GET /api/v1/stats` (minted vs accepted);
alert on `mint_status='deferred'` spikes and RPC failover log lines.

## 5. Firmware

```bash
cd firmware/esp32_proof_sender
pio run -e esp32dev-mainnet     # SE050-only build
# manufacturing: burn SECURE_BOOT_EN, FLASH_CRYPT_EN, DIS_USB_JTAG; SCP03 on SE050
```
Fleet rollout in batches; verify `device_id` stable across reboots and proofs
appear in `/api/v1/proofs`.

## 6. AI layer

```bash
# ENRG-AI signals cron (gh-pages) — already in .github/workflows/signals.yml
# ERS collector on a scheduler (every 6h):
RPC_ENDPOINT=... ORACLE_KEY_PATH=... AXIS_AI_SIGNING_PUBKEY=... \
  node_modules/.bin/ts-node scripts/ai_ers_collector.ts
```

## 7. Go/no-go checklist

- [ ] External audit passed; deployed hash == audited hash.
- [ ] All authorities on the multisig (verified on-chain).
- [ ] Oracle: Postgres, ≥2 RPC, alerting, queue metrics.
- [ ] Firmware: mainnet build on a test fleet for 1 week.
- [ ] `MAINNET-CHECKLIST.md` fully checked.
