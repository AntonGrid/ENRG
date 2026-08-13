# 0009 – Governance MVP (Enrg MVP)

*Status*: Adopted (MVP)  \
*Date*: 2026-08-13  \
*Authors*: ENRG Architecture WG  \
*Supersedes*: — (ADR-0003 Policy Engine НЕ внедряется на этом этапе)

## Context

Программа `enrg-mvp` (Anchor 0.32, Solana) получила полную токеномику и
founder-vesting (коммит `ec7cf36`). Следующий этап — базовый governance-модуль
для контролируемой эмиссии новых токенов.

На этом этапе **не** реализуется полный Policy Engine (ADR-0003). Вводится
простая двухуровневая модель: `authority` (владелец контракта) + `members`
(список адресов с правом голоса). Все числа — атомарные единицы
(1 SRC = 1e9 атомар; MAX_SUPPLY_ATOMIC = 1e18). Mint-authority остаётся PDA
`[b"mint-authority"]` и **не меняется**; эмиссия возможна только через
`governance_mint`.

## Decision

### 1. Роли (двухуровневая модель)

- `authority` — владелец контракта. Создаёт предложения (`create_proposal`),
  управляет списком members (`update_members`).
- `members` — список адресов (3..=GOVERNANCE_MEMBER_MAX=5), имеющих право
  голосовать (`vote`). Валидация при каждом обновлении: 3..=5 уникальных.

### 2. Timelock (MVP-минимализм)

- `TIMELOCK_DELAY = 7 * 24 * 60 * 60 = 604_800` секунд.
- **Одно активное предложение** в момент времени. При создании нового
  предложения, если есть активное, клиент обязан передать предыдущее
  (`prev_proposal`) — оно автоматически помечается `Cancelled`.
  Без `prev_proposal` создание отклоняется (`ProposalNotActive`).
- После голосования, если достигнут кворум — предложение переходит в
  `Approved` и исполняется автоматически через `TIMELOCK_DELAY` после
  `approved_at`.

### 3. Кворум и голосование

- Голосование однократное на member (список `voted_members`).
- После каждого голоса проверяется кворум:
  `yes > no` **И** `yes + no > member_snapshot_count / 2`.
- Если кворум достигнут → `Approved`, фиксируется `approved_at`.
- Если проголосовали все члены снапшота, а кворума нет → `Rejected`.

### 4. Эмиссия (дочерние права, НЕ mint authority)

- Mint-authority остаётся PDA `[b"mint-authority"]` (как в `initialize_token`).
- Новая инструкция `governance_mint`: вызывается **только** для предложения
  со статусом `Approved`, у которого истёк `TIMELOCK_DELAY` с момента
  `approved_at`. Выполняет CPI `token::mint_to` (signer — mint-authority PDA)
  напрямую на ATA получателя (`destination`, mint == SRC mint,
  owner == proposer) и засчитывает сумму в `vault.total_supply`
  (проверка `total_supply + amount <= max_supply`). После успеха — статус
  `Executed`, фиксируется `executed_at`.
- `PROPOSAL_AMOUNT_MAX_ATOMIC = 1e15` — лимит эмиссии на одно предложение
  (0.1% от MAX_SUPPLY_ATOMIC).

### 5. Аккаунты (PDA-seeds, инициализируемые из TS)

В отличие от `FounderVesting` (генезис-аккаунт), governance-аккаунты имеют
PDA-seeds и создаются через `init`:

- `GovernanceState` — PDA `[b"governance"]`.
- `Proposal` — PDA `[b"proposal", id.to_le_bytes()]`, где `id` — монотонный
  `proposal_count + 1`.

Это позволяет полностью инициализировать и тестировать lifecycle
рантайм-вызовами из TS (`tests/governance.ts`).

### 6. Поток исполнения

```
create_proposal (authority)
  → vote (members, >50% «за» при кворуме)  → Approved
  → ожидание TIMELOCK_DELAY (604_800 s)
  → governance_mint → токены на указанный ATA (Executed)
```

## Consequences

- Эмиссия невозможна без прошедшего голосования и timelock.
- Mint-authority остаётся PDA; принцип «эмиссия только через governance_mint»
  выполнен (founder-премайн — одноразовое исключение, зафиксированное ADR).
- Одно активное предложение упрощает MVP и исключает гонки.

## Runtime-testing

`tests/governance.ts` покрывает рантайм на localnet:
`initialize_governance`, `update_members` (границы 3..=5),
`create_proposal` (лимит amount), `vote` (majority→Approved,
outsider/double-vote отклоняются, minority→Rejected), `collision`
(auto-cancel через `prev_proposal`), `governance_mint`
(немедленный вызов → `TimelockNotElapsed`).

Полный проход «Approved → 7 дней → Executed» **не тестируется рантаймом**:
`approved_at` фиксируется on-chain Clock, warp невозможен. Он покрыт
юнит-инвариантом `approved_after_majority_and_timelock`
(в `state/governance.rs`), который проверяет `executable(now)` на границах
`approved_at + TIMELOCK_DELAY`.

## Roadmap

1. **MVP** (этот ADR): authority + members, timelock 7 дней, governance_mint.
2. **Multisig + timelock**: authority → мультиподпись, настраиваемый timelock.
3. **Полный Policy Engine (ADR-0003) / DAO**: роль-маппинг, кворумы по типам
   решений, treasury-перераспределение.

## Tightening (v7.0 §22 конформность)

- **Пути эмиссии SRC (зафиксировано):** только `mint_energy` (Proof-of-Production,
  PoP-майнинг через mint-authority PDA) и `governance_mint` (ADR-0009). Любого
  иного пути минта нет — «non-governor mint» невозможен: founder-премайн —
  одноразовое исключение (`founder_minted`), `set_vault_authority` не меняет
  mint-authority (PDA `[b"mint-authority"]` неизменен).
- **Реестр голосований (governable params):** параметры экономики (`k`,
  комиссия 15%, лимиты тиров, `PROPOSAL_AMOUNT_MAX_ATOMIC`, казна фондов) пока
  являются **константами кода**, а не предметом голосования. План: добавить в
  `GovernanceState` реестр параметров (layout-миграция при upgrade) и
  голосовать за их изменение отдельным типом предложения — в scope full DAO.
- **Полный DAO-путь:** делегирование, голосование по весу, исполнение
  произвольных инструкций — за пределами MVP (см. STATE.md, раздел 7).

