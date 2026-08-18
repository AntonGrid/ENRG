# Независимый неофициальный аудит ENRG на соответствие AXIS Protocol / AXIS Core

**Дата:** 2026-08-18
**Режим:** только чтение/анализ (код не изменялся)
**Объект:** `~/Axis-workspace/ENRG` (все 455 отслеживаемых git-файлов)
**Эталоны:** `~/Axis-workspace/Axis-protocol` (spec/protocol/*, adr/ADR-0001…0009, docs/*) и `~/Axis-workspace/Axis-core` (axis_core/*, oracle/*, schemas/*, docs/merkle-proof-verification.md)
**Методы:** построчный разбор, `diff` с эталоном, `git ls-files` (контроль секретов), `npx tsc --noEmit`, `npm audit`, трассировка логики тестов.

---

## 1. Общий уровень соответствия

| Компонент | Уровень | Оценка |
|---|---|---|
| Core Protocol (on-chain `enrg-mvp`) | Частичное | ≈ 65 % |
| Domain Profile (`enrg-profile`) | Частичное | ≈ 50 % |
| Oracle (`server.js`, `policy.js`, `storage.js`, `oracle/registry`) | Частичное | ≈ 50 % |
| Firmware ESP32 v3 | Частичное | ≈ 55 % |
| Схемы (`schemas/`) | Полное | ≈ 95 % (побайтово = Axis-core) |
| Документация и ADR | Частичное | ≈ 60 % |
| **Итого** | **Частичное соответствие** | **≈ 55 %** |


---

## 2. Сильные стороны (сделано правильно)

1. **ADR-0005 — жизненный цикл устройств.** 8 состояний и матрица переходов точно совпадают с эталоном (`programs/enrg-mvp/src/state/producer.rs:3-37`); Revoked терминален, переходы наружу запрещены.
2. **ADR-0001 — ключ не покидает устройство.** Регистрация, claim и ротация требуют Ed25519-подпись устройства через Solana-precompile с domain-separated каноническими сообщениями (`device_lifecycle.rs:56-78`, `security/lifecycle.rs:14-85`, `security/mod.rs:34-76`). Парсер precompile строгий (только self-индекс, одна подпись).
3. **ADR-0002 — on-chain registry как источник истины.** PDA `[b"producer", device_id]` хранит состояние/владельца/nonce/tier; изменение — только через registry-инструкции.
4. **Trust-конвейер model.md.** `OracleReport` с **двумя** подписями (устройство + оракул) (`state/oracle.rs:8-65`), C-1 связка device_id, C-0 whitelist оракулов, анти-replay nonce, freshness 15 мин / skew 5 мин (`security/validation.rs:9-38`, `constants.rs:19-20`) — реализовано точно и согласовано on-chain/off-chain.
5. **ADR-0007 — отзыв и ротация.** `revoke_device` блокирует mint жёстко (`mint.rs:45`, `producer.rs:258-266`); `rotate_device_key` с proof-of-possession нового ключа и аудит-следом `rotated_to` (`device_lifecycle.rs:640-683`).
6. **ADR-0003 — Policy Engine on-chain.** `PolicyRegistry` PDA + `PolicyEngine` (`policy_engine.rs`, `state/policy.rs`) с дефолтами, идентичными поведению протокола; `mint_energy` позиционирован как исполнитель.
7. **Защита от front-running (H-2).** `EXPECTED_DEPLOYER` guard во всех init-инструкциях (`initialize.rs:101-106`, `oracle_registry.rs:71-77`, `manifest_registry.rs:61-67`, `governance.rs:31-36`, `init_config.rs`).
8. **Схемы.** Все 5 `schemas/*.json` побайтово идентичны Axis-core (проверено `diff`).
9. **Честная инженерная документация.** `docs/STATE.md` — единый источник правды с пометкой «код первичен», известный тех-долг перечислен; `docs/SECURITY_AUDIT_2026-08-16.md` и `docs/AXIS_CONFORMANCE_AUDIT_2026-08-16.md` — честные самоаудиты (52 %), большинство найденных там P0 закрыто.
10. **Rust unit-тесты (61)** с инвариантами (vesting, governance, tier, ERS, эмиссия) и **verify-only devnet-верификация** деплоя с SHA-256 бинарников (`docs/DEVNET_VERIFICATION.md`).
11. **SE050/OTA-пути прошивки:** аппаратная Ed25519 (SE050), dual-bank A/B + eFuse `secure_version` + rollback (`esp32_proof_sender_v3.ino:936-978`), отдельный холодный firmware-ключ, PoP-регистрация и запрет перезаписи ключа в оракуле (`server.js:565-600`, `policy.js:654-689`).
12. **Гигиена секретов в git:** legacy-прошивка, keypair, `deploy/`, `*.log`, `*.db` — в `.gitignore`, в `git ls-files` не найдено ни одного keypair/секрета.

---

## 3. Критические проблемы (P0 — блокеры мейннета)

**P0-1. On-chain «верификация манифестов» не верифицирует ничего.**
`register_manifest_verification` (`instructions/manifest_verification.rs:22-50`) просто сохраняет `publisher_key`, `content_hash`, `signature` и выставляет `verified = false` — подпись издателя **никогда не проверяется**. Любой может зарегистрировать произвольный манифест. Плюс `verify_merkle_proof` (`instructions/merkle_proof_verification.rs:143-182`) принимает `leaf_hash` от вызывающего и **не привязывает** его к `content_hash` зарегистрированного манифеста: доказывается принадлежность дереву *некоторого* leaf, а не утверждение «манифест X одобрен». Это прямой пробой ядра trust-конвейера (ADR-0004/0007: «Manifest Registry» как источник одобренных манифестов).

**P0-2. Оракул ведёт собственный реестр устройств как источник истины для верификации подписи.**
`/api/v1/proof/submit` (`server.js:975-1043`) проверяет подпись через `policy.validateProof` с `getPublicKey: (id) => devices[id]` — это локальная БД оракула (SQLite/Postgres, `storage.js`), **а не on-chain Registry**. On-chain связь проверяется только позже, в `mintEnergy`, и только по `device_id`→`authority`. После ротации/отзыва ключа on-chain off-chain-реестр рассинхронизируется: proof может быть принят оракулом (энергия накоплена), но отклонён on-chain, или наоборот. Это прямое нарушение ADR-0002 («Registry — единственный источник истины») в активном trust-пути.

---

## 4. Расхождения с ADR-0001…0009

### ADR-0001 «Ключ никогда не покидает устройство» — **соответствует (с оговорками)**
- ✅ Подпись register/claim/rotate только на устройстве; сервер не видит приватный ключ.
- ⚠️ Fallback-хранение seed в NVS без flash-encryption по умолчанию; подпись в CPU при отсутствии SE050 — задокументированный компромисс (`SE050-HARDWARE-SIGNING.md`).
- ⚠️ `firmware/firmware-signing-keypair.json` лежит на рабочем диске (не трекается git) — не холодное хранилище.

### ADR-0002 «Device Registry — единственный источник истины» — **нарушен off-chain**
- ✅ On-chain: `EnergyProducer` PDA — источник состояния.
- ❌ Off-chain: собственный реестр `devices`/`energyStore` в БД оракула используется для верификации (`server.js:58-60, 975-1043`) — **два источника истины**.
- ⚠️ Идентификатор: в AXIS `device_id` — детерминированный base58-идентификатор из ключа; в ENRG `device_id` = сам Ed25519-pubkey (32 байта). По формальным требованиям (base58, 32–64) совместимо, но **JSON-схема `device_record.schema.json` требует `^dev_[0-9a-f]{16}$`, которой фактические device_id ENRG не удовлетворяют** — схема оторвана от реальности.

### ADR-0003 «Oracle не принимает решений — Policy Engine» — **частично**
- ✅ On-chain `PolicyRegistry`/`PolicyEngine`; `policy.js` off-chain; `mint_energy` — исполнитель.
- ❌ **Два независимых Policy Engine** с разными параметрами: off-chain `policy.js` (`maxEnergyPerReportWh=1e9`, `maxProofAgeSec=900`) и on-chain `PolicyRegistry` (`max_energy_bps=10_000` от rated_power, `max_clock_skew_sec=300`). Нет механизма синхронизации: proof может пройти off-chain (энергия накоплена), но быть отклонён on-chain → состояние «mint deferred» накапливается без сверки.
- ❌ `PolicyRegistry` **опционален** в `MintEnergy` (`mint.rs:507-515`): при отсутствии PDA применяются «дефолты» — т.е. Policy Engine может быть молчаливо отключён без блокировки минта.
- ⚠️ Перевод ENRG ADR-0003 декларирует «Oracle не хранит состояние устройства» — фактически хранит (см. P0-2).

### ADR-0004 «Device Manifest» — **частично**
- ✅ Манифест подписывается оракулом, устройство проверяет подпись вшитым pubkey, `oracle_url` из манифеста используется (`esp32_proof_sender_v3.ino:46-50`, `policy.js:buildManifestMessage/signManifest/verifyManifest`).
- ❌ **Набор полей не совпадает с AXIS**: в ADR-0004 обязательны `trust_level`, `capabilities`, `heartbeat_interval`, `proof_threshold`, `policy_version`, `verifier_endpoint`; в ENRG — `device_id, rated_power, oracle_url, public_key, timestamp, signature`. Отсутствуют trust_level/policy_version/verifier_endpoint (доменное замещение).
- ❌ On-chain «Manifest Registry» подписи манифеста не проверяет (см. P0-1) — контур ADR-0004 on-chain фактически не работает.

### ADR-0006 «Core vs Domain Profile» — **нарушен в части разделения**
- ✅ Есть две программы (`enrg-mvp` + `enrg-profile`) и CPI `record_production`.
- ❌ **Экономика осталась в «ядре»**: SRC mint, комиссии 15 % / 20/40/30/10, buyback, vesting, vault — все в `enrg-mvp` (`constants.rs:30-41`, `instructions/mint.rs`, `buyback.rs`, `vesting.rs`). AXIS ADR-0006: «Core Protocol knows nothing about tokens, emissions, or fees». `enrg-profile` — тонкий слой метаданных (rated_power, окно 30 дней), а не Domain Profile с токенизацией.
- ⚠️ Собственный ENRG ADR-0006 фиксирует отклонение «Вариант B: логическое разделение внутри одного контракта» — прямое расхождение с решением AXIS (явное разделение кода).
- ⚠️ В переводе ADR-0006 **перепутаны номера ADR**: «Policy Engine (ADR-0004)» (должно быть ADR-0003), «ADR-0001: Эмиссионная модель» (ADR-0001 = ключи), «ADR-0004: Policy Engine» (ADR-0004 = манифест).

### ADR-0007 «Security & Key Management» — **частично**
- ✅ Ротация/отзыв ключей с PoP, `revoked`-флаг, SE050-путь, отдельный firmware-ключ, eFuse anti-rollback.
- ❌ **Нет Root Key Registry / chain-of-trust производителя** (п.3): корень доверия — один вшитый pubkey основателя; нет регламента якорения Merkle-корней (п.7: ежедневное якорение не реализовано, root обновляется вручную через `update_merkle_root`).
- ❌ **Аттестация не в COSE/CBOR** (п.5): ENRG использует сырые Ed25519-подписи над бинарными сообщениями; обязательные поля attestation (firmware_manifest_hash, nonce, timestamp) не оформлены как аттестация-документ.
- ⚠️ Смена infra-ключей (`set_vault_authority`, `set_oracle_admin`, `update_members`) — одношаговая, без multisig/timelock (`initialize.rs:160-210`, `oracle_registry.rs:89-110`, `governance.rs:64-75`) — признано TODO(audit).

### ADR-0008 «OTA» — **частично**
- ✅ Холодный firmware-ключ, SHA-256 image_hash, dual-bank A/B, monotonic eFuse `secure_version`, rollback + smoke-подтверждение (`esp32_proof_sender_v3.ino:936-978`), endpoint публикации с `FIRMWARE_ADMIN_KEY`.
- ❌ Транспорт по умолчанию HTTP, не TLS 1.3 (см. P0-3).
- ❌ Из требуемого формата Firmware Manifest отсутствуют `compatible_models` (проверяется только query `?model=`), `min_attestation_policy`, `rollout_policy`, `emergency`-флаг, публикация манифеста в on-chain Registry с якорением.
- ⚠️ Нет автоматической привязки OTA к Manifest Registry/immutable-логу (ADR-0007 п.7).

### ADR-0009 «Governance» — **частично (MVP)**
- ✅ Members 3–5, голосование, кворум (`yes > no && yes+no > snapshot/2`), timelock 7 дней, cap предложения 1e15 атомар, эмиссия только через `governance_mint` + PDA `[b"mint-authority"]` (`governance.rs`, `state/governance.rs`).
- ❌ Нет token-holder voting, делегирования, voting power (кворум — арифметика голосов, не % voting power) — п.1 ADR-0009.
- ❌ Нет Guardians multisig, emergency flow с коротким timelock и post-mortem — п.2/п.6.
- ❌ `authority` (один адрес) и создаёт предложения, и сам меняет список members; исполняется только `governance_mint` — нет произвольных инструкций/параметров, RFC/ADR→testnet-rehearsal процесса нет.
## 5. Расхождения с моделью AXIS (Core vs Profile, trust-конвейер, регистрация)

1. **Trust-конвейер (model.md):** `Device → Event → Proof → Attestation → Verification → Trust`. В ENRG продакшн-контуре **аттестация как верифицируемый артефакт отсутствует**: оракул напрямую вызывает `mint_energy` (Digital Claim), не выпуская и не сохраняя Attestation-документ (`server.js:502-530`). Формат Attestation из `attestation.schema.json` реализован только в FastAPI-mock (`app/api/oracle.py:50-116`) — два разных мира (mock и production), и production минует слой аттестации.
2. **Wire-format (spec/protocol/wire-format.md):** Trust Envelope (`envelope_version/transport_id/correlation_id/message_header/domain/entity_type/entity_id/issuer_id`) в ENRG **не реализован**. Сообщения — плоские JSON (`{device_id, timestamp, energyWh, nonce, signature}`) и бинарные borsh-структуры. Сообщения не самодескрибируемы (нет message_type/message_version), требование «signature covers entire envelope» сводится к подписи payload.
3. **Validation (spec/protocol/validation.md):** структурные (borsh), криптографические (Ed25519-precompile + nonce + freshness), семантические (tier/energy caps/supply) и state-dependent (Active/revoked) слои **реализованы** — это сильная сторона; но отсутствует «envelope integrity» (нет envelope), а «issuer_id известен и активен» для оракула проверяется whitelist-ом (C-0).
4. **Lifecycle (spec/protocol/lifecycle.md):** Proof не проходит стадию «Stored» как самостоятельная сущность — хранятся только последний nonce/энергия в `EnergyProducer` и off-chain накопления; истории attestation нет. Очерёдность/idempotence: nonce строго монотонный — replay-защита корректна.
5. **Регистрация (ADR-0002/Provisioning):** AXIS — Provisioning Service → Registry, `device_id` = детерминированный base58; ENRG — on-chain `register_device` с PoP (сильнее). Но оффчейн-регистрация (`/api/v1/device/register`) использует **другой** PoP-формат (`device_id|public_key` строка, `policy.js:679`) и **другой** реестр, чем on-chain (`b"enrg:device:register"||device_id||ts`, `security/lifecycle.rs:27-33`) — два несовместимых контура регистрации, которые не синхронизируются автоматически.
6. **Core vs Profile:** см. ADR-0006 — экономика в ядре; профиль — метаданные. Критерий разделения AXIS («доверие → Core, токены → Profile») нарушен.
## 6. Проблемы в оракуле, прошивке, скриптах, документации

### Oracle
- **P0-2** — собственный реестр устройств как источник истины (см. §3).
- **P1** — off-chain пулы «распределяют токены» без единого токен-перемещения: `server.js:1008-1013` — сброс счётчика и ответ `'Pool threshold reached, tokens distributed'`. On-chain пул существует, но `mintEnergy` передаёт `pool: null` (`server.js:516-517`). Функция продукта выдаёт заглушку за работу.
- **P1** — `oracle/registry/routes/manifestRoutes.js` — мёртвый дубликат с **insecure-дефолтом `ADMIN_KEY='secure-key'`** (строка 8) и **keccak256-деревом**, несовместимым с on-chain SHA-256 (`merkle_proof_verification.rs`) и с рабочим `oracle/registry/app.js` (там SHA-256 и обязательный ключ ≥32 символов, `app.js:16-19`).
- **P1** — канонизация для подписей и leaf-хэшей через `JSON.stringify` (`oracle/registry/app.js:36-38,76-81`) — **неканоническая** (порядок ключей), нарушает требование детерминированности из `docs/merkle-proof-verification.md`.
- **P1** — Docker-деплой оракула сломан: `docker-compose.yml` строит образ из `./oracle`, но `server.js` лежит в корне репозитория → `CMD ["node","server.js"]` (`oracle/Dockerfile`) упадёт; `package.json "start": "node oracle/server.js"` тоже указывает на несуществующий файл.
- **P1** — `tests/test_mainnet_critical.py::test_deploy_simulation` **падает в CI**: при отсутствии `target/idl/enrg_mvp.json` (а CI `pytest -q` запускается без `anchor build`) используется fallback-список имён в camelCase, а `required` — в snake_case → `missing` непусто → assertion fail (проверено трассировкой: CI-ветка `missing=['buyback_and_burn','claim_rewards','init_config','initialize_token','mint_energy']`).
- **P1** — `npx tsc --noEmit` = **20 ошибок** (подтверждено запуском): `tests/device-lifecycle.ts`, `key-rotation.ts` (TS2339), `merkle-proof-verification.test.ts` (TS2353), `devnet-merkle-proof-verification.test.ts` (TS2552/TS2613) и др. TS-тесты не компилируются.
- **P2** — `app/` — устаревший форк axis_core: `app/api/oracle.py` — старая версия (эвристика `_looks_like_attestation`, нет mode-2/`_REQUESTS` как в свежем Axis-core); `app/oracle/router.py` не подключён в `app/main.py`; `main.py` импортирует **установленный пакет `axis_core`**, а не локальную копию `app/` → локальные правки `app/` не влияют на рантайм. `requirements.txt` (anchorpy/solders/pynacl) не содержит axis_core.
- **P2** — `npm audit --omit=dev`: **10 уязвимостей (3 high, 7 moderate)** через `@solana/web3.js`/borsh.
- **P2** — CORS открыт (`app.use(cors())`), listen `0.0.0.0`; `docker-compose.yml` передаёт `FOUNDER_KEY` в env (вопреки собственной рекомендации H-1 «только путь»).
- **P2** — хранение: дефолт SQLite без репликации/бэкапов; Postgres — опция.

### Прошивка
- **P0-3** — HTTP по умолчанию для proof/manifest/OTA (см. §3).
- **P1** — **WiFi-учётные данные захардкожены в трекаемом исходнике**: `WIFI_SSID "MTSRouter_004386"`, `WIFI_PASSWORD "23988521"` (`esp32_proof_sender_v3.ino:37-41`). Креды реальной сети в git-файле.
- **P1** — ключ устройства по умолчанию в NVS без flash-encryption/secure boot (`SE050-HARDWARE-SIGNING.md` — документированный компромисс; для продакшна требуется включить eFuse-меры).
- **P2** — хардкод домашнего IP `192.168.1.123` в дефолтах URL (прошивка и `scripts/register-device.js`).
- **P2** — serial-команда `SIGN <hex>` подписывает **произвольное** сообщение ключом устройства без доменных ограничений (`esp32_proof_sender_v3.ino:1046-1075`) — удобно для onboarding, но при физическом доступе расширяет поверхность подписи.
### Скрипты и артефакты
- **P2** — мёртвые/legacy: `first-mint.js`, `fix_mint_authority_and_mint_energy.js`, `test-deploy.js`, `*.disabled` тесты, EVM-мост (`contracts/EnrgOracleAttestation.sol` и `onchain/src/EnrgOracleAttestation.sol` — **две несогласованные копии**, `onchain/src/Counter.sol` — скаффолд Foundry). Двойная версия attestation-контракта (`int96 maxPowerKw` vs `uint64 maxPowerW` + storage).
- **P2** — `create_contract_v2.py` пишет в `Path.home()/"ENRG/..."` — вне текущего репозитория; `Anchor.toml` и `Cargo.toml` указывают разные workspace (`enrg-profile` исключён из workspace — `anchor test` его не собирает).
- **P2** — в git отслеживается 101 файл `.anchor/program-logs/` (логи) — мусор в истории.

### Документация
- **P1** — позиционирование: `README.md:3` — «first application built on Axis Protocol», но `docs/protocol/ENRG_Protocol_Specification.md:23-33` — «open, implementation-independent standard… The protocol is not owned» — ENRG подаёт себя как **самостоятельный нормативный протокол**, дублирующий структуру Axis-спеки. Двойная нормативность (что есть источник истины — AXIS или ENRG?).
- **P2** — `ENRG_Protocol_Specification.md:17` — «License: MIT», при этом `LICENSE` и README — Apache 2.0.
- **P2** — `adr/ADR-00X-enrg-core-vs-energy-profile.md:259-275` устарел: утверждает «Verifier и Policy Engine совмещены on-chain» как текущее состояние — разделение уже сделано (2026-08-17).
- **P2** — дублирование спецификаций: v7.0/v8.0 в корне и в `docs/`, `docs/architecture.md` и `docs/architecture/ARCHITECTURE.md`; `books/` — копии философии Axis без указания первоисточника.
## 7. Рекомендации по исправлению (P0/P1/P2)

### P0 — до мейннета (обязательно)
1. **Закрыть P0-1:** либо реализовать on-chain проверку Ed25519-подписи издателя в `register_manifest_verification` (pubkey издателя из whitelist/root-key registry), либо исключить этот аккаунт из trust-пути; **обязательно** связать `leaf_hash` с `content_hash`/`manifest_id` в `verify_merkle_proof` (проверять, что leaf = hash(manifest_id ‖ content)) — иначе Merkle-утверждение не является утверждением о манифесте.
2. **Закрыть P0-2:** оракул должен брать `device_id`/pubkey/состояние **только** из on-chain `EnergyProducer` (fetch при каждом proof или локальный read-through кэш с инвалидацией); собственный реестр устройств — либо удалить, либо свести к кэшу с принудительной сверкой. Устранить два контура регистрации (единый PoP-формат и единый реестр).
3. **Закрыть P0-3:** дефолты прошивки — только HTTPS с вшитым корневым сертификатом; запретить `http://` для OTA/manifest (или явный dev-only флаг); добавить `compatible_models`/`min_attestation_policy` в firmware-манифест и проверку на устройстве.
4. **Секреты:** убрать WiFi-креды из трекаемого `.ino` (пустые дефолты + компиляционные `-D`); перенести `firmware-signing-keypair.json` в реальное холодное хранилище.

### P1 — до мейннета (важно)
5. Синхронизировать on-chain и off-chain Policy Engine (единый источник параметров; оракул не должен «принимать» proof, который on-chain гарантированно отклонит; отказаться от silent-fallback дефолтов `policy_registry = None` на mainnet).
6. Реализовать честный пул: либо on-chain распределение (подключить `pool`/`pool_share` в `mintEnergy`), либо убрать фейковое «tokens distributed» из off-chain ответа.
7. `set_vault_authority`/`set_oracle_admin`/`update_members` — двухшаговая смена + multisig/timelock (признанный TODO(audit)).
8. Вынести экономику (mint, комиссии, buyback, vesting) из `enrg-mvp` в `enrg-profile` (полный CPI) — закрыть ADR-0006; исправить номера ADR в переведённом ADR-0006.
9. Починить Docker-деплой оракула (build context с `server.js` или перенос в `oracle/`), `npm start`, удалить `manifestRoutes.js` (или привести к SHA-256 и обязательному ключу), перейти на каноническую сериализацию (RFC 8785 / детерминированный порядок ключей).
10. Починить тесты: `test_deploy_simulation` (единый snake_case), TS-ошибки (20 шт.), включить `anchor build` в CI или вынести IDL-зависимые проверки.
11. Обеспечить персистентность Manifest Registry, регламент ежедневного якорения Merkle-корней (ADR-0007 п.7) и публикацию firmware-манифестов в него (ADR-0008).
12. Ввести on-chain проверку актуальности манифеста на устройстве: сверять `policy_version`/`heartbeat_interval` (поля ADR-0004) — сейчас они отсутствуют.

### P2 — пост-мейннет / roadmap
13. COSE/CBOR-аттестация и Root Key Registry/chain-of-trust (ADR-0007); негативные Merkle-proofs; batch verification.
14. Полный governance ADR-0009: token-holder voting, делегирование, Guardians multisig, emergency flow, исполнение произвольных инструкций.
15. Очистка репозитория: мёртвые скрипты, EVM-дубликаты (`EnrgOracleAttestation.sol` ×2), `create_contract_v2.py`, `.anchor/program-logs` из git; объединение v7/v8-спецификаций; единая позиция «ENRG — Domain Profile на AXIS», устранение MIT/Apache-2.0-конфликта.
16. `npm audit` — обновить `@solana/web3.js`; TLS-терминация на реверс-прокси, закрыть CORS.

---

## 8. Вывод: готов ли ENRG к мейннету

**Нет, ENRG не готов к мейннету с точки зрения соответствия AXIS** (объективная оценка ≈ 55 %).

- **Что действительно готово:** on-chain trust-ядро (ADR-0001/0002/0005, двойные Ed25519-подписи, nonce/freshness, OracleRegistry, отзыв/ротация ключей, PolicyRegistry, supply-cap с неизменным mint-authority PDA) — уровень закрытого тестнета; devnet-деплой проверен и совпадает с локальной сборкой по SHA-256; схемы идентичны эталону.
- **Что блокирует:** P0-1 (Manifest Registry без верификации подписей + непривязка Merkle-leaf к манифесту), P0-2 (нарушение ADR-0002 в активном контуре оракула), P0-3 (HTTP-транспорт по умолчанию в прошивке). Плюс системные расхождения ADR-0006 (экономика в ядре), ADR-0007 (нет root-of-trust registry/COSE), ADR-0008 (неполный firmware-манифест/TLS), ADR-0009 (governance — узкий MVP), и неработающий (но заявляемый) off-chain пул.
- **Противоречие в статусе:** коммит `61e6faa` заявляет «100% готовность к мейннету», `docs/STATE.md` — «P0 закрыты», но собственный `docs/protocol/deployment/mvp-release-readiness.md` и `docs/AXIS_CONFORMANCE_AUDIT_2026-08-16.md` (52 %) фиксируют «mainnet deferred», а перечисленные выше P0 остаются в коде.
- **Минимальный путь:** закрыть 3 P0 + ~8 P1 (§7), затем независимый повторный аудит по чек-листу ADR-0001…0009 и двухсторонний e2e (ESP32 → Oracle → mint) с TLS и реальным устройством на SE050.

---

## 9. Статус исправлений (2026-08-18, код изменён)

> Раздел добавлен после внесения исправлений. Все изменения прошли проверку:
> `anchor build` OK, Rust unit-тесты 92/92, mocha 76/76, pytest 37/37,
> `npx tsc --noEmit` 0 ошибок, `node --check` OK.

### Закрыто (исправлено в коде)

| ID | Проблема | Что сделано |
|---|---|---|
| **P0-1** | Manifest Registry не верифицирует подписи издателя; Merkle-leaf не привязан к содержимому | `instructions/manifest_verification.rs`: проверка Ed25519-подписи издателя (издатель == `registry.oracle_authority`), `verified=true`; `instructions/merkle_proof_verification.rs`: `manifest_leaf_hash = SHA-256(manifest_id‖content_hash)` + C-4-проверка (`InvalidManifestLeaf`); `error.rs` — новые ошибки; `oracle/registry/app.js`: канонизация (RFC-8785-стиль), единая схема leaf, 16-байтный `manifest_id`; удалён мёртвый `routes/manifestRoutes.js` (insecure-ключ + keccak); обновлён `tools/publisher.js`; merkle-тест переписан под новые сигнатуры |
| **P0-2** | Оракул ведёт собственный реестр как источник истины | `server.js /proof/submit`: публичный ключ и nonce берутся **только** из on-chain `EnergyProducer` PDA; устройство без on-chain-регистрации отклоняется `404 device_not_registered_on_chain`; `mintEnergy(proof, producerOverride)` — без двойного RPC |
| **P0-3** | Прошивка по умолчанию — HTTP | `esp32_proof_sender_v3.ino`: дефолты URL → HTTPS, `transport_allowed()` блокирует `http://` (кроме `ENRG_ALLOW_HTTP=1` dev) в proof/manifest/OTA; WiFi-креды убраны из исходника |
| **P1-6** | Off-chain пул «распределяет токены» | `server.js`: честный ответ `pool_threshold_reached_offchain_distribution_not_implemented` вместо сброса счётчика и ложного «tokens distributed» |
| **P1-9** | Docker/npm start сломаны | `oracle/Dockerfile` + `docker-compose.yml`: build context = корень репозитория, копируются `server.js/policy.js/storage.js` + IDL; `package.json start` → `node server.js`; добавлен `.dockerignore` |
| **P1-10** | Тесты не компилируются / падают | `tsconfig.json` (`noEmit`, `allowImportingTsExtensions`); `helpers/merkle.ts` — единая схема leaf; merkle/devnet-merkle/debug-program/device-lifecycle/key-rotation — типизация и аккаунты (`accountsStrict` для PDA); `test_mainnet_critical.py` — snake_case fallback; `bs58` → `.default` (v6) в policy.js и тестах; `tests/manifest.test.js` — поведение ADR-0002 |
| **P1-12** | Манифест не содержит полей ADR-0004 | `policy.js`/`server.js`/прошивка: добавлены `trust_level`, `heartbeat_interval`, `proof_threshold`, `policy_version`, `verifier_endpoint`; каноническое сообщение подписи расширено и синхронизировано (оракул ↔ прошивка) |
| **P1 (канонизация)** | `JSON.stringify` для подписей/leaf-хэшей | `oracle/registry/app.js`, `tools/publisher.js`: детерминированная канонизация (сортировка ключей, RFC-8785-стиль); устранено двойное хэширование листьев (off-chain корень теперь сходится с on-chain) |

### Документация (P2)

- `docs/architecture/adr/ADR-0006-*.md`: исправлены номера ADR (Policy Engine = ADR-0003, ADR-0001 = ключи, ADR-0004 = манифест).
- `adr/ADR-00X-*.md` §7.1: актуализирован (Policy Engine разделён 2026-08-17, отмечен остаточный риск `policy_registry = None`).
- `docs/protocol/ENRG_Protocol_Specification.md`: License MIT → Apache 2.0.
- `oracle/README.md`: on-chain регистрация (P0-2), честные пулы, поля манифеста ADR-0004.

### Осталось (не исправлено — требует решений/миграций)

- **P1-5:** синхронизация двух Policy Engine (on-chain `PolicyRegistry` vs off-chain `policy.js`) и отказ от silent-fallback `policy_registry = None` на mainnet.
- **P1-7:** multisig/timelock для `set_vault_authority`/`set_oracle_admin`/`update_members` (двухшаговая смена; требует миграции layout `Vault`).
- **P1-8:** вынос экономики (mint/комиссии/buyback/vesting) из `enrg-mvp` в `enrg-profile` (ADR-0006 полное разделение).
- **P1-11:** персистентность Manifest Registry + регламент ежедневного якорения Merkle-корней (ADR-0007 п.7).
- **P2:** COSE/CBOR-аттестация и Root Key Registry; полный governance ADR-0009 (token-holder voting, Guardians); очистка мёртвых скриптов/EVМ-дубликатов; `npm audit` (10 уязвимостей, 3 high); TLS-терминация и CORS на проде.

---

## Ограничения аудита

- Анализ статический (без запуска on-chain транзакций и без сборки прошивки).
- Runtime-поведение Merkle-слоя не подтверждено (TS-тесты не компилируются, `describe.skip`/`it.skip` в merkle- и governance-тестах).
- Фактические значения деплоя взяты из `docs/DEVNET_VERIFICATION.md` (заявлены автором; по SHA-256 совпадают с локальной сборкой на момент верификации).
- Числовые оценки компонентов — экспертные, на основе количества и весомости найденных расхождений.
