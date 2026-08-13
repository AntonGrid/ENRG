# Devnet Verification — Baseline (константы и PDA)

> Рабочий документ для verify-only проверки governance/vesting/премайн-цепочки
> на Devnet (`scripts/devnet_verify_governance.ts`).
>
> Значения сверены с `programs/enrg-mvp/src/` и `docs/STATE.md`
> на момент деплоя v7.1 (новый program id `HkuC3…`, block 8+). Источник истины — код.
>
> **Старый program id `9rVoqWPSRQpMN8qbqD9DfMTUcs1qXDELZPF1eVGowsXF` архивирован**
> как legacy devnet-эксперимент (старая ревизия: `vault.max_supply=1e9`, без
> governance/vesting). Канонических ссылок на него нет.

## Адреса

| Роль | Адрес | Комментарий |
|---|---|---|
| Program ID (enrg_mvp) | `HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb` | `declare_id!` в `lib.rs` |
| ProgramData | `ARg2GmnWHMPXaMwv5RYNVhTw4F2NZSoEFUkyT1pBLX8M` | = `findProgramAddress([program_id], BPFLoaderUpgradeable)`; slot `483455693` |
| Authority (devnet) | `GkdhQQgUBi2Q422nTBP27LADkejijRwJEAnfhPYsUJSV` | `~/.config/solana/id.json` (локально) |
| Founder wallet | `6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8` | `~/.config/solana/founder-wallet.json` (локально) |
| Governance member | `6YW9kjHu8B79F1utcK6N4Bi1wBaTsTvBei49znDQjKH2` | `~/.config/solana/governance-member.json` (локально) |

## Константы (сверено с `constants.rs`)

| Константа | Значение |
|---|---|
| `MAX_SUPPLY_ATOMIC` | `1_000_000_000_000_000_000` (1e18) |
| `SRC_DECIMALS` | `9` |
| `FOUNDER_ALLOCATION_ATOMIC` | `200_000_000_000_000_000` (2e17) |
| `FOUNDER_VESTING_CLIFF` | `365*24*60*60` = 1 год |
| `FOUNDER_VESTING_RELEASE` | `3*365*24*60*60` = 3 года |
| `FOUNDER_VESTING_DURATION` | CLIFF + RELEASE = 4 года |
| `TIMELOCK_DELAY` | `604_800` (7 дней) |
| `GOVERNANCE_MEMBER_MAX` / `MIN_MEMBERS` | `5` / `3` |
| `PROPOSAL_AMOUNT_MAX_ATOMIC` | `1e15` |

## PDA для проверки (вычисляются через `findProgramAddress`, не хардкод)

| Аккаунт | Seed | Ожидаемый owner | Проверка |
|---|---|---|---|
| `Vault` | `[b"vault"]` | enrg_mvp | существует; authority == `GkdhQQ…`; `max_supply == 1e18`; `total_supply ≤ max_supply` |
| `TokenMint` | `[b"token-mint"]` | enrg_mvp | существует; декодируется текущим IDL; `mint == src-mint`; `mint_authority == [b"mint-authority"]`; `decimals == 9` |
| SRC Mint | `[b"src-mint"]` | SPL Token | `decimals == 9`; mint-authority == PDA `[b"mint-authority"]`; supply == `vault.total_supply` |
| Mint Authority | `[b"mint-authority"]` | — (PDA-подписант) | адрес детерминирован; используется как mint-authority |
| Fund: buyback/staking/dao/emergency | `[b"fund-*"]` | — | адреса детерминированы (опционально) |
| `GovernanceState` | `[b"governance"]` | enrg_mvp | существует; `authority == GkdhQQ…`; members 3..=5 |
| `Proposal` | `[b"proposal", id.to_le_bytes()]` | enrg_mvp | для id 1..proposal_count: статус/amount ≤ 1e15/destination; timelock-поля |
| `FounderVesting` | генезис-аккаунт `B5uSLeaX2keRGbkxZA1Tyb7dFwNpY7DUbVu8TgvdiMAh` (= `findProgramAddress([b"founder-vesting"])`) | enrg_mvp | существует; `founder == FOUNDER_WALLET`; `total_amount == 2e17`; `cliff == 1y`; `release == 3y`. На Devnet создаётся bootstrap-инструкцией `initialize_founder_vesting` (init_if_needed), а не genesis-инъекцией |
| Founder ATA | `getAssociatedTokenAddress(src-mint, FOUNDER_WALLET)` | SPL Token | баланс == 2e17 (после премайна) |

## Инварианты (итоговые)

- `vault.total_supply ≤ MAX_SUPPLY_ATOMIC` (1e18).
- Founder-премайн учтён в `vault.total_supply` и в балансе founder ATA.
- Vesting-аккаунт консистентен (founder, суммы, cliff/release).
- Governance валиден: authority совпадает, members в границах 3..=5, предложения в рамках cap и timelock.

## Мета-правило

Скрипт **verify-only**: только чтение (`getAccountInfo`/deserialize), без
`sendTransaction`. Любое фактическое расхождение с baseline фиксируется в
отчёте (`docs/DEVNET_VERIFICATION.md`) и в `docs/STATE.md` — без «починки»
через мутирующие транзакции.

