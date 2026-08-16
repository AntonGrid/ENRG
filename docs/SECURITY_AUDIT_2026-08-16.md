# 🔐 Аудит безопасности и архитектуры ENRG Protocol

**Дата:** 2026-08-16
**Объект:** `/home/enrg/Axis-workspace/ENRG` (папка `enrg-landing` не проверялась по требованию)
**Режим:** только чтение/анализ

---

## 1. Executive Summary

Проект состоит из **двух слабо связанных миров**: (а) on-chain Anchor-программа `enrg-mvp`/`enrg-profile` с добротной trust-моделью (двойные Ed25519-подписи, OracleRegistry, строгие nonce, жизненный цикл устройств), и (б) off-chain Node.js-оракул `server.js`, который **ведёт собственную, гораздо более слабозащищённую базу устройств и энергии и не подключён к on-chain минту** (формат транзакции не соответствует borsh-`OracleReport`, подписи оракула нулевые — минт физически не может пройти). Именно в off-chain слое сосредоточены критические проблемы: **регистрация устройств без аутентификации с возможностью перезаписи чужого ключа**, **полное отсутствие валидации `energyWh`/`timestamp`**, и **утечка founder-ключа в stdout** через `run-oracle.sh`. On-chain имеет средние риски: front-running-захват ролей при инициализации (нет фиксации deployer) и фактически бесконтрольный `rated_power` (до 100 GW) в `enrg-profile`. `npm audit` показывает 17 уязвимостей (7 high). **Общий уровень риска: ВЫСОКИЙ** — критические дыры закрываются 3–5 действиями, но в текущем виде оффчейн-оракул нельзя публиковать за пределы изолированной сети.

---

## 2. Уязвимости с приоритетами

### 🔴 CRITICAL

---

#### CR-1. Неаутентифицированная регистрация устройств и подмена публичного ключа
- **Файл/строка:** `server.js:229–257` (эндпоинт `POST /api/v1/device/register`), используется в верификации proof на строках `323–338`.
- **Описание:** эндпоинт не требует ни аутентификации, ни доказательства владения ключом. Хуже: если `device_id` уже существует, **публичный ключ просто перезаписывается** (строки 239–244). Эндпоинт `/api/v1/proof/submit` верифицирует подпись против `devices[device_id]` — то есть после перезаписи ключа атакующий полностью выдаёт себя за любое устройство.
- **Как воспроизвести:**
  1. `POST /api/v1/device/register {"device_id":"dev_real","public_key":"<base64 32 байта ключа атакующего>"}` — ключ жертвы перезаписан.
  2. `POST /api/v1/proof/submit {"device_id":"dev_real","timestamp":...,"energyWh":1000000,"nonce":1,"signature":"<подпись ключом атакующего>"}` — накопление энергии идёт от имени жертвы, при пороге 1 МВт·ч вызывается минт.
- **Исправление:**
  - Регистрация только по подписанному challenge (proof-of-possession), как в on-chain `register_device` (`device_lifecycle.rs:54–77`).
  - Запретить перезапись существующего ключа без подписи старого ключа; добавить админ-эндпоинт для замены ключа.
  - Валидировать формат `device_id` (base58/hex, без спецсимволов — см. M-5).

---

#### CR-2. Отсутствие валидации `energyWh` и `timestamp` в `/api/v1/proof/submit`
- **Файл/строка:** `server.js:316–381`. Проверяются только наличие полей (319) и монотонность nonce (327). `express-validator` здесь **не применяется** (в отличие от `/register`).
- **Описание:** `energyWh` никак не ограничен: нет проверки `> 0`, нет конечности (`Number("NaN")/Number("-500")` проходят), нет верхнего лимита и сверки с мощностью устройства. `timestamp` вообще не проверяется на свежесть (нет аналога `verify_timestamp`). Последствия: (а) устройство может «намайнить» произвольное количество энергии одним подписанным proof; (б) отрицательное значение уменьшает накопитель/пулы и ломает статистику; (в) `NaN` при попадании в `saveEnergy` портит строку в SQLite (в БД уже есть мусорные записи — см. M-5). Если CR-3 будет исправлен, эта дыра станет прямой инфляцией токенов.
- **Как воспроизвести:** любое устройство с зарегистрированным ключом подписывает `device|ts|1000000000000|nonce` → аккумулятор мгновенно превышает порог.
- **Исправление:** валидировать `energyWh` (целое, `1 ≤ energyWh ≤ max` на основе профиля мощности), `timestamp` в пределах ±5 минут от серверного времени, nonce строго растущий; добавить rate-limiting и защиту от двойной подачи.

---

#### CR-3. Минт-путь оракула несовместим с on-chain программой (мёртвый/сломанный код)
- **Файл/строка:** `server.js:188–227` (`mintEnergy`), `server.js:158–186` (`createProducerIfNeeded`); аналогичные ошибки в `scripts/first-mint.js:84`, `scripts/test-deploy.js:125`, `scripts/fix_mint_authority_and_mint_energy.js:41–84`.
- **Описание:** на вход `mint_energy` (Anchor) подаётся **не borsh-`OracleReport`** (нужно 8 байт дискриминатора + 224 байта: `oracle(32)+device_id(32)+nonce(8)+device_timestamp(8)+verified_at(8)+energy_wh(8)+device_signature(64)+oracle_signature(64)`), а самодельный буфер 88 байт; подписи `Buffer.alloc(64)` — нулевые; ed25519-precompile-инструкций в транзакции нет; PDA producer считается с seed `[b"producer", founderKeypair]` вместо `[b"producer", device_id]` (ср. `device_lifecycle.rs:28–35`); `authority` на чейне должен быть владельцем producer'а, а не founder. Итог: транзакция всегда падает на десериализации/проверке подписей. Реальные токены этим путём **никогда не минтятся**, а при «исправлении» десериализации программа всё равно отклонит нулевые подписи. On-chain корректный флоу существует только в `scripts/devnet_e2e_lifecycle.ts:755–859` (v0+LUT, две ed25519-прекомпиляции).
- **Как воспроизвести:** запустить оракул, накопить ≥ 1 МВт·ч, наблюдать `mint_failed`/`instruction error`.
- **Исправление:** переписать `mintEnergy` на Anchor-клиент (`program.methods.mintEnergy(report)`), сгенерировать `oracle_signature` по `oracle_message_to_sign()` (`state/oracle.rs:55–65`), включить ed25519-инструкции до вызова программы, использовать правильные PDA. Либо полностью удалить mint из `server.js`, оставив его «верификатором + накопителем» для Policy Engine (соответствие ADR-0003).

---

### 🟠 HIGH

---

#### H-1. Утечка founder-ключа в stdout и env
- **Файл/строка:** `run-oracle.sh:17` — `echo "🚀 Oracle on devnet (founder: $(jq -r '' <<< "$FOUNDER_KEY" ...))"`. Пустой фильтр `jq -r ''` выводит **весь JSON ключа** (на этой машине `jq` не установлен, поэтому в `oracle-boot.log` виден только pubkey — но при наличии jq ключ печатается целиком в stdout/log). Дополнительно: ключ передаётся через env-переменную `FOUNDER_KEY` (`run-oracle.sh:12`, `docker-compose.yml:17`), что делает его видимым в `/proc/<pid>/environ` и дочерним процессам.
- **Файл/строка (проверка git):** ключ НЕ найден в git-истории (проверены `git log --all -S`, `.env`, keypair-файлы). На диске лежит `~/.config/solana/founder-wallet.json` (вне репозитория) — это норм, но без контроля прав/ротации.
- **Как воспроизвести:** установить `jq`, выполнить `./run-oracle.sh` — в терминале появится секретный ключ.
- **Исправление:** выводить только pubkey (`solana-keygen pubkey "$FW"` или `node -e`); никогда не писать `FOUNDER_KEY` в stdout/логи; заменить env на файл с правами `0600` или secrets-менеджер; `set -u` + проверка прав файла.

---

#### H-2. Front-running захват ролей протокола (init без фиксации deployer)
- **Файл/строка:** `oracle_registry.rs:7–21` (`initialize_oracle_registry` — authority/oracle_admin = первый подписант), `init_config.rs:11–27` (вообще без guard'а), `governance.rs:11–25`, `initialize_token.rs:24–42`. Контраст: `manifest_registry.rs:53–78` уже содержит корректный guard (`if registry.authority == default`).
- **Описание:** на «свежем» кластере любой наблюдающий за мемпулом может опередить легитимного деплоера, первым инициализировать PDA `oracle-registry`/`config`/`governance`/`token-mint` и стать `oracle_admin` → добавить **свой** ключ в список доверенных оракулов → минтовать произвольные объёмы (C-0 `mint.rs:44–47` пройдёт). Это классический first-mover capture.
- **Как воспроизвести:** на пустом devnet первым отправить `initialize_oracle_registry` со своим кошельком, затем `add_oracle` своего ключа.
- **Исправление:** зафиксировать адрес деплоера (`constraint = authority.key() == EXPECTED_DEPLOYER`) или ввести двухшаговую инициализацию (create → claim известным адресом); применить паттерн guard из `manifest_registry.rs` ко всем `init`-инструкциям.

---

#### H-3. Hardcoded приватный ключ устройства в прошивке
- **Файл/строка:** `firmware/esp32_proof_sender/esp32_proof_sender.ino:22–27` — статический `private_key[32] = {0x01,0x02,...}`; ему соответствует зарегистрированный в БД `dev_e2e_001`. Также `:11` — `http://YOUR_ORACLE_IP:3000` (plaintext HTTP → MITM), `:106` — `timestamp = millis()/1000` (аптайм, не wall-clock).
- **Описание:** ключ лежит в репозитории в открытом виде; любой может подписывать proof'ы от имени `dev_e2e_001`. Plaintext-канал позволяет перехватывать/подменять запросы. Время «с момента загрузки» не проходит on-chain freshness-проверки и бессмысленно оффчейн.
- **Как воспроизвести:** извлечь ключ из `.ino`, подписать proof для `dev_e2e_001`.
- **Исправление:** генерировать ключ при первой загрузке (паттерн `identity.cpp`), убрать ключи из репозитория, перевести обмен на HTTPS/mTLS, использовать NTP/RTC.

---

#### H-4. Ключи устройств в NVS без Secure Element — нарушение ADR-0001
- **Файл/строка:** `identity.cpp:19–23, 88–96` — приватный ключ пишется в NVS (flash) в открытом виде; `identity.cpp:114–120` — при подписи загружается в RAM. ATECC608 (или аналог) **не используется** (поиск по кодовой базе и документации результатов не дал).
- **Описание:** ADR-0001 («ключ никогда не покидает устройство», `docs/architecture/adr/ADR-0001...`) требует Secure Element/эквивалент. NVS читается физическим доступом к устройству (JTAG, dump flash) → компрометация identity.
- **Исправление:** интеграция ATECC608A (ключ в защищённом слоте, подпись внутри чипа), включить flash-encryption (eFuse), запретить JTAG.

---

#### H-5. Manifest Registry с дефолтным admin-ключом
- **Файл/строка:** `oracle/registry/app.js:14` — `const ADMIN_KEY = process.env.REGISTRY_ADMIN_KEY || 'secure-key';` и `:115–123` (эндпоинт snapshot проверяет `x-api-key`). Ключ статический, известный из кода, сравнивается по значению.
- **Описание:** при деплое без настройки env любой знает admin-ключ `secure-key` и может выпускать «официальные» Merkle-снапшоты. Дополнительно JS-реестр вообще не анкорит корни в on-chain `update_merkle_root` — снапшоты существуют только оффчейн.
- **Как воспроизвести:** `curl -H 'x-api-key: secure-key' -X POST http://host:4000/api/v1/merkle/snapshot`.
- **Исправление:** жёсткий фейл при старте без `REGISTRY_ADMIN_KEY`; авторизация через подписанный запрос (Ed25519) или HMAC с ротацией; реализовать реальный on-chain anchor корня.

---

### 🟡 MEDIUM

---

#### M-1. Устаревшие уязвимые зависимости (npm audit: 17 уязвимостей, 7 high)
- **Пакеты (все из корневого `package.json`/дерева):** `bigint-buffer` (high, buffer overflow, GHSA-3gc7-fjrx-p6mg), `ws` (high, memory-exhaustion DoS, GHSA-96hv-2xvq-fx4p), `brace-expansion` (high, DoS, GHSA-mh99-v99m-4gvg / GHSA-rgw5-rvv9-x895), `js-yaml` (high, quadratic CPU, GHSA-5p4m-2wfm-xmqj), `serialize-javascript` (high, RCE/DoS, GHSA-5c6j-r48x-rmvq), `@solana/web3.js` (moderate, via `jayson`), `uuid` (moderate, via jayson), `mocha` (moderate), `body-parser` (low). Прямые зависимости: `@solana/web3.js@1.98.4`, `@solana/spl-token@0.4.15`, `@coral-xyz/anchor@0.32.1`, `mocha@11.7.6`.
- **Исправление:** `@solana/web3.js` → `^2.x` (или ≥1.99) + совместимый `@solana/spl-token`; `ws` → `≥8.20.2` (или `7.5.11`); `mocha` → `^11.3.0` (dev); `js-yaml`/`serialize-javascript`/`brace-expansion` — только dev/test-дерево, в прод-рантайм `server.js` не попадают (проверить package-lock); `body-parser` приходит с express 4.x — обновить до `≥1.20.6`.

#### M-2. SQLite без репликации; состояние в оперативке
- **Файл/строка:** `server.js:29` (`new Database('./enrg.db')`), `server.js:90–92` (in-memory `devices/energyStore/pools`). Постгрес-репликации нет (используется SQLite). `enrg.db` лежит в корне репозитория (в .gitignore), без WAL и бэкапов.
- **Исправление:** перейти на Postgres с репликацией (или как минимум WAL + ежечасные бэкапы + вынос БД из директории приложения); восстановление накопителя — source of truth должен быть on-chain, а не local SQLite.

---

#### M-3. Слабая защита от replay: `MAX_PROOF_AGE = 1 год`
- **Файл/строка:** `security/validation.rs:8` (`MAX_PROOF_AGE = 31_536_000`), `verify_timestamp` строки 19–26. Спецификация (`Axis-workspace-ENRG-DOCS.txt` §12) требует «не старше 15 минут». Оффчейн `server.js` свежесть не проверяет вовсе.
- **Исправление:** `MAX_PROOF_AGE = 900`; на оффчейне добавить проверку `|now - timestamp| ≤ 300`.

#### M-4. `rated_power` под контролем владельца устройства (до 100 GW)
- **Файл/строка:** `enrg-profile/src/lib.rs:18` (`MAX_RATED_POWER = 100_000_000_000`), `lib.rs:93–108` (`update_metadata` — owner-only, без верификации), `mint.rs:96–97` (`report.energy_wh <= profile.rated_power`). Тир Industrial/Institutional не имеет месячного лимита (`producer.rs:66–72`), тир назначает protocol admin (`tier.rs`).
- **Описание:** владелец сам выставляет себе «потолок» до 100 ГВт·ч на отчёт. Для тиров без лимита единственным реальным ограничением становится честность оракула. Плюс функциональный пробел: `init_energy_profile` создаёт профиль с `rated_power=0` (`device_lifecycle.rs:269`), без ручного `update_metadata` минт невозможен вовсе.
- **Исправление:** `rated_power` задавать при провижининге по сертифицированному манифесту (ADR-0004), лимит на отчёт = `rated_power × окно_отчёта`, назначение тиров — только через governance/мультисиг.

#### M-5. Мусорные/XSS `device_id` в БД и их отражение в ответах
- **Файл/строка:** `server.js:231` (валидация только `isString/notEmpty`), `server.js:266–272` (эндпоинт статуса возвращает `device_id`). В `enrg.db` уже есть запись `<img src=x onerror=alert(1)>` и устройство с нулевым ключом (`AAAAAAAA...A==`).
- **Исправление:** ограничить charset `device_id` (base58/hex), эскейпить/кодировать значения в JSON-ответах, отклонять нулевые ключи.

#### M-6. CORS `null` + bind `0.0.0.0` без TLS/rate-limit
- **Файл/строка:** `server.js:116–128` (origin `'null'`), `server.js:403` (`app.listen(PORT, '0.0.0.0')`). Эндпоинты без аутентификации и ограничения частоты.
- **Исправление:** убрать `'null'`, реверс-прокси с TLS, rate limiting (например `express-rate-limit`), авторизация админ-эндпоинтов.

---

### 🟢 LOW

#### L-1. Нет `/health` на основном оракуле
- `server.js` — нет `/health` (есть только `/api/v1/stats`). `/health` есть в FastAPI (`app/main.py:11`) и registry (`oracle/registry/app.js:91`). Добавить.

#### L-2. Test-ledger keypair в git-истории
- В истории коммитов есть `test-ledger/validator-keypair.json`, `stake-account-keypair.json`, `vote-account-keypair.json`, `faucet-keypair.json` (стандартные localnet-ключи, в текущем дереве их нет). Желательно вычистить историю (`git filter-repo`).

#### L-3. 500-ответы на битые подписи; лог с полными путями
- `server.js:336–338` — `Buffer.from(signature,'base64')` без проверки длины → `nacl` бросает «bad signature size» → 500 вместо 400 (видно в `error.log`). Выдавать 400 и не логировать полные stacktrace с путями хоста.

---

## 3. Ответы на обязательный чек-лист

| Вопрос | Ответ |
|---|---|
| Кто может вызывать `mint_energy`? | On-chain — **любой**, кто соберёт валидный `OracleReport`: подпись устройства + подпись **доверенного оракула** из OracleRegistry (C-0), `device_id` совпадает с producer'ом (C-1), signer = владелец producer'а (C-2). Off-chain `server.js` — вызывает минт сам при накоплении ≥1 МВт·ч, но без валидной oracle-подписи (CR-3). |
| Проверка «доверенный оракул»? | Да, on-chain: `oracle_registry.contains(&report.oracle)` (`mint.rs:44–47`). Но список оракулов можно захватить при front-running (H-2). |
| Кто регистрирует устройства? | On-chain: любой (operator платит rent), но обязательна подпись устройства (proof-of-possession). Off-chain `server.js`: **кто угодно, без каких-либо проверок** (CR-1). |
| Владелец подписывает транзакцию? | On-chain: да, `authority: Signer` + `producer.authority == authority.key()`. Off-chain: нет понятия владельца (CR-1/CR-2). |
| Проверка `energy_wh`/`timestamp` в `mint_energy`? | On-chain: да (`energy_wh ≤ rated_power`, freshness ≤ 1 год, nonce строго растущий). Off-chain: **нет** (CR-2). |
| Защита от replay? | On-chain: `verify_nonce` (`validation.rs:11–14`) + `MAX_PROOF_AGE`. Off-chain: только монотонный nonce; обходится через перезапись ключа (CR-1). |
| Лимиты энергии за вызов? | On-chain: `rated_power` (владелец контролирует до 100 GW, M-4) + месячный лимит тира. Off-chain: лимитов нет (CR-2). |
| Где хранится `FOUNDER_KEY`? | В env `FOUNDER_KEY` или файле `~/.config/solana/founder-wallet.json` (вне репозитория, perms `0600`). В git **не попадал** (проверена история). Риски: stdout через `jq` (H-1), `/proc/PID/environ`, docker env. |
| Риск попадания в git-историю? | Текущих утечек нет. В истории остаются test-ledger keypair (L-2) — не founder-ключ. |
| Secure Element (ATECC608)? | **Нет.** Ключи в NVS открыто (`identity.cpp`), H-4. |
| Оракул упал — восстановление? | `run-oracle.sh` делает бесконечный рестарт-цикл, но нет systemd/журнала, нет очереди неотправленных proof'ов, минт невозможен без оракула (оракул = единственный подписант). |
| База данных? | SQLite (`better-sqlite3`), без репликации и бэкапов (M-2). Postgres не используется. |
| `/health`? | Есть у FastAPI и registry; **нет** у основного оракула (L-1). |
| npm audit | 17 уязвимостей: 7 high / 8 moderate / 2 low (M-1). |

---

## 4. Архитектурное соответствие AXIS (ADR-0001 / 0003 / 0005)

- **ADR-0001 «Ключ никогда не покидает устройство»** — on-chain модель соответствует (устройство подписывает register/claim/proof, сервер только верифицирует). Но исполнение нарушено: hardcoded ключ в `.ino` (H-3), ключи в NVS без Secure Element (H-4), оффчейн-сервер хранит `public_key` в своей БД (это ок), но допустил перезапись без proof-of-possession.
- **ADR-0003 «Oracle не принимает политических решений — Policy Engine»** — **сознательно отложен** (задокументировано: `docs/STATE.md:24`, `docs/adr/adr-0009-governance.md:14`). Фактически Policy Engine co-located в `mint_energy` (комментарий в `mint.rs:18–27`) и в `server.js` (накопление, пороги, пулы). Это задокументированное упрощение MVP, но оно означает: оффчейн-оракул сейчас является единственным судьёй «сколько энергии было реально».
- **ADR-0005 «Состояния устройства»** — on-chain реализовано полностью (8 состояний, `state/producer.rs:15–37`, `device_lifecycle.rs`). **Расхождение:** off-chain `server.js` не знает про on-chain состояния и ведёт собственный реестр (`devices`/`energyStore`), т.е. ADR-0002 (registry = single source of truth) оффчейн нарушен — два независимых источника истины, и оффчейн-версия безопасно слабее.
- Дополнительные расхождения «спецификация ↔ код»: спецификация требует 15-минутную свежесть proof (M-3); прошивка подписывает **строку** `device|ts|energy|nonce`, on-chain требует **бинарь** `device_id‖nonce‖ts‖energy` — форматы несовместимы (CR-3); `max_energy_wh = max_power_w * 10 / 60` из доки не совпадает с проверкой `energy_wh <= rated_power` в коде; openapi описывает `/provisioning/register` с proof-of-possession, реализация — без него.

---

## 5. Минимальный план фиксов (5 действий)

1. **Закрыть CR-1/CR-2 (off-chain):** регистрация по подписанному challenge + запрет перезаписи ключа без подписи старого; строгая валидация `energyWh`/`timestamp` в `/proof/submit`; rate limiting. Это закрывает несанкционированный доступ к устройствам и подделку данных в оффчейн-контуре.
2. **Исправить CR-3 (минт-путь):** переписать `mintEnergy` на Anchor-клиент с корректным `OracleReport`, реальной oracle-подписью и ed25519-precompile-инструкциями (по образцу `devnet_e2e_lifecycle.ts:755–859`); убрать мёртвые скрипты `first-mint.js`/`test-deploy.js`/`fix_mint_authority...js`.
3. **Устранить утечку ключа (H-1):** `run-oracle.sh` — печатать только pubkey; файл `0600`; не передавать ключ в env при возможности.
4. **Закрыть front-running (H-2):** во всех `init`-инструкциях зафиксировать ожидаемого deployer (или guard как в `manifest_registry.rs`); для уже задеплоенного devnet — проверить текущего `oracle_admin` и при необходимости сменить через `set_oracle_admin`.
5. **Обновить зависимости (M-1) и добавить `/health` + реверс-прокси с TLS (L-1, M-6):** `@solana/web3.js`, `ws`, `mocha`; развернуть оракул только за TLS с ограничением CORS-источников.

---

*Отчёт подготовлен по результатам read-only аудита 2026-08-16. Все файлы и строки указаны относительно корня `~/Axis-workspace/ENRG`.*
