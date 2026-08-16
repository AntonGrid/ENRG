# Аудит соответствия ENRG требованиям AXIS Protocol и AXIS Core

**Дата:** 2026-08-16
**Режим:** только чтение/анализ (код не изменялся)
**Объект:** `/home/enrg/Axis-workspace/ENRG`
- `programs/enrg-mvp/` — on-chain Core Protocol (Solana/Anchor)
- `programs/enrg-profile/` — Domain Profile (EnergyProfile)
- `server.js`, `storage.js`, `oracle/` — оракул и manifest registry
- `firmware/esp32_proof_sender/` — прошивка ESP32
- `app/`, `schemas/`, `docs/`, `adr/` — FastAPI-слой, схемы, документация

**Эталоны:**
- `/home/enrg/Axis-workspace/Axis-protocol` — `spec/protocol/{model,wire-format,lifecycle,validation}.md`, `adr/ADR-0001…0009`
- `/home/enrg/Axis-workspace/Axis-core` — `axis_core/*` (FastAPI), `oracle/*` (Node.js registry), `schemas/*`, `docs/merkle-proof-verification.md`, `axis_core/onchain_bridge.py`

---
## 1. Executive Summary

### 1.1. Общий уровень соответствия

| Компонент | Уровень соответствия | Оценка |
|---|---|---|
| **Core Protocol** (on-chain `enrg-mvp`) | **Частичное** | ≈ 60 % |
| **Domain Profile** (`enrg-profile`) | **Частичное** | ≈ 55 % |
| **Oracle** (`server.js`, `storage.js`, `oracle/registry`, `app/`) | **Частичное** | ≈ 55 % |
| **Firmware** (ESP32 v3, legacy v1) | **Частичное / Не соответствует** | ≈ 35 % |
| **Итого** | **Частичное соответствие** | **≈ 52 %** |

**Одной фразой:** on-chain ядро ENRG — самая сильная часть (жизненный цикл ADR-0005, двойные Ed25519-подписи, OracleRegistry, anti-replay nonce/freshness реализованы корректно и совпадают с ADR-0001/0002/0005), но архитектурные решения ADR-0003 (Policy Engine), ADR-0004 (Manifest на устройстве), ADR-0006 (разделение Core/Profile), ADR-0007 (secure key management, ротация, подпись манифестов), ADR-0008 (OTA) и ADR-0009 (governance в полном объёме) **не реализованы или реализованы частично и осознанно вынесены как «MVP-отклонения»** (`adr/ADR-00X-enrg-core-vs-energy-profile.md §7`). Проект сам декларирует статус: «ready for **devnet**, mainnet deferred» (`docs/protocol/deployment/mvp-release-readiness.md:3-4`).

### 1.2. Сильные стороны (соответствует AXIS)

1. **ADR-0005 — жизненный цикл устройств**: 8 состояний и матрица переходов точно совпадают с ADR-0005 (`programs/enrg-mvp/src/state/producer.rs:3-37`).
2. **ADR-0001 — ключ не покидает устройство**: регистрация и claim требуют Ed25519-подпись устройства через Solana-precompile (`device_lifecycle.rs:54-77`, `security/lifecycle.rs:27-62`, `security/mod.rs:34-73`); ключ устройства не хранится ни on-chain, ни у оракула.
3. **ADR-0002 — registry как источник истины**: `EnergyProducer` PDA `[b"producer", device_id]` хранит состояние, владельца, nonce, tier; изменение только через registry-инструкции.
4. **Trust-конвейер model.md**: Proof → Attestation (OracleReport с двумя подписями) → Digital Claim (mint) воспроизводится точно (`state/oracle.rs:12-65`, `mint.rs:28-90`).
5. **Проверки nonce/timestamp**: строгий монотонный nonce (`security/validation.rs:13-16`), свежесть 15 мин и skew 5 мин синхронизированы между on-chain и оракулом (`constants.rs:19-20`, `server.js:654-657`, `security/validation.rs:9-10`).
6. **JSON-схемы** (`schemas/*.schema.json`) побайтово идентичны эталону Axis-core (проверено `diff -q` по 5 файлам).
7. `app/main.py` напрямую переиспользует reference-реализацию Axis-core (axis_core FastAPI).

### 1.3. Критические проблемы (кратко)

- **P0-1.** В git-репозитории лежит legacy-прошивка `esp32_proof_sender.ino` с **захардкоженным приватным ключом** и отправкой по **HTTP** (`firmware/esp32_proof_sender/esp32_proof_sender.ino:22-35,7`) — прямое нарушение ADR-0001/ADR-0007.
- **P0-2.** On-chain `register_manifest_verification` **не проверяет Ed25519-подпись** издателя манифеста — любой может зарегистрировать произвольный `ManifestVerification` (`instructions/manifest_verification.rs:22-50`); `verify_merkle_proof` не связывает `leaf_hash` с `content_hash` манифеста (`instructions/merkle_proof_verification.rs:143-182`).
- **P0-3.** `server.js` при минте подписывает OracleReport **ключом founder** и минтит в **ATA founder** (`server.js:35-37, 395-405, 418`), а on-chain `mint_energy` требует `producer.authority == authority` (`mint.rs:56-59`) — оракул физически не сможет минтить для устройств, заклеймленных на других владельцев. Мульти-владельческий мейннет сломан.
- **P0-4.** Policy Engine (ADR-0003) отсутствует: решения (quarantine/allow/mint) принимаются в `mint_energy` и в самом оракуле — осознанное отклонение, но для мейннета это блокер по спецификации.
- **P0-5.** Устройство не получает и не проверяет подписанный Device Manifest (ADR-0004): конфигурация захардкожена в прошивке; манифест на устройстве не верифицируется; OTA (ADR-0008) отсутствует полностью.

---

## 2. Методология и источники

Сравнение проводилось **только с нормативными документами AXIS** (не с «идеальным проектом»):

- `Axis-protocol/spec/protocol/model.md`, `wire-format.md`, `lifecycle.md`, `validation.md`;
- `Axis-protocol/adr/ADR-0001…0009`;
- `Axis-core/axis_core/*` (FastAPI), `Axis-core/oracle/*` (Node.js registry), `Axis-core/schemas/*`, `Axis-core/docs/merkle-proof-verification.md`, `Axis-core/axis_core/onchain_bridge.py`.

Проверены: PDA и seeds, структуры данных, жизненный цикл устройства, Ed25519-проверки, Merkle-логика, формат proof/attestation, схемы, API-поверхность, безопасность ключей, OTA, governance.

---

## 3. Соответствие требованиям (сводная таблица)

| Требование AXIS | Статус в ENRG | Где реализовано / где нарушено |
|---|---|---|
| ADR-0001: ключ не покидает устройство | ✅ Полное (on-chain), ⚠️ Частичное (firmware) | `device_lifecycle.rs:54-77`; firmware v3 NVS/ATECC; **legacy v1 — нарушение** |
| ADR-0002: Registry — источник истины | ✅ Полное (on-chain) | `state/producer.rs`, `device_lifecycle.rs` |
| ADR-0003: Policy Engine отделён от Verifier | ❌ Не соответствует (MVP-отклонение) | `mint.rs:18-27` (явный комментарий), `ADR-00X §7.1`; решения в `server.js` |
| ADR-0004: подписанный Device Manifest на устройстве | ❌ Не реализовано | Firmware — хардкод конфигурации; манифест не читается/не проверяется |
| ADR-0005: состояния и переходы | ✅ Полное | `state/producer.rs:3-37` — матрица совпадает с ADR-0005 |
| ADR-0006: Core vs Domain Profile | ⚠️ Частичное | `enrg-profile` вынесен; экономика осталась в ядре (`ADR-00X §7.2`) |
| ADR-0007: управление ключами, ротация, аттестация, подпись firmware | ⚠️ Частичное / ❌ | Ed25519 везде, но нет ротации, нет root-key registry, нет COSE/CBOR, нет подписи прошивки |
| ADR-0008: OTA и безопасные обновления | ❌ Не реализовано | Нет механизма OTA, dual-bank, anti-rollback |
| ADR-0009: governance | ⚠️ Частичное (MVP) | `governance.rs` — members-голосование + timelock 7 дней; нет голосования токенами, Guardians, emergency flow |
| wire-format.md: детерминированный формат | ⚠️ Частичное | Оракул — JSON; on-chain — бинарный канонический OracleReport (свой формат, документирован в ENRG ADR-001); Trust Envelope/MessageHeader не реализованы |
| Merkle-верификация манифестов | ⚠️ Частичное | SHA-256 on-chain совпадает с off-chain registry; но подпись издателя не проверяется on-chain, leaf не привязан к content |

---

## 4. Таблица расхождений

### 4.1. Core Protocol (programs/enrg-mvp)

| № | Требование AXIS | Факт в ENRG | Почему не соответствует | Ссылки |
|---|---|---|---|---|
| C-1 | ADR-0003: Verifier ≠ Policy Engine | Verifier и политики совмещены в `mint_energy` (whitelist оракулов, гейтинг состояния, tier-лимиты, supply-cap, распределение фондов) | ADR-0003: «Verifier executes actions **only after confirmation** from Policy Engine». Разделение не реализовано; осознанное отклонение | `mint.rs:18-27`, `ADR-00X §7.1` |
| C-2 | ADR-0003: решения quarantine/maintenance принимает Policy Engine | Решения принимает владелец через явные owner-gated инструкции (`quarantine_device`, `maintenance_device` и т.д.); аномалии фиксирует оракул через `report_anomaly`, но state не меняет | Решение о quarantine принадлежит владельцу/оракулу, а не Policy Engine | `device_lifecycle.rs:297-307`, `lib.rs:337-342`, `ADR-00X §7.4` |
| C-3 | ADR-0002/0007: верификация подписи издателя манифеста | `register_manifest_verification` **просто сохраняет** `publisher_key` и `signature`, поле `verified=false`, подпись не проверяется | Любой аккаунт может зарегистрировать произвольный манифест; on-chain не обеспечивает подлинность манифестов | `instructions/manifest_verification.rs:22-50`, `state/manifest_verification.rs:4-28` |
| C-4 | Merkle-верификация: leaf привязан к содержимому манифеста | `verify_merkle_proof` принимает `leaf_hash` от вызывающего и сверяет только с корнем; `content_hash` (Keccak) из `ManifestVerification` не используется | On-chain доказывает лишь «некий leaf в дереве», а не «leaf = содержимое манифеста N». Привязка — только off-chain (это же ограничение у reference, но оно перенесено без усиления) | `merkle_proof_verification.rs:143-182`, `state/manifest_verification.rs:11` |
| C-5 | ADR-0007: ротация/отзыв ключей устройства | `device_id` = публичный ключ устройства, неизменяем; ротации и отзыва ключа нет; `set_oracle_authority` — мгновенная смена без timelock | ADR-0007 §4: «Keys MUST support rotation», «Old keys MUST be revocable» | `state/producer.rs:106-107`, `lib.rs:82-87`, `manifest_registry.rs` (SetOracleAuthority) |
| C-6 | ADR-0009: governance (голосование токенов, deposit, Guardians, emergency) | MVP: 3–5 members, голосование 1 голос/member, кворум `yes>no && yes+no>members/2`, timelock 7 дней, исполнение только `governance_mint` | Нет голосования по весу токенов, нет депозита, нет роли Guardians и emergency-флоу, нет quorum/threshold как параметров, нет обновления любых параметров | `instructions/governance.rs:1-220`, `constants.rs:109-115` |
| C-7 | ADR-0009/0007: multisig для критических операций | `set_vault_authority` — одношаговая смена без timelock/multisig | Высококритичная операция без защиты; помечено TODO(audit) | `instructions/initialize.rs` (set_vault_authority), `docs/STATE.md:25,158-159` |
| C-8 | ADR-0007: якорение Merkle-корней (ежедневно/по расписанию) | Корень обновляется вручную инструкцией `update_merkle_root` по усмотрению оракула; нет расписания якорения | ADR-0007 §7: рекомендовано периодическое якорение (ежедневный root); emergency-якорение не реализовано | `instructions/manifest_registry.rs:97-120` |



### 4.2. Domain Profile (programs/enrg-profile) и разделение слоёв

| № | Требование AXIS | Факт в ENRG | Почему не соответствует | Ссылки |
|---|---|---|---|---|
| P-1 | ADR-0006: Core не знает о токенах/эмиссии | `enrg_mvp` содержит mint, tier, ERS, pool, buyback, vesting, supply-cap | Core смешан с экономикой энергопрофиля. `enrg-profile` вынесен частично (EnergyProfile, rated_power ≤ 1 МВт, 30-дневное окно) | `ADR-00X §7.2`, `lib.rs:20-393`, `programs/enrg-profile/src/lib.rs:13-80` |
| P-2 | ADR-0006: профиль не знает о trust | `enrg-profile` знает только про владельца и мощность — ✅, но вызывается из `enrg_mvp::mint_energy` по CPI | Частично соответствует; полная изоляция не достигнута (одна программа владеет и ядром, и экономикой) | `mint.rs:456-489` |

### 4.3. Oracle (server.js, storage.js, oracle/registry, app/)

| № | Требование AXIS | Факт в ENRG | Почему не соответствует | Ссылки |
|---|---|---|---|---|
| O-1 | ADR-0003: оракул = Verifier (только криптография), решения — у Policy Engine | `server.js` сам принимает решения (лимит энергии на отчёт, порог накопления, минт при пороге); в `app/api/oracle.py` — собственные policy-правила (limit 5 kW) | Verifier и Policy Engine совмещены в оракуле | `server.js:649-655, 780-808`, `app/api/oracle.py:157-171` |
| O-2 | ADR-0002: единый источник истины — Registry | Оракул ведёт **параллельную** off-chain БД устройств и энергии (`devices`, `energy_store`, `pools`) без синхронизации с on-chain `EnergyProducer` | Состояние может рассинхронизироваться; ADR-0002 требует единый источник | `storage.js:32-52`, `server.js:48-50` |
| O-3 | ADR-0003/0001: оракул — отдельная доверенная роль | Оракул = **founder-ключ** (`FOUNDER_WALLET`); on-chain OracleRegistry должен содержать этот ключ; минт — в ATA founder | Концентрация ролей (founder=деплойер=authority=оракул), один оракул на весь протокол | `server.js:35-42, 395-405`, `constants.rs:101`, `state/registry/oracle.rs:19-24` |
| O-6 | Axis-core: off-chain API (registry/provisioning) | `app/main.py` импортирует `axis_core` напрямую — FastAPI-слой фактически копия Axis-core | Это переиспользование reference, не расхождение, но означает, что ENRG не имеет собственной off-chain реализации provisioning/registry | `app/main.py:3-5` |
| O-7 | Axis-core: manifest registry (Node.js) | `oracle/registry/app.js` — усовершенствованная копия Axis-core: обязательный `REGISTRY_ADMIN_KEY` ≥ 32 симв., SHA-256 root, leaf = sha256(manifest_id ‖ payload) | Соответствует и усилено vs Axis-core. **НО** дублирующий файл `routes/manifestRoutes.js` — мёртвый код с `keccak256` и дефолтным ключом `'secure-key'` (не подключён в `app.js`, но опасен при подключении) | `oracle/registry/app.js:14-19,40-81`, `oracle/registry/routes/manifestRoutes.js:4,8` |
| O-8 | Axis-core: persistence/восстановление | `storage.js` — Postgres/SQLite (усиление), но `oracle/registry` хранит манифесты в `Map` в памяти | Потеря данных при рестарте registry; ADR-0002 требует high availability | `oracle/registry/app.js:22-23`, `storage.js:19-51` |
| O-9 | Legacy-артефакты EVM | `contracts/EnrgOracleAttestation.sol`, `onchain/` (Foundry), `onchain_bridge.py`, `docs/onchain-attestation.md` описывают EVM-мост keccak | Не относится к текущему Solana-степу; создаёт дрейф документации и риск ложного понимания | `contracts/EnrgOracleAttestation.sol`, `docs/onchain-attestation.md` |
| O-10 | Единый формат device_id | On-chain: pubkey-как-id; off-chain схема `device_record.schema.json`: `^dev_[0-9a-f]{16}$`; `server.js` принимает base58/0x-hex | Форматы не согласованы между схемами и кодом | `schemas/device_record.schema.json:22-27`, `server.js:501-506` |
| O-11 | Состояния в off-chain схеме | `lifecycle_state` enum в схеме: `provisioned/active/suspended/retired` (4 состояния) vs on-chain 8 состояний ADR-0005 | Off-chain DeviceRecord не отражает on-chain state machine | `schemas/device_record.schema.json:36-44`, `state/producer.rs:3-13` |

### 4.4. Firmware (ESP32)

| № | Требование AXIS | Факт в ENRG | Почему не соответствует | Ссылки |
|---|---|---|---|---|
| F-1 | ADR-0001: подпись только на устройстве | ✅ v3: ключ генерируется при первой загрузке, подпись в CPU, binary-формат `device_id(32)\|\|nonce(8)\|\|ts(8)\|\|energy_wh(8)` совпадает с `OracleReport::device_message_to_sign()` | Соответствует | `firmware/esp32_proof_sender/src/esp32_proof_sender_v3.ino:250-280`, `state/oracle.rs:42-51` |
| F-2 | ADR-0001/0007: ключ в Secure Element, подпись аппаратно | Ключ в NVS (flash) либо в Data-Zone слоте ATECC608A; **Ed25519-подпись выполняется в CPU** (ATECC608A не поддерживает Ed25519) | ADR-0007 §4: «Private keys MUST be stored in secure hardware module (SE/eFuse/TPM)». NVS без secure boot не соответствует; аппаратная подпись — TODO | `esp32_proof_sender_v3.ino:186-250, 349-368`, `README.md:16-19` |
| F-3 | ADR-0001 (нарушение): legacy-прошивка с ключом в git | `esp32_proof_sender.ino` содержит **захардкоженный приватный ключ** (`0x01…0x20`) и публичный ключ, отправляет по **HTTP** | Прямое нарушение: приватный ключ опубликован в репозитории; любой может подписывать proofs от имени устройства | `firmware/esp32_proof_sender/esp32_proof_sender.ino:22-35,7` (файл отслеживается git — подтверждено `git ls-files`) |
| F-4 | ADR-0004: устройство хранит подписанный Manifest и сверяет policy_version | Конфигурация захардкожена через `#define` (`ENRG_ORACLE_URL`, `ENRG_REPORT_INTERVAL_MS` и т.д.); манифест не загружается, не проверяется, `policy_version` отсутствует | ADR-0004 не реализован | `esp32_proof_sender_v3.ino:34-90` |
| F-5 | ADR-0007 §6/ADR-0008: подпись firmware, верификация перед установкой, OTA | Нет механизма OTA, нет dual-bank, нет подписи прошивки, нет anti-rollback | ADR-0008 полностью не реализован | firmware (отсутствие соответствующих модулей) |
| F-6 | ADR-0007: транспорт TLS | ✅ v3: HTTPS с проверкой корневого CA, mTLS опционально | Соответствует (v1 — нарушение, см. F-3) | `esp32_proof_sender_v3.ino:41-66, 300-344` |
| F-7 | On-chain жизненный цикл: устройство само проходит register/claim | Прошивка реализует только отправку proof; on-chain register/claim выполняются скриптами/владельцем, а не устройством | Полный конвейер ADR-0005 (device-driven registration) на устройстве не реализован | `esp32_proof_sender_v3.ino` (нет register/claim), `scripts/create-producer-device.js` |

### 4.5. Документация / конформность

| № | Проблема | Ссылки |
|---|---|---|
| D-1 | `docs/specifications/ENRG_Conformance.md` ссылается на **устаревший** program id `9rVoq…XF` (архивирован как legacy; актуальный — `HkuC3…`) | `ENRG_Conformance.md:79`, `docs/STATE.md:172-176` |
| D-2 | `docs/merkle-proof-verification.md` (копия Axis-core) описывает `keccak256` как `sha256` (неоднозначность перенесена из reference), а фактически on-chain и `oracle/registry/app.js` используют SHA-256; `routes/manifestRoutes.js` — keccak256 | `docs/merkle-proof-verification.md:51-56`, `merkle_proof_verification.rs:5-99`, `oracle/registry/app.js:40-43`, `oracle/registry/routes/manifestRoutes.js:4` |
| D-3 | README оракула описывает `/api/v1/proof/submit`, но файл `server.js` лежит в корне, а не в `oracle/`; внутри `oracle/registry/` — отдельный сервис | `oracle/README.md:1-17`, корневой `server.js` |
| D-4 | `docs/SECURITY_AUDIT_2026-08-16.md` фиксирует критические уязвимости (CR-1..CR-3), которые **уже исправлены** в текущем коде — документ устарел и требует пересмотра статусов | `docs/SECURITY_AUDIT_2026-08-16.md`, текущий `server.js:527-589, 649-815` |


| O-4 | ADR-0001/0005: устройства с другими владельцами | `mint_energy` требует `producer.authority == signer`; оракул подписывает founder-ключом → минт только для устройств, заклеймленных на founder | Мульти-владельческий сценарий (ядро ADR-0005 CLAIMED/owner) не работает с текущим оракулом | `mint.rs:56-59`, `server.js:418, 464-471` |
| O-5 | ADR-0007: подпись оракула должна быть проверяемой on-chain | Реализовано корректно: `oracle_signature` проверяется через precompile (✅) | Соответствует | `mint.rs:72-83`, `state/oracle.rs:55-65` |

## 5. Рекомендации по исправлению

### Core Protocol
1. **C-3 (манифесты):** добавить on-chain проверку Ed25519-подписи издателя в `register_manifest_verification` (использовать существующий паттерн `verify_ed25519_signature` через precompile), либо ограничить регистрацию только `oracle_authority` (Signer) до введения полноценного root-key registry.
2. **C-4 (Merkle):** привязать `leaf_hash` к `manifest_verification.content_hash` on-chain (например, требовать `leaf_hash == sha256(manifest_id ‖ content_hash)`), чтобы proof доказывал подлинность именно содержимого манифеста.
3. **C-1/C-2 (ADR-0003):** ввести отдельный on-chain `PolicyRegistry` под governance (или off-chain Policy Engine с подписанными решениями) — как минимум зафиксировать, что quarantine/allow/deny определяет policy, а не владелец и не оракул; убрать «встроенные» правила из `mint_energy` в параметризуемую политику.
4. **C-5 (ротация ключей):** добавить `rotate_device_key` с подписью старого и нового ключей и историей ротации в `EnergyProducer`; разрешить отзыв ключа через owner/governance.
5. **C-6 (governance):** расширить до ADR-0009: голосование по весу токенов, deposit, настраиваемые quorum/threshold, timelock как параметр, исполнение произвольных инструкций, emergency-флоу с высшим кворумом.
6. **C-7:** сделать `set_vault_authority` двухшаговым (pending + timelock), а лучше — под multisig/Governance.

### Oracle
7. **O-3/O-4 (минт):** разделить роли: оракул подписывает OracleReport ключом из `OracleRegistry` (не founder), а минт выполняется от имени владельца устройства (per-owner `authority`) либо через специализированную минт-роль; иначе мульти-владельческий мейннет невозможен.
8. **O-2:** синхронизировать off-chain БД с on-chain `EnergyProducer` (например, статус устройства и nonce брать on-chain), либо свести off-chain состояние к кэшу.
9. **O-7/O-8:** удалить мёртвый `routes/manifestRoutes.js` (keccak + дефолтный `'secure-key'`) или подключить его правильно; добавить персистентность манифестов и якорение корня по расписанию (ADR-0007 §7).
10. **O-9:** заархивировать EVM-артефакты (`contracts/`, `onchain/`, `onchain_bridge.py`, `docs/onchain-attestation.md`) с пометкой legacy, чтобы не создавать дрейф.

### Firmware
11. **F-2:** перейти на аппаратную Ed25519-подпись (NXP SE050/секурный элемент с Ed25519) или eFuse/secure boot + подпись в CPU с защищённым ключевым материалом; документировать остаточные риски NVS.
12. **F-3 (критично):** удалить legacy v1 (`esp32_proof_sender.ino`) из git (или перенести в `_archive` вне поставки), иначе приватный ключ остаётся «в проде» как постоянная бомба.
13. **F-4:** реализовать получение и проверку подписанного Device Manifest (ADR-0004): `GET /manifests?model=…`, проверка ED25519-подписи сервера, сверка `policy_version`, хранение в NVS.
14. **F-5 (ADR-0008):** внедрить OTA: подпись образа firmware-ключом, проверка hash+signature перед установкой, A/B-банки или verified boot с откатом, anti-rollback счётчик.
15. **F-7:** реализовать в прошивке подпись register/claim-сообщений (`b"enrg:device:register"`, `b"enrg:device:claim"`), чтобы устройство могло само проходить on-chain lifecycle.

### Документация
16. **D-1:** обновить `ENRG_Conformance.md` (актуальный program id `HkuC3…`), синхронизировать `STATE.md`, `SECURITY_AUDIT_2026-08-16.md` (пометить исправленные пункты), уточнить Merkle-документацию (SHA-256 vs keccak).
17. **D-2/O-10/O-11:** согласовать формат `device_id` и enum состояний между on-chain, off-chain схемами и оракулом (либо схемы, либо код).


---

## 6. Приоритетные фиксы (что делать в первую очередь)

### 🔴 P0 — блокеры мейннета (до любого продакшн-деплоя)
1. **Удалить/изолировать legacy-прошивку с захардкоженным ключом** (`esp32_proof_sender.ino`) — угроза ADR-0001/0007 на уровне доверия.
2. **On-chain верификация подписи манифеста + привязка leaf к содержимому** (C-3/C-4) — сейчас манифестный слой не даёт криптографических гарантий.
3. **Исправить минт-путь для мульти-владельцев** (O-3/O-4) — текущий оракул минтит только за founder.
4. **Решение по Policy Engine** (ADR-0003): либо реализовать, либо зафиксировать официальное отклонение со сроками — без этого формальная конформность не достигается.
5. **Устройство должно получать и проверять Manifest** (ADR-0004) + **OTA** (ADR-0008) — без этого прошивка не соответствует ADR-0004/0008.

### 🟠 P1 — до мейннета (важно)
6. Governance: multisig/timelock для admin-операций (`set_vault_authority`), ротация ключей (C-5, C-6, C-7).
7. Секьюрное хранение ключа устройства: аппаратная подпись или документированный компромисс (F-2).
8. Персистентность manifest registry + регламент якорения Merkle-корней (O-8, C-8).
9. Удалить мёртвые/legacy артефакты (routes/manifestRoutes.js, EVM-мост) (O-7, O-9).
10. Синхронизация документации и форматов (D-1…D-4, O-10/O-11).

### 🟡 P2 — пост-мейннет / roadmap
11. COSE/CBOR-аттестация, X.509, root-key registry, Guardians-multisig, полный DAO (ADR-0007/0009), negative proofs (merkle), batch verification.

---

## 7. Заключение: готов ли ENRG к мейннету

**Нет, ENRG не готов к мейннету с точки зрения соответствия AXIS.**

- Общий уровень — **частичное соответствие (≈ 50–55 %)**, что согласуется с собственным статусом проекта «ready for devnet, mainnet deferred» (`docs/protocol/deployment/mvp-release-readiness.md:4`).
- **Сильное ядро:** on-chain trust-модель (ADR-0001/0002/0005) — состояния, переходы, Ed25519-проверки, nonce/freshness, OracleRegistry — реализована корректно и на уровне, пригодном для закрытого тестнета.
- **Критические пробелы для мейннета:** отсутствие Policy Engine (ADR-0003), отсутствие Device Manifest на устройстве (ADR-0004), отсутствие OTA и подписи прошивки (ADR-0008), нереализованные ротация/отзыв ключей и root-of-trust registry (ADR-0007), сокращённый governance (ADR-0009), неработающий мульти-владельческий минт, а также legacy-прошивка с захардкоженным ключом в репозитории.
- **Минимальный путь до мейннета:** закрыть пункты P0 (5 фиксов) и P1 (5 фиксов), после чего провести независимый аудит по чек-листу ADR-0001…0009 и повторную devnet-верификацию с реальными устройствами (двухсторонний e2e: ESP32 → Oracle → mint).

---

## 8. Ограничения аудита

- Анализ проведён **статически** (без запуска on-chain транзакций на devnet и без сборки прошивки).
- Тесты `tests/merkle-proof-verification.test.ts` и `devnet-merkle-proof-verification.test.ts` содержат TS-ошибки/`describe.skip` (`docs/STATE.md:142-143, 153-157`) — runtime-поведение Merkle-слоя полностью не подтверждено.
- Полный `mint_energy` покрыт только devnet-скриптом `scripts/devnet_e2e_lifecycle.ts`, а не автоматическими тестами (`docs/STATE.md:144-149`).
- JSON-схемы сравнивались с эталоном Axis-core побайтово (`diff -q` — все 5 файлов идентичны).

