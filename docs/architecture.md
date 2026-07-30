# ENRG Architecture Overview

## Основные компоненты

1. **Backend API (FastAPI)**
   - Папка: `app/`
   - Точка входа: `app/main.py`
   - Основные роуты:
     - `/provisioning/...` — первичная аттестация устройства (DeviceProof).
     - `/registry/...` — реестр устройств и связанных сущностей.
     - `/oracle/...` — работа с oracle-аттестациями.

2. **Oracle attestation**
   - Модуль: `app/api/oracle.py`
   - Эндпоинт: `POST /oracle/attest`
   - Работает в двух режимах:
     1. **Legacy attestation**: принимает полную аттестацию, валидирует по `schemas/attestation.schema.json`, сохраняет in-memory и возвращает:
        ```json
        {
          "status": "received",
          "attestation_id": "...",
          "device_id": "...",
          "oracle_id": "..."
        }
        ```
     2. **New oracle_attest_request**: принимает запрос с полями
        `device_id`, `nonce`, `timestamp`, `algo`, `payload.max_power_kw`, `signature`,
        валидирует по `schemas/oracle_attest_request.schema.json` и возвращает:
        ```json
        {
          "device_id": "...",
          "attestation_id": "... (uuid4)",
          "decision": {
            "allowed": true,
            "max_power_kw": <число>
          }
        }
        ```
   - In-memory хранилище: словарь `_ATTESTATIONS` внутри `app/api/oracle.py`.

3. **JSON-схемы и валидация**
   - Папка: `schemas/`
     - `attestation.schema.json`
     - `device_manifest.schema.json`
     - `device_proof.schema.json`
     - `device_record.schema.json`
     - `oracle_attest_request.schema.json`
   - Утилиты:
     - `app/schema_utils.py` — загрузка и кеширование валидаторов.
     - `app/schemas_loader.py` — вспомогательные функции для работы со схемами.

4. **On-chain bridge (Python → Solidity)**
   - Модуль: `app/onchain_bridge.py`
   - Главное: `build_attestation_params(attestation: dict) -> OnchainAttestationParams`
   - Структура `OnchainAttestationParams`:
     ```python
     @dataclass
     class OnchainAttestationParams:
         attestation_id: bytes   # keccak256(attestation_id), bytes32
         device_id: bytes        # keccak256(device_id), bytes32
         allowed: bool
         max_power_w: int        # max_power_kw * 1000
         issued_at: int          # unix timestamp
     ```
   - Вспомогательные функции:
     - `_to_bytes32_hash(value: str) -> bytes` — `keccak(text=value)`.
     - `_parse_issued_at(issued_at: str) -> int` — ISO8601 (`...Z`) → unix timestamp.

   - Логика `build_attestation_params`:
     - Берёт поля из JSON-аттестации Oracle:
       - `attestation["attestation_id"]`
       - `attestation["device_id"]`
       - `attestation["decision"]["allowed"]`
       - `attestation["decision"]["max_power_kw"]`
       - `attestation["issued_at"]`
     - Бросает `KeyError`, если нет обязательных полей.
     - Возвращает `OnchainAttestationParams`, совместимый с сигнатурой функции контракта `submitAttestation(...)`.

5. **Solidity контракты и Foundry**
   - Папка: `onchain/`
   - Контракты (примерно): `ENRGOracle.sol` и/или подобные.
   - Тесты Foundry: запускаются из корня через `./run-tests.sh`, который внутри дергает `forge test` в `onchain/`.

6. **Тесты Python**
   - Папка: `tests/`
   - Ключевые:
     - `test_api.py` — базовые API-эндпоинты (включая legacy `/oracle/attest`).
     - `test_oracle_attest.py` — новый формат запроса `/oracle/attest`.
     - `test_onchain_bridge.py` — проверяет:
       - корректное построение `OnchainAttestationParams`;
       - соответствие keccak‑хэшей;
       - преобразование kW → W и issued_at → timestamp.
     - `test_oracle_storage.py` — InMemoryOracleStorage.
   - Все тесты запускаются из корня:
     ```bash
     ./run-tests.sh
     ```

7. **Инструменты и демо**
   - `tools/client.py`
     - Мини-клиент на `httpx` для обращения к API.
     - Умеет:
       - `health()` — GET `/health`.
       - `oracle_attest_request(...)` — новый формат запроса к `/oracle/attest`.
       - `build_simple_attestation(...)` + `oracle_attest_legacy(...)` — генерация и отправка legacy-аттестации.
   - `scripts/demo_onchain_bridge.py`
     - Читает `attestation-example.json`.
     - Прогоняет через `build_attestation_params`.
     - Печатает on-chain параметры, готовые для вызова Solidity-функции `submitAttestation(...)`.

## Поток данных (end-to-end)

1. **Устройство / клиент** отправляет запрос на oracle:
   - Новый формат:
     - `POST /oracle/attest` с полями `device_id`, `nonce`, `timestamp`, `algo`, `payload.max_power_kw`, `signature`.
   - Сервер:
     - Валидирует по `oracle_attest_request.schema.json`.
     - Проверяет корректность `timestamp` (ISO8601 с `Z`).
     - Генерирует `attestation_id` (UUID).
     - Формирует `decision` и сохраняет запись в `_ATTESTATIONS`.
     - Возвращает `{"device_id", "attestation_id", "decision"}`.

2. **Oracle-аттестация попадает в хранилище** (in-memory),
   а также может быть сериализована в JSON (пример — `attestation-example.json`).

3. **On-chain bridge** берёт JSON-аттестацию Oracle и строит из неё параметры для контракта:
   - `build_attestation_params(attestation)` → `OnchainAttestationParams`.

4. **On-chain контракт** (на Solidity) принимает эти параметры через функцию `submitAttestation(...)` и обновляет on-chain состояние (например, реестр разрешённых устройств и их лимитов мощности).

