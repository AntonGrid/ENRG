# Backfill: восстановление `proofs` из цепочки

> Обновлено 2026-10-12. Скрипт: `scripts/backfill-from-chain.ts`, npm: `backfill:chain`.

## Зачем

Прод-база Render пуста после удаления managed Postgres: `/api/v1/stats` отдаёт
нули, `/api/v1/proofs` — пустой список. **Источник истины — цепочка**, а БД лишь
производная, поэтому историю минтов можно восстановить чтением devnet.

## Что восстанавливается, а что нет

| Данные | Восстановимо из chain? | Как |
|---|---|---|
| Строки `minted` (успешный `mint_energy`) | ✅ да | аргумент `OracleReport` инструкции: `device_id`, `nonce`, `device_timestamp`, `energy_wh`, `oracle` (= `oracle_id`); `mint_tx` = подпись tx |
| Строки `accepted` (proof принят, но не сминчен) | ❌ нет | приём proof'а происходит **вне** цепочки — эти строки жили только в БД. Источник — бэкап Postgres |
| Строки `deferred` (отказ политики/нет продюсера) | ❌ нет | то же |

Следствие, которое нужно проговаривать честно: после backfill
`minted_proofs` — точный, а `total_proofs` **меньше**, чем было до переезда.
Это не потеря данных, а разница между «что записано в цепочке» и «что помнила
удалённая БД».

## Запуск

```bash
# 1. Сначала всегда сухой прогон — он ничего не пишет:
npm run backfill:chain:dry           # = DRY_RUN=1 ts-node scripts/backfill-from-chain.ts

# 2. Запись:
npm run backfill:chain
```

Переменные окружения:

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `RPC_ENDPOINT` | `https://api.devnet.solana.com` | RPC для чтения истории |
| `MAX_TX` | `1000` | сколько последних транзакций программы сканировать (пагинация по 1000) |
| `DELAY_MS` | `25` | пауза между запросами `getParsedTransaction` (бережём публичный RPC) |
| `RECENT_PAGE` | `1000` | сколько строк proofs читать на устройство для проверки дублей |
| `ENRG_SQLITE_PATH` / `DATABASE_URL` | `./enrg.db` | целевая БД (SQLite по умолчанию) |

## Идемпотентность

Ключ — `(device_id, nonce)`. Перед вставкой для каждого устройства из цепочки
поднимаются уже записанные `nonce`; совпадения пропускаются и попадают в счётчик
`already present`. Повторный запуск безопасен.

## Как проверено (2026-10-12)

* `DRY_RUN=1 MAX_TX=60` → `scan: {"signatures":60,"program_ixs":57,"mint_energy":4,"undecodable":0}`,
  найдены 4 mint-записи (включая тот самый `2ANc1Lf3…KT6`), `would insert: 4`, БД не изменена
  (`total_proofs` остался 100).
* Запись на копии БД (`ENRG_SQLITE_PATH=/tmp/idem.db MAX_TX=30`): `inserted: 3`,
  `stats: total_proofs 100→103, minted_proofs 0→3, total_energy_wh 5000→97000`.
* Идемпотентность: повторный запуск по той же БД → `inserted: 0, already present: 3`,
  статистика не изменилась.
* `npx tsc --noEmit` — чисто; `npm test` — 122 passing.

Две ловушки, на которые скрипт уже наступил и которые здесь зафиксированы, чтобы
не повторять: `ix.programId` у `getParsedTransaction` — это **PublicKey**, а не
строка (сравнение с base58 молча даёт 0 совпадений), а `BorshInstructionCoder.decode()`
в anchor 0.32 принимает **Buffer**, а не base58-строку (на строке тихо возвращает
`undefined`).

## Ограничения

* Публичный devnet RPC может не отдавать очень старые транзакции — `MAX_TX`
  поднимайте осознанно (каждая транзакция = отдельный `getParsedTransaction`).
* Скрипт восстанавливает **minted**-строки. Полный откат к состоянию Postgres
  невозможен без её бэкапа — при следующем переезде хранилища берите бэкап
  заранее.
* После backfill запустите `scripts/oracle-registry-audit.ts` и сверьте
  `/api/v1/oracles` — `with_proofs` должен перестать быть нулём.
