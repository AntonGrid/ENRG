# ENRG — Firmware (ESP32)

Прошивка устройства ENRG для отправки подписанных proof'ов на оракул.

## Структура

| Путь | Описание |
|---|---|
| [`esp32_proof_sender/`](esp32_proof_sender/) | PlatformIO-проект (Arduino, ESP32 DevKit V1) |
| [`esp32_proof_sender/src/esp32_proof_sender_v3/esp32_proof_sender_v3.ino`](esp32_proof_sender/src/esp32_proof_sender_v3/esp32_proof_sender_v3.ino) | Актуальная безопасная прошивка v3 (H-3/H-4) |
| [`esp32_proof_sender/platformio.ini`](esp32_proof_sender/platformio.ini) | Env: `esp32dev`, `esp32dev-atecc`, `esp32dev-se050`, `esp32dev-ota` |
| [`esp32_proof_sender/upload-firmware.sh`](esp32_proof_sender/upload-firmware.sh) | Скрипт проверки/подтверждения/загрузки/монитора |
| [`esp32_proof_sender/SE050-HARDWARE-SIGNING.md`](esp32_proof_sender/SE050-HARDWARE-SIGNING.md) | NXP SE050 — аппаратная Ed25519-подпись |
| `firmware-signing-keypair.json` | Dev-ключ подписи OTA-образов (ADR-0008, **gitignored**) |
| `legacy/` | Старые версии прошивки (v1/v2, не собираются) |

## Быстрый старт

```bash
# Сборка (OTA-версия, dual-bank A/B + anti-rollback)
cd esp32_proof_sender
/home/enrg/Axis-workspace/.venv/bin/pio run -e esp32dev-ota

# Загрузка на ESP32 (проверяет порт, спрашивает подтверждение, открывает монитор)
./upload-firmware.sh
```

> ⚠️ Системный `pio` (4.3.4) в этой среде сломан (несовместимость с `click`).
> Рабочая версия — PlatformIO 6.1.19 из `/home/enrg/Axis-workspace/.venv/bin/pio`;
> `upload-firmware.sh` находит её автоматически.

## Подробная инструкция

Полная инструкция по сборке, загрузке и проверке логов — в
[`esp32_proof_sender/README.md`](esp32_proof_sender/README.md) (раздел
«Загрузка прошивки на ESP32»):

1. **Сборка:** `pio run -e esp32dev-ota` (см. «1. Сборка»).
2. **Загрузка:** `./upload-firmware.sh` или `pio run -e esp32dev-ota -t upload`
   (см. «2. Загрузка на устройство»).
3. **Логи:** `pio device monitor` (см. «3. Монитор порта (логи)»).
4. **Важно (ADR-0008):** первый boot `esp32dev-ota` прожигает eFuse
   (`secure_version`) — необратимо; не смешивайте env'ы на одной плате.

## Оракул

Прошивка отправляет proof'ы на эндпоинт `{oracle_url}/api/v1/proof/submit`
(формат: `device_id`, `timestamp`, `energyWh`, `nonce`, `signature`).
Подпись — бинарная (`device_id(32)||nonce(8 LE)||ts(8 LE)||energy_wh(8 LE)`),
совпадает с on-chain `OracleReport::device_message_to_sign()`.
