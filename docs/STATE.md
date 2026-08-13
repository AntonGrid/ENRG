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


