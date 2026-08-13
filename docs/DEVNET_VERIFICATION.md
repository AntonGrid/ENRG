# Devnet Verification Report — Governance & Vesting Chain

**Date:** 2026-08-13
**Run:** `RPC_ENDPOINT=https://api.devnet.solana.com yarn ts-node scripts/devnet_verify_governance.ts`
**Mode:** verify-only (только чтение, без `sendTransaction`)

---

## 1. Проверенные адреса

| Роль | Адрес | Результат |
|---|---|---|
| Program ID (enrg_mvp) | `9rVoqWPSRQpMN8qbqD9DfMTUcs1qXDELZPF1eVGowsXF` | ✔ существует, executable, owner BPFLoaderUpgradeable |
| ProgramData | `BPrCXiGkQiYCkNgFfsj1KgqfV1WMymKRAdtoyKM2hzkZ` | ✔ layout ProgramData, slot `483215633` |
| Upgrade authority | `GkdhQQgUBi2Q422nTBP27LADkejijRwJEAnfhPYsUJSV` | ✔ совпадает с ожидаемым |
| Vault PDA `[b"vault"]` | `yrzjLBezJHCFQ9ViVNJbmeAVaeVBFZYN63Viq94ywbd` | ✔ owner == program, authority == GkdhQQ… |
| TokenMint PDA `[b"token-mint"]` | `3WcKD8ufdSCdKSigkzzLEoLkZgqz63A5PYrfZ9ohi8aM` | ✔ owner == program |
| SRC Mint `[b"src-mint"]` | `7VJooBdrYK2hbUGf1sWiBTywK9d8xpDRd4Mz9FXA4LfT` | ✔ SPL Token, decimals=9, mint-authority == PDA `[b"mint-authority"]` |
| Founder wallet | `6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8` | ATA отсутствует (см. расхождения) |
| Vesting (генезис) | `24K1e3yE4VvCaGBxMhWyyTWcRU8WqZcGCuRxnu4CgfNJ` | отсутствует (см. расхождения) |
| Governance PDA `[b"governance"]` | `EERDE9iXg8WQ7GSNEaY93vYXeL5xby8658cYVSso4j25` | отсутствует (см. расхождения) |

## 2. Подтверждённые инварианты (✔)

- RPC Devnet доступен (solana-core 4.2.0).
- Программа задеплоена, исполнитель — BPFLoaderUpgradeable, upgrade authority = `GkdhQQ…`.
- Vault: владелец — программа, `authority == GkdhQQ…`, `total_supply ≤ max_supply`.
- SRC mint: decimals=9, mint-authority = PDA `[b"mint-authority"]`, `supply == vault.total_supply` (оба = 10000).
- `vault.total_supply ≤ MAX_SUPPLY_ATOMIC`, `src-mint.supply ≤ MAX_SUPPLY_ATOMIC`.

## 3. Расхождения с текущей ревизией кода (✘)

| # | Проверка | Факт | Ожидание (текущий код) |
|---|---|---|---|
| 1 | Deployed binary == local build (SHA-256) | `d8e3ae80…` ≠ `5bdf5eca…` | совпадение |
| 2 | `vault.max_supply` | `1_000_000_000` (1e9, «сырые» SRC) | `MAX_SUPPLY_ATOMIC = 1e18` |
| 3 | `token-mint` декодируется текущим IDL | layout 205 байт (старая ревизия) | ~238 байт |
| 4 | Founder ATA / премайн | отсутствует | баланс ≥ 2e17 |
| 5 | `vault.total_supply` включает премайн | 10000 (не ≥ 2e17) | 2e17 после launch |
| 6 | Vesting-аккаунт (генезис) | не задеплоен | существует |
| 7 | Governance PDA | не инициализирован | authority + members 3..=5 |
| 8 | Proposal-история | нет (счётчик = 0) | — |

**Вывод:** задеплоенная на Devnet ревизия **старше** текущего кода
(до перехода на атомарные единицы и до governance/vesting-модулей).
Токеномическая цепочка (governance/vesting/премайн) на Devnet **не инициализирована**.
Расхождения НЕ устранялись (verify-only); прогон завершился с exit code 1.

## 4. Что требуется для актуализации Devnet

1. **Upgrade/деплой актуальной ревизии** (`cargo build-sbf` → deploy текущего
   `target/deploy/enrg_mvp.so` с сохранением program ID и authority).
2. **Повторная инициализация цепочки** по `docs/STATE.md`, раздел 5:
   `initialize_token → initialize_vault → allocate_founder →
   initialize_founder_vesting → initialize_governance`.
   - Founder-премайн одноразовый — выполнить только на целевой сети.
   - Vesting-аккаунт на Devnet создаётся пре-сидом (генезис) — см. STATE.md, раздел 4.
3. Повторный прогон `scripts/devnet_verify_governance.ts` до **exit 0**.

*Полный вывод прогона — в терминале запуска (8 ✘, 17 ✔).*
