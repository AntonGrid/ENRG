# Devnet Verification Report — Governance & Vesting Chain (v7.1, новый program id)

**Date:** 2026-08-13
**Run:** `RPC_ENDPOINT=https://api.devnet.solana.com yarn ts-node scripts/devnet_verify_governance.ts`
**Mode:** verify-only (только чтение, без `sendTransaction`)
**Result:** **exit 0 — ALL CHECKS PASSED ✔**

---

## 1. Проверенные адреса

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

## 2. Подтверждённые инварианты (✔)

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

## 3. Что было сделано для актуализации Devnet (историческая справка)

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

## 4. Legacy

Старый program id `9rVoqWPSRQpMN8qbqD9DfMTUcs1qXDELZPF1eVGowsXF` архивирован
(старая ревизия: `vault.max_supply=1e9`, `token-mint` 205 байт, без
governance/vesting/премайна). Канонических ссылок нет; цепочка не удаляется,
но не используется.

*Полный вывод прогона — в терминале запуска (0 ✘, все ✔).*

