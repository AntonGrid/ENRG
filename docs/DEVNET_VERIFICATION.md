# Devnet Verification Report

**Document updated:** 2026-08-17 (финальный деплой по итогам аудита — ШАГ 1)

---

## 0. FINAL DEPLOY — 2026-08-17 (финальные бинарники после закрытия P0-блокеров)

**Исходное состояние:** на Devnet была развёрнута версия коммита `4dc805a`
(756 128 байт для enrg-mvp), не включающая финальные P0-фиксы
(`59d43c3`, `61e6faa`: Policy Engine ADR-0003, rotate/revoke ключей ADR-0007,
`revoked`/`rotated_to` в EnergyProducer и др. — суммарно +1254 строки).

**Что сделано (2026-08-17):**

1. Пересборка финальных бинарников из HEAD (`61e6faa`):
   - `anchor build` → `target/deploy/enrg_mvp.so` (807 176 байт,
     sha256 `b9c1dba556362e14d8a734bd4d14ae7e47d886cbf12edd0af78e8d24c828934e`);
   - `cargo build-sbf --manifest-path programs/enrg-profile/Cargo.toml` →
     `programs/enrg-profile/target/deploy/enrg_profile.so` (226 704 байта,
     sha256 `991e51f1287af7e38cea68395ac2b5a575476eef976a22f72f5e433a0c58be84`).
2. Деплой (upgrade in place, авторитет `GkdhQQg…` — локальный оператор):
   - **enrg_mvp**: `solana program deploy --program-id HkuC3… target/deploy/enrg_mvp.so`
     — потребовался рост programdata с 756 173 до 807 221 байт;
     programdata-аккаунт долит до rent-exempt нового размера (5.61914904 SOL).
     Слот деплоя **484848801**.
   - **enrg-profile**: `solana program deploy --program-id 78FUdpHn… programs/enrg-profile/target/deploy/enrg_profile.so`
     — аккаунт 234 496 байт (размер сохранён, бинарник записан с начала;
     первые 226 704 байта == локальному .so). Слот деплоя **484849385**.
3. IDL: `anchor idl upgrade --filepath target/idl/enrg_mvp.json HkuC3… --provider.cluster devnet`
   → IDL-аккаунт `BwMKxYtzQ87VDvhqyy3GCULLPeCgGAmnwd2jXLVSmuxP` (37 120 байт) обновлён
   (48 инструкций, включая `update_policy`, `rotate_device_key`, `set_device_tier`,
   `initialize_policy_registry` и др.). IDL enrg-profile on-chain не хранится
   (используется локальный `idls/enrg_profile.json`, синхронизирован с исходником).

### Проверенные адреса (актуально)

| Роль | Адрес | Состояние |
|---|---|---|
| Program ID (enrg_mvp) | `HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb` | ✔ executable, BPFLoaderUpgradeable |
| ProgramData (enrg_mvp) | `ARg2GmnWHMPXaMwv5RYNVhTw4F2NZSoEFUkyT1pBLX8M` | ✔ 807 176 байт, слот 484848801 |
| Program ID (enrg-profile) | `78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt` | ✔ executable, BPFLoaderUpgradeable |
| ProgramData (enrg-profile) | `4bw9wRH6d4gDzMr6kNiNdbGyNAQ9N3pVPdL9WXs1Z79G` | ✔ 234 496 байт, слот 484849385 |
| Upgrade authority | `GkdhQQgUBi2Q422nTBP27LADkejijRwJEAnfhPYsUJSV` | ✔ локальный оператор (`~/.config/solana/id.json`) |
| Deployed binary (enrg_mvp) | sha256 `b9c1dba5…` | ✔ == локальная сборка HEAD |
| Deployed binary (enrg-profile) | sha256 `991e51f1…` (первые 226 704 байта) | ✔ == локальная сборка HEAD |
| IDL account (enrg_mvp) | `BwMKxYtzQ87VDvhqyy3GCULLPeCgGAmnwd2jXLVSmuxP` | ✔ owner == enrg_mvp, обновлён |

### E2E-тест (2026-08-17, `scripts/devnet_e2e_lifecycle.ts`)

Запуск:
```
RPC_ENDPOINT=https://api.devnet.solana.com \
ENRG_PROGRAM_ID=HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb \
ENRG_PROFILE_PROGRAM_ID=78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt \
yarn ts-node scripts/devnet_e2e_lifecycle.ts
```

Результат: **exit 0 — E2E PASSED ✔** (49.75s)

| Шаг | Результат |
|---|---|
| bootstrap (token/vault/funds/oracle-registry/manifest-registry/config) | ✔ идемпотентно (аккаунты уже существовали) |
| add_oracle (новый Ed25519-оракул) | ✔ |
| register_device | ✔ |
| claim_device (owner = оператор) | ✔ |
| provision_device | ✔ |
| activate_device | ✔ |
| init_energy_profile | ✔ (профиль существовал) |
| update_metadata (rated_power) | ⚠️ пропущен — legacy профиль с rated_power=1e9 (> лимита 1 MW, иммутабельно M-4) |
| user ATA | ✔ |
| mint_energy (v0 + Address Lookup Table, 2× Ed25519, CPI record_production) | ✔ sig=`4kkPKZFphycXzM1cKpY3FsDDvG8p2RJiGY3NuSKW15vDcqhsGCq8F7Z5821o8ZuMFiUUhkSAZ1HiawSEQUwQHVAe` |
| Проверка: producer state=active, nonce=1, energy_wh=90000 | ✔ |
| Проверка: награда владельцу | ✔ user ATA `HbR9V23hUPqSRGguREgei94m8r5PcafSskRk6NZ5kCwK` = 36 raw units SRC; vault.total_supply 2e17+63 → 2e17+99 |

### Исправления по итогам E2E (2026-08-17)

1. **OracleRegistry.oracle_admin** был установлен в founder-кошелёк (`6gM2eE…`)
   старой инициализацией; E2E добавляет оракула от имени оператора (`GkdhQQg…`).
   → `set_oracle_admin(GkdhQQg…)` с подписью founder (tx `2qiT4zVz…`). Роль
   oracle_admin — административная, не сам оракул.
2. **E2E-скрипт** (`scripts/devnet_e2e_lifecycle.ts`): шаг `update_metadata`
   стал идемпотентным к существующему профилю владельца:
   - мощность 0 → задаётся `RATED_POWER` (1 MW);
   - мощность == `RATED_POWER` → идемпотентный повтор (type/location);
   - legacy-мощность ≤ 1 MW → повтор с прежней мощностью;
   - legacy-мощность > 1 MW (не валидна для нового кода) → пропуск с предупреждением.
   Это не меняет on-chain логику, а делает E2E пригодным для повторных прогонов
   на живом devnet с персистентными PDA.

### Оракул (2026-08-17)

- Перезапущен начисто (`node server.js`, RPC devnet, founder-ключ через
  `FOUNDER_KEY_PATH` — без `FOUNDER_KEY` в env, H-1 аудита соблюдён).
- Лог запуска: `✅ Loaded enrg_mvp IDL`, `🚀 Oracle server listening on port 3000`.
- `/health` → `{"status":"ok"}`; `/api/v1/stats` → `{"total_energy_mwh":0.02,"active_producers":6,…}`.
- ⚠️ `ORACLE_KEY_PATH` не задан — собственный HTTP-минт оракула недоступен
  (не влияет на E2E: он вызывает `mint_energy` напрямую своим сгенерированным
  оракулом из OracleRegistry).

---

## 1. Исторический отчёт (2026-08-13) — Governance & Vesting Chain (v7.1)

**Run:** `RPC_ENDPOINT=https://api.devnet.solana.com yarn ts-node scripts/devnet_verify_governance.ts`
**Mode:** verify-only (только чтение, без `sendTransaction`)
**Result:** **exit 0 — ALL CHECKS PASSED ✔**

### 1.1 Проверенные адреса

| Роль | Адрес | Результат |
|---|---|---|
| Program ID (enrg_mvp) | `HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb` | ✔ существует, executable, owner BPFLoaderUpgradeable |
| ProgramData | `ARg2GmnWHMPXaMwv5RYNVhTw4F2NZSoEFUkyT1pBLX8M` | ✔ layout ProgramData, slot `483455693` |
| Upgrade authority | `GkdhQQgUBi2Q422nTBP27LADkejijRwJEAnfhPYsUJSV` | ✔ совпадает с ожидаемым |
| Deployed binary | sha `6db33ae00784c342…` | ✔ == локальная сборка (`target/deploy/enrg_mvp.so`) |
| Vault PDA `[b"vault"]` | `2iU7aMr7baDPo4JHjxS9nQ1UGEs4YUfUbh6JUkxyURSG` | ✔ owner == program, authority == GkdhQQ…, `max_supply = 1e18` |
| TokenMint PDA `[b"token-mint"]` | `FMM79f7gcTvzPSodQEjRTxfmpXeXB4ryPStn8xciYaFN` | ✔ owner == program, декодируется текущим IDL, decimals=9 |
| SRC Mint `[b"src-mint"]` | `3PDsZUDQwgx1SV4dSTtyKDEoL9HYCdt4GN63UBYpLvwB` | ✔ SPL Token, decimals=9, mint-authority == PDA `[b"mint-authority"]` |
| Founder wallet | `6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8` | ATA `ADxgPYdZJCp2Jj9XbA32beKGwnbVMENAtxeFCfG8RECZ` ✔, баланс == 2e17 |
| Vesting (bootstrap) | `B5uSLeaX2keRGbkxZA1Tyb7dFwNpY7DUbVu8TgvdiMAh` | ✔ owner == program, len=88, founder/cliff/release корректны |
| Governance PDA `[b"governance"]` | `52WsktRAXpRaKAt2BCNZfXRBhp8MnU87HutXdSCsnHRn` | ✔ authority == GkdhQQ…, members=3 |

## 1.2 Подтверждённые инварианты (✔)

- RPC Devnet доступен (solana-core 4.2.0).
- Программа задеплоена, исполнитель — BPFLoaderUpgradeable, upgrade authority = `GkdhQQ…`.
- **`deployed binary == local build`** (SHA-256 `6db33ae…` совпадает).
- Vault: владелец — программа, `authority == GkdhQQ…`, **`max_supply == MAX_SUPPLY_ATOMIC (1e18)`**, `total_supply ≤ max_supply`.
- TokenMint: владелец — программа, декодируется текущим IDL (238 байт), `decimals == 9`,
  `mint == src-mint`, `mint_authority == [b"mint-authority"]`.
- SRC mint: `decimals == 9`, mint-authority == PDA, **`supply == vault.total_supply`** (оба = 2e17).
- Founder ATA существует, баланс == 2e17 (премайн), `vault.total_supply` учитывает премайн.
- Vesting: генезис/бootstrap-аккаунт на месте, `founder == FOUNDER_WALLET`,
  `total_amount == 2e17`, `cliff == 1y`, `release == 3y`, `start_time > 0`, `withdrawn ≤ vested`.
- Governance: PDA существует, `authority == GkdhQQ…`, `members` в границах 3..=5.
- Proposal-история: нет (счётчик = 0) — допустимо.
- `vault.total_supply ≤ MAX_SUPPLY_ATOMIC`, `src-mint.supply ≤ MAX_SUPPLY_ATOMIC`.

## 1.3 Что было сделано для актуализации Devnet (историческая справка)

1. **Блокер: vesting-генезис невозможно создать на devnet** (генезис-инъекция
   существует только у `solana-test-validator`; off-chain `createAccount` в PDA-адрес
   невозможен, нулевые данные → `AccountDiscriminatorMismatch 3002`).
   → Код-фикс `e455cb7`: `initialize_founder_vesting` получил bootstrap-путь
   (`init_if_needed` + seed `[b"founder-vesting"]`); genesis-путь сохранён.
2. **Блокер: старые аккаунты старой ревизии** (`vault.max_supply=1e9`,
   `token-mint` 205 байт, нет close/migrate) → невозможно переинициализировать
   при том же program id.
   → Стратегия A (одобрена автором): **новый program id** `HkuC3…` со свежими PDA.
3. Деплой: `solana program deploy` (slot `483455693`, authority `GkdhQQ…`).
4. Повторная инициализация: `scripts/devnet_reinit_lifecycle.ts` (token → vault →
   funds → премайн → vesting → governance) — **ALL OK**.
5. Повторный verify: **exit 0, все ✔** (этот документ).

## 1.4 Legacy

Старый program id `9rVoqWPSRQpMN8qbqD9DfMTUcs1qXDELZPF1eVGowsXF` архивирован
(старая ревизия: `vault.max_supply=1e9`, `token-mint` 205 байт, без
governance/vesting/премайна). Канонических ссылок нет; цепочка не удаляется,
но не используется.

*Полный вывод прогона — в терминале запуска (0 ✘, все ✔).*

