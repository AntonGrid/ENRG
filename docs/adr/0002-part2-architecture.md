# ADR-0002: ENRG Part II Architecture and Trust Model

## Status

Accepted

## Context

ENRG должен обеспечить безопасную и верифицируемую работу физических устройств (энергетика и смежные сценарии) с on-chain логикой (смарт-контракты, DAO, токеномика).

Для этого нужно:

- Чётко определить роль устройства и его идентичность.
- Отделить off-chain инфраструктуру (Provisioning, Registry, Policy, Oracle) от on-chain части (смарт-контракты, DAO).
- Минимизировать объём данных и логики, попадающих on-chain.
- Иметь воспроизводимый и тестируемый “минимальный срез” системы (Part II), который можно расширять до mainnet-ready.

## Decision

В Part II принимается следующая архитектура и trust-модель.

### Компоненты

1. **Device (Устройство)**  
   - Генерирует и хранит приватный ключ (например, Ed25519).
   - Подписывает payload’ы (DeviceProof) своим приватным ключом.
   - Не раскрывает приватный ключ наружу.

2. **Provisioning Service (PS)**  
   - Принимает `public_key` от устройства (или от заводского/интеграционного процесса).
   - Назначает `device_id` и связывает его с `public_key` и `manifest_ref`.
   - Создаёт `DeviceRecord` в Device Registry.
   - Выдаёт базовый `bootstrap_policy` (минимальные права/лимиты для старта).

3. **Device Registry (DR)**  
   - Хранит `DeviceRecord` как **источник истины по идентичности устройства и жизненному циклу**.
   - Поля `DeviceRecord` включают:
     - `device_id`
     - `public_key`
     - `owner` (опционально)
     - `lifecycle_state` (`provisioned`, `active`, `suspended`, `retired`)
     - `firmware_version` (опционально)
     - `manifest_ref`
     - `created_at`, `updated_at`
     - `labels` (произвольные теги)
   - Все записи валидируются JSON Schema `device_record.schema.json`.

4. **Policy Engine (PE)** *(пока мок/заглушка)*  
   - Принимает `DeviceProof` и контекст (политики, состояние устройства).
   - Выносит решение: разрешить/запретить действие, лимиты (например, `max_power_kw`).
   - В текущем мок-сервисе это часть эндпоинта `/provisioning/attest`, возвращающая фиксированное решение (`mock-allowed`).

5. **Oracle Service (OR)** *(будет реализован в следующих частях)*  
   - Принимает решения Policy Engine и/или DeviceProof.
   - Формирует on-chain attestation (подписанный oracle-подписью артефакт).
   - Отправляет транзакции в смарт-контракты (например, регистрирует события или изменяет лимиты).

6. **Smart Contracts (SC)** *(будут реализованы в следующих частях)*  
   - Принимают attestations от доверенных Oracle.
   - Учитывают состояние устройств (active/suspended/retired) и их лимиты.
   - Влияют на токеномику, расчёт вознаграждений/штрафов и другие on-chain эффекты.

7. **DAO / Governance** *(позже)*  
   - Управляет списком доверенных Oracle.
   - Принимает решения о параметрах протокола, лимитах, обновлениях.

### Trust-модель

1. **Корень доверия — приватный ключ на устройстве**  
   - Устройство генерирует ключевую пару.
   - Приватный ключ не покидает устройство.
   - Всё, что устройство “говорит” в рамках DeviceProof, подтверждается подписью.

2. **Device Registry как источник истины по идентичности и lifecycle**  
   - Связывает `device_id` с `public_key`, `manifest_ref` и состоянием (`lifecycle_state`).
   - Любые решения Policy Engine и Oracle зависят от корректности и целостности DR.
   - DR валидирует данные через JSON Schema, минимизируя риск структурного бардака.

3. **Policy Engine / Oracle как интерпретаторы доверенной информации**  
   - Policy Engine читает:
     - DeviceProof (подписанные данные устройства),
     - текущее состояние DR,
     - политики.
   - Oracle доверяет Policy Engine (или реализует его внутри себя) и формирует attestations для on-chain.

4. **On-chain часть минимальна и работает с attestations**  
   - Смарт-контракты не валидируют сырые DeviceProof.
   - Смарт-контракты доверяют только attestations от доверенных Oracle (список которых управляется DAO).
   - Это сокращает нагрузку и сложность on-chain-логики и даёт гибкость на off-chain уровне.

## Consequences

1. **Появился чёткий каркас off-chain части**  
   - `Provisioning Service` + `Device Registry` + `Attestation endpoint` реализованы как FastAPI-сервис.
   - Форматы артефактов зафиксированы JSON Schema:
     - `device_record.schema.json`
     - `device_manifest.schema.json`
     - `device_proof.schema.json`
   - API описан в `openapi.yaml`.
   - Поведение покрыто pytest-тестами.

2. **On-chain часть может развиваться независимо**  
   - Контракты будут работать с attestations от Oracle и не зависят от деталей форматирования DeviceProof.
   - Изменения во внутренних схемах (например, добавление полей в `DeviceRecord` или `DeviceManifest`) не требуют миграций контрактов, если формат attestations стабилен.

3. **Ясная эволюционная дорожка к mainnet**  
   - Part II (текущая стадия): мок-сервис с Provisioning, Registry и простым Attest.
   - Part III: вынос Policy Engine и Oracle в отдельные сервисы, определение формата attestations.
   - Part IV: реализация смарт-контрактов и базовой токеномики, интеграция с Oracle.
   - Part V: пилоты, аудит, переход к testnet/mainnet.

4. **Риски и ограничения**  
   - Пока DR и Policy Engine/Oracle не реплицированы и не децентрализованы — это точка доверия (trustful service).
   - Нужны дополнительные меры:
     - аутентификация/авторизация для админских операций с DR,
     - аудит изменений записей в DR,
     - мониторинг и логирование решений Policy Engine.
   - Эти аспекты будут закрываться в следующих частях (после Part II).

## Implementation Notes (на текущую дату)

- Реализация мок-сервиса:
  - Python + FastAPI.
  - Валидация JSON через `jsonschema` (`Draft7Validator`).
  - In-memory Device Registry (словарь в памяти) для прототипа.
- Основные эндпоинты:
  - `GET /health`
  - `POST /provisioning/register`
  - `GET /registry/devices/{device_id}`
  - `POST /provisioning/attest`
- Тесты:
  - `tests/test_api.py`
  - `tests/test_smoke.py`

Этот ADR фиксирует архитектурные решения Part II и служит базой для последующих этапов (Oracle, on-chain контракты, DAO).
