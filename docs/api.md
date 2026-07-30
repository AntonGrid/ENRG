# ENRG API

## Базовая информация

- Базовый URL (локально): `http://localhost:8000`
- Проверка живости: `GET /health` → `{"status": "ok"}`

---

## 1. Oracle

### 1.1. POST `/oracle/attest`

Эндпоинт работает в двух режимах.

#### Режим A: Полная Attestation (legacy)

Используется старыми клиентами и в `tests/test_api.py`.

**Запрос (пример):**

```json
{
  "attestation_id": "att_123",
  "device_id": "dev_9e9c644e1580a83b",
  "proof": {},
  "decision": { "allowed": true, "reason": "ok" },
  "oracle_id": "oracle_main_1",
  "issued_at": "2026-07-25T19:05:00Z",
  "oracle_signature": "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe"
}
Успешный ответ (200):

{
  "status": "received",
  "attestation_id": "att_123",
  "device_id": "dev_9e9c644e1580a83b",
  "oracle_id": "oracle_main_1"
}
Ошибка валидации схемы (400):

{
  "detail": {
    "message": "Invalid Attestation",
    "error": "<сообщение jsonschema>",
    "path": ["field", "subfield"]
  }
}
Режим B: Запрос на аттестацию (новый формат)
Используется в tests/test_oracle_attest.py.

Запрос (пример):

{
  "device_id": "dev_9e9c644e1580a83b",
  "nonce": "abc12345xyz",
  "timestamp": "2026-07-25T19:05:00Z",
  "algo": "mock",
  "payload": {
    "max_power_kw": 2.5
  },
  "signature": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
}
Успешный ответ (200):

{
  "device_id": "dev_9e9c644e1580a83b",
  "attestation_id": "a6ff7c9a-9e75-4f6c-9b18-2cbb2e9b1a77",
  "decision": {
    "allowed": true,
    "max_power_kw": 2.5
  }
}
attestation_id генерируется на сервере (UUID).

Ошибка схемы (отсутствует поле и т.п.) (400):

{
  "detail": {
    "error": "schema_validation_error",
    "message": "...'signature' is a required property"
  }
}
Ошибка формата timestamp (400):

{
  "detail": {
    "error": "schema_validation_error",
    "message": "timestamp is not a valid ISO 8601 string with 'Z'"
  }
}
timestamp обязан быть в формате ISO 8601 UTC с суффиксом Z, например:
2026-07-25T19:05:00Z.

2. Provisioning
(кратко, основываясь на тестах; можно расширить позже)

2.1. POST /provisioning/attest
Принимает DeviceProof (схема device_proof.schema.json).

При валидном payload → 200 и какая-то бизнес-логика.
При ошибке схемы → 400:
{
  "detail": {
    "message": "Invalid DeviceProof",
    "path": ["device_id"]
  }
}
3. Registry
Эндпоинты под работу с реестром устройств (см. app/api/registry.py).
Тут можно позже описать CRUD по устройствам, манифестам и т.п. EOF


---

### 2) Клиент для API `tools/client.py`

```bash
cd ~/ENRG
mkdir -p tools

cat << 'EOF' > tools/client.py
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4

import httpx


@dataclass
class ENRGClientConfig:
    base_url: str = "http://localhost:8000"


class ENRGClient:
    def __init__(self, config: Optional[ENRGClientConfig] = None):
        self.config = config or ENRGClientConfig()
        self._client = httpx.Client(base_url=self.config.base_url, timeout=10.0)

    def health(self) -> Dict[str, Any]:
        resp = self._client.get("/health")
        resp.raise_for_status()
        return resp.json()

    # ---------- Oracle: новый формат запроса ----------

    def oracle_attest_request(
        self,
        device_id: str,
        nonce: str,
        max_power_kw: float,
        algo: str = "mock",
        signature: Optional[str] = None,
        timestamp: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Отправить запрос аттестации в новом формате (device_id/nonce/timestamp/...).

        Возвращает dict с полями:
        - device_id
        - attestation_id
        - decision.allowed
        - decision.max_power_kw
        """
        if timestamp is None:
            now = datetime.now(timezone.utc).replace(microsecond=0)
            timestamp = now.isoformat().replace("+00:00", "Z")

        if signature is None:
            # В реальном коде здесь должна быть подпись.
            signature = "deadbeef" * 8

        payload: Dict[str, Any] = {
            "device_id": device_id,
            "nonce": nonce,
            "timestamp": timestamp,
            "algo": algo,
            "payload": {"max_power_kw": max_power_kw},
            "signature": signature,
        }

        resp = self._client.post("/oracle/attest", json=payload)
        if resp.status_code == 400:
            try:
                data = resp.json()
                print("Oracle attest (new) validation error:", json.dumps(data, indent=2))
            except Exception:
                print("Oracle attest (new) error:", resp.text)
        resp.raise_for_status()
        return resp.json()

    # ---------- Oracle: старый формат Attestation ----------

    def oracle_attest_legacy(self, attestation: Dict[str, Any]) -> Dict[str, Any]:
        """
        Отправить полную Attestation в старом формате (использует схему attestation).
        """
        resp = self._client.post("/oracle/attest", json=attestation)
        if resp.status_code == 400:
            try:
                data = resp.json()
                print("Oracle attest (legacy) validation error:", json.dumps(data, indent=2))
            except Exception:
                print("Oracle attest (legacy) error:", resp.text)
        resp.raise_for_status()
        return resp.json()

    def build_simple_attestation(
        self,
        device_id: str,
        oracle_id: str = "oracle_main_1",
        allowed: bool = True,
        reason: str = "ok",
    ) -> Dict[str, Any]:
        """
        Сконструировать простую валидную Attestation для отладки legacy-режима.
        Подстраивается под tests/test_api.py.
        """
        now = datetime.now(timezone.utc).replace(microsecond=0)
        issued_at = now.isoformat().replace("+00:00", "Z")

        attestation_id = f"att_{uuid4().hex[:8]}"
        att = {
            "attestation_id": attestation_id,
            "device_id": device_id,
            "proof": {},
            "decision": {"allowed": allowed, "reason": reason},
            "oracle_id": oracle_id,
            "issued_at": issued_at,
            "oracle_signature": "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
        }
        return att


def main() -> None:
    client = ENRGClient()
    print("Health:", client.health())

    # Пример нового формата
    print("\n--- New oracle_attest_request() example ---")
    result_new = client.oracle_attest_request(
        device_id="dev_example_1",
        nonce="nonce123",
        max_power_kw=3.3,
    )
    print(json.dumps(result_new, indent=2))

    # Пример legacy-формата
    print("\n--- Legacy oracle_attest_legacy() example ---")
    att = client.build_simple_attestation(device_id="dev_example_1")
    result_legacy = client.oracle_attest_legacy(att)
    print(json.dumps(result_legacy, indent=2))


if __name__ == "__main__":
    main()
