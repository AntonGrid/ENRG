# ENRG — Актуальное состояние (STATE)

> **Единый источник правды** о текущем состоянии реализации протокола ENRG
> (Anchor 0.32, Solana) перед Devnet/mainnet.
>
> Все числовые значения ниже **сверены с исходным кодом** (`programs/enrg-mvp/src`)
> на момент фиксации. При любом расхождении между этим документом и кодом —
> источником истины является код, а документ должен быть обновлён.
>
> Кросс-ссылки: `docs/ENRG_Technical_Specification_v8.0.md`,
> `docs/protocol/blockchain/protocol-economics.md` и этот файл.

## 1. Обзор

**Реализовано (в коде `programs/enrg-mvp`):**

| Модуль | Статус | Основание |
|---|---|---|
| Токеномика SRC (mint, supply-лимиты, атомарные единицы) | ✅ Реализовано | `constants.rs`, `state/token_mint.rs`, `state/vault.rs` |
| Founder-премайн + vesting (cliff 1y / release 3y) | ✅ Реализовано | `instructions/init_founder.rs`, `instructions/vesting.rs`, `state/vesting.rs` |
| Governance MVP (ADR-0009) | ✅ Реализовано | `instructions/governance.rs`, `state/governance.rs` |
| Device-registry / device lifecycle (ADR-0002/0005) | ✅ Реализовано | `instructions/device_lifecycle.rs`, `state/owner_devices.rs` |
| Manifest registry / merkle verification | ✅ Реализовано | `instructions/manifest_registry.rs`, `manifest_verification.rs`, `merkle_proof_verification.rs` |
| Policy Engine (ADR-0003) | ⏸️ **СОЗНАТЕЛЬНО отложен** | Надстройка через upgrade-инструкцию; не блокирует релиз |
| Multisig для `set_vault_authority` / timelock-смен | ⏸️ Отложено (TODO(audit)) | `instructions/initialize.rs` |

Принцип эмиссии: post-premine эмиссия **только** через governance;
`mint-authority` = PDA `[b"mint-authority"]` и **не меняется**.

## 2. Адреса и роли

| Роль | Адрес | Где хранится ключ |
|---|---|---|
| Program ID (enrg_mvp) | `9rVoqWPSRQpMN8qbqD9DfMTUcs1qXDELZPF1eVGowsXF` | `declare_id!` в `lib.rs`; `Anchor.toml [programs.*]` |
| **Authority (Devnet/mainnet, оператор)** | `GkdhQQgUBi2Q422nTBP27LADkejijRwJEAnfhPYsUJSV` | **Локально**: `~/.config/solana/id.json` — НЕ в репозитории |
| **Founder wallet** (премайн, vesting) | `6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8` | **Локально**: `~/.config/solana/founder-wallet.json` — НЕ в репозитории |
| enrg-profile (CPI-цель) | `78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt` | `constants.rs::ENRG_PROFILE_PROGRAM_ID` |

PDA-адреса детерминированы (раздел 4) и в тестах/скриптах выводятся через
`PublicKey.findProgramAddressSync`, а не захардкожены.

> **Секреты.** Приватные ключи authority и founder НЕ в репозитории
> (`git ls-files` не содержит keypair; `deploy/`, `*.key` — в `.gitignore`).
> Deploy-ключи программ (`deploy/keys/*.json`) — локальные, не отслеживаются.

## 3. Константы (сверено с `constants.rs`)

Все суммы — **атомарные единицы** (1 SRC = `10^9` атомар = `SRC_DECIMALS=9`).

| Константа | Значение | Комментарий |
|---|---|---|
| `MAX_SUPPLY_ATOMIC` | `1_000_000_000_000_000_000` (1e18) | = 1 млрд SRC. `MAX_SUPPLY` — deprecated alias |
| `SRC_DECIMALS` | `9` | |
| `FOUNDER_ALLOCATION_ATOMIC` | `200_000_000_000_000_000` (2e17) | = 20% от MAX = 200M SRC |
| `FOUNDER_VESTING_CLIFF` | `365*24*60*60` = 1 год | Полностью заблокировано |
| `FOUNDER_VESTING_RELEASE` | `3*365*24*60*60` = 3 года | Линейный release (≈1/36 в месяц) |
| `FOUNDER_VESTING_DURATION` | CLIFF + RELEASE = **4 года** | Backward-compatible сумма |
| `TIMELOCK_DELAY` | `604_800` (7 дней) | Между `approved_at` и исполнением |
| `GOVERNANCE_MEMBER_MAX` | `5` | |
| `GOVERNANCE_MIN_MEMBERS` | `3` | |
| `PROPOSAL_AMOUNT_MAX_ATOMIC` | `1_000_000_000_000_000` (1e15) | = 1M SRC = 0.1% от MAX |
| `PROPOSAL_TITLE_MAX_LEN` | `64` | байт |
| `MAX_DEVICES_PER_OWNER` | `100` | аудит BLOCK 4 |
| `EMISSION_DIFFICULTY_K` | `10` | асимптотическая сложность |

Гарантии supply: `vault.max_supply = MAX_SUPPLY_ATOMIC` (`initialize_vault`);
каждая эмиссия (`allocate_founder`, `governance_mint`, `mint_energy`) проверяет
`total_supply + amount <= max_supply` (`SupplyLimitExceeded`).

## 4. PDA-структура

Все PDA — владелец **enrg_mvp** (`9rVoqWPSRQpMN8qbqD9DfMTUcs1qXDELZPF1eVGowsXF`),
если не указано иное.

| Аккаунт | Seed | Инициализация | Где в коде |
|---|---|---|---|
| `Vault` | `[b"vault"]` | `init_if_needed` / `initialize_vault` | `state/vault.rs` |
| `TokenMint` | `[b"token-mint"]` | `init` / `initialize_token` | `state/token_mint.rs` |
| SRC Mint (SPL) | `[b"src-mint"]` | `init` / `initialize_token` | `instructions/initialize_token.rs` |
| Mint Authority (signer mint_to) | `[b"mint-authority"]` | `init` / `initialize_token` | там же |
| Fund Authority: buyback | `[b"fund-buyback"]` | `init` / `initialize_token` | там же |
| Fund Authority: staking | `[b"fund-staking"]` | fund-ATA привязываются в `initialize_funds` | `instructions/initialize.rs` |
| Fund Authority: dao | `[b"fund-dao"]` | там же | |
| Fund Authority: emergency | `[b"fund-emergency"]` | там же | |
| `GovernanceState` | `[b"governance"]` | `init` / `initialize_governance` | `instructions/governance.rs` |
| `Proposal` | `[b"proposal", id.to_le_bytes()]` | `init` / `create_proposal` | там же |
| `OracleRegistry` | `[b"oracle-registry"]` | `initialize_oracle_registry` | `state/registry/oracle.rs` |
| `Config` | `[b"config"]` | `init_config` | `state/config.rs` |
| `ManifestRegistry` | `[b"manifest-registry"]` | `initialize_manifest_registry` | |
| `ManifestVerification` | `[b"manifest-verification", manifest_id]` | `register_manifest_verification` | |
| `Producer` (устройство) | `[b"producer", device_id]` | `register_device` | `state/producer.rs` |
| `OwnerDevices` | `[b"owner-devices", owner]` | claim/register | `state/owner_devices.rs` |
| `EnergyProfile` | `[b"profile", authority]` — **владелец enrg-profile** | CPI `init_energy_profile` | `ENRG_PROFILE_PROGRAM_ID` |

**Особый случай — `FounderVesting`** (`state/vesting.rs`): **не PDA и не `init`** —
аккаунт обязан существовать заранее (**генезис-аккаунт**). Для localnet он
подкладывается валидатору через `Anchor.toml [test.validator] account`
(`tests/genesis/founder-vesting.json`, адрес `24K1e3yE4VvCaGBxMhWyyTWcRU8WqZcGCuRxnu4CgfNJ`
= `findProgramAddress([b"founder-vesting"])`). На Devnet этот аккаунт должен
создаваться процессом деплоя аналогичным способом (генезис/пре-сид).


## 5. Жизненный цикл

Последовательность релиза (одна и та же на localnet/Devnet; smoke-покрытие —
`tests/zz-e2e-smoke.ts`):

```
initialize_token            → SRC mint (PDA [b"src-mint"]), mint-authority = PDA [b"mint-authority"]
initialize_vault            → Vault (PDA [b"vault"]), max_supply = 1e18
allocate_founder            → премайн 2e17 на founder ATA (одноразово), total_supply = 2e17
initialize_founder_vesting  → FounderVesting (генезис-аккаунт; cliff 1y / release 3y)
initialize_governance       → GovernanceState (PDA [b"governance"]; authority + 3..=5 members)
create_proposal             → Proposal (PDA [b"proposal", id]); одно активное, amount ≤ 1e15
vote                        → кворум: yes > no И yes+no > members/2 → Approved (+approved_at)
governance_mint             → после TIMELOCK_DELAY (7 дней): mint_to через mint-authority PDA
```

Исполнение `governance_mint` возможно только после `Approved` + истёкшего
timelock (иначе `TimelockNotElapsed`); `vault.total_supply` увеличивается,
`Proposal.status → Executed`.

## 6. Тест-статус

- **Anchor TS (localnet):** `anchor test --skip-build` — зелёный прогон
  (включая `tests/zz-e2e-smoke.ts`, `tests/trust-ers-pool.ts` — Trust
  Levels/ERS/Pool, `tests/founder-vesting.ts` — теперь с рантайм-тестом
  `initialize_founder_vesting`).
- **Rust unit:** `cargo test --manifest-path programs/enrg-mvp/Cargo.toml --lib`
  — зелёные (61; включая юнит-инварианты vesting, governance,
  tier-лимиты/`allows_increment`, ERS-математику, доли пула, формулу
  эмиссии `E(S)=1 МВт·ч×10^S`, decimals/комиссию 15%).
- **Документированные skips:**
  - `it.skip` в `tests/governance.ts` — полный проход `governance_mint` после
    7 дней (Clock-warp невозможен; покрыт юнит-инвариантом
    `approved_after_majority_and_timelock`).
  - `describe.skip` в `tests/devnet-merkle-proof-verification.test.ts`
    (devnet-зависимый).
- **Mint-интеграция (tier-лимит в mint_energy, ERS-обновление, pool-вклад):**
  рантайм-минт требует 2× Ed25519 + v0/LUT-транзакцию, которая на localnet
  `anchor test` нестабильна (web3.js 1.98 + solana 3.1.8, ложный
  «invalid index»); mint-логика покрыта Rust unit-тестами чистых функций
  (`can_mint`, `allows_increment`, `compute_ers_score`, `pool_share_fp`,
  `ers_pool_bonus_fp`), а полный on-chain минт — `scripts/devnet_e2e_lifecycle.ts`.
- **Известный тех-долг (НЕ блокирует релиз):**
  - `8 × TS2339` в `tests/device-lifecycle.ts` (account namespace
    `energyProducer` не типизирован в IDL).
  - Доп. предсуществующие TS-ошибки: `tests/merkle-proof-verification.test.ts`
    (4), `tests/devnet-merkle-proof-verification.test.ts` (3),
    `tests/helpers/program.ts` (2), `tests/helpers/debug-program.ts` (2),
    `tests/probe10.test.ts` (1). Итоговая база `npx tsc --noEmit` = **20 ошибок**,
    новые тесты новых не добавляют.
  - `set_vault_authority` — одношаговая смена (TODO(audit): двухшаговая +
    timelock/multisig).
- **Devnet — фактическое состояние (verify-only прогон, `scripts/devnet_verify_governance.ts`):**
  Проверка от 2026-08-13 показала, что **задеплоенная на Devnet ревизия НЕ
  соответствует текущему коду** (ProgramData slot `483215633`, authority
  `GkdhQQ…` совпадает, но):
  - `deployed binary != local build` (SHA-256 расходятся) — деплой старше кода;
  - `vault.max_supply = 1e9` (старая модель «сырых» SRC), не `MAX_SUPPLY_ATOMIC=1e18`;
    `vault.total_supply = 10000`, `src-mint.supply = 10000` (согласованы между собой);
  - `token-mint` не декодируется текущим IDL (layout 205 байт вместо ~238) —
    старая ревизия программы;
  - **governance PDA не инициализирован**, **founder-премайн/ATA отсутствует**,
    **vesting-аккаунт не задеплоен**, proposal-истории нет;
  - Расхождения НЕ «чинились» — verify-only (exit 1, 8 расхождений).
  **Что требуется:** отдельный деплой/upgrade актуальной ревизии
  (`cargo build-sbf` → deploy) и повторная инициализация цепочки
  (`initialize_token → initialize_vault → allocate_founder →
  initialize_founder_vesting → initialize_governance`) по разделу 5.
  После синхронизации кода (tiers/ERS/pool/governance-tighten, этот документ)
  актуальна только эта операция; код больше не менялся.

## 7. Roadmap (добавляется upgrade-ом, не блокирует релиз)

- **Policy Engine (ADR-0003)** — отдельная on-chain PolicyRegistry / off-chain
  engine поверх существующей trust-pipeline (сейчас verifier + policy
  co-located в `mint_energy`; документированное упрощение MVP).
- **Multisig + двухшаговая смена authority** для `set_vault_authority`
  (изменение layout Vault требует миграции задеплоенного аккаунта).
- **DAO** — расширение governance MVP: делегирование, голосование по весу,
  исполнение произвольных инструкций (сейчас — только `governance_mint`).


