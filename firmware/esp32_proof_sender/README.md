# ENRG Protocol — ESP32 Proof Sender

Arduino sketches for ESP32 that read energy data from a PZEM-004T sensor, sign it with Ed25519, and send it to the oracle server.

## Files

- `src/esp32_proof_sender_v3.ino` — **актуальная безопасная версия** (H-3/H-4).
- `esp32_proof_sender.ino` — legacy v1 (захардкоженный ключ — **не использовать**).
- `../esp32_proof_sender_v2.ino` — legacy v2 (NVS-ключ, строковая подпись, HTTP — устарела).

## v3 — security-hardened

- **H-3**: нет захардкоженных ключей. Ed25519-ключ генерируется при первой
  загрузке и хранится в NVS (`Preferences`) либо в защищённом Data-Zone слоте
  ATECC608A (`ENRG_USE_ATECC608=1`).
- **H-4**: опциональный Secure Element ATECC608A. ВАЖНО: ATECC608A не умеет
  Ed25519 — чип используется как защищённое хранилище seed, подпись выполняется
  в CPU. Аппаратная подпись Ed25519 требует чипа с поддержкой ed25519
  (например, NXP SE050) — см. комментарии в коде.
- **Бинарный формат подписи** (on-chain): `device_id(32) || nonce(8 LE) || timestamp(8 LE) || energy_wh(8 LE)`
  — совпадает с `OracleReport::device_message_to_sign()`.
- **Wall-clock** через NTP (`time()`), а не `millis()`.
- **HTTPS** с проверкой корневого CA (`ENRG_CA_CERT`), mTLS опционально
  (`ENRG_MTLS=1`, `ENRG_CLIENT_CERT`, `ENRG_CLIENT_PRIVKEY`).
- `device_id` = `0x` + hex публичного ключа (32 байта) — совместимо с
  on-chain `register_device` и `server.js` (sig_mode='binary').
- **Device Manifest (ADR-0004)**: при старте устройство запрашивает у оракула
  подписанный манифест, проверяет подпись ключом основателя и использует
  `rated_power` и `oracle_url` из него (см. раздел «Device Manifest» ниже).

### Requirements

- ESP32 DevKit V1
- PZEM-004T sensor (опционально: `ENRG_USE_PZEM=1`)
- PlatformIO (рекомендуется) или Arduino IDE

### Setup (PlatformIO)

```bash
cd firmware/esp32_proof_sender
pio run -e esp32dev
pio run -t upload -e esp32dev
```

Конфигурация — в шапке `src/esp32_proof_sender_v3.ino`:
`WIFI_SSID`, `WIFI_PASSWORD`, `ENRG_ORACLE_URL`, `ENRG_CA_CERT`,
`ENRG_NTP_SERVER`, `ENRG_USE_ATECC608`, `ENRG_USE_PZEM`.

### Device Manifest (ADR-0004)

Устройство получает конфигурацию от оракула в виде **подписанного манифеста**:

```text
GET {ENRG_MANIFEST_URL_BASE}/{device_id}
→ { device_id, rated_power, oracle_url, public_key, timestamp, signature }
```

Формат подписи (каноническая строка, побайтово совпадает с `policy.js`):

```text
device_id|rated_power|oracle_url|public_key|timestamp   →  Ed25519 (ключ основателя)
```

Поток работы при старте:

1. `fetchManifest(device_id)` — GET-запрос манифеста у оракула.
2. `verifyManifest(body)` — разбор JSON (ArduinoJson), проверка:
   - `device_id` и `public_key` манифеста совпадают с ключом устройства
     (манифест нельзя подменить/переадресовать);
   - подпись валидна для вшитого публичного ключа основателя
     (`ENRG_FOUNDER_PUBKEY_HEX`, заполнить реальным значением!);
   - если манифест невалиден — устройство **не отправляет proof'ы**.
3. При успехе `rated_power` и `oracle_url` сохраняются в NVS; эндпоинт proof
   меняется на `{oracle_url}/api/v1/proof/submit`.

Настройки манифеста:

| #define | По умолчанию | Смысл |
|---|---|---|
| `ENRG_MANIFEST_URL_BASE` | `https://oracle.example.com/api/v1/manifest` | база URL эндпоинта манифестов |
| `ENRG_FOUNDER_PUBKEY_HEX` | `0x00…00` (заглушка) | публичный ключ оракула (основателя), 32 байта hex — **обязательно заполнить** |
| `ENRG_MANIFEST_REQUIRED` | `0` | `1` — без валидного манифеста proof'ы не отправляются |
| `ENRG_MANIFEST_RETRY_MS` | `60000` | интервал повторного запроса манифеста (мс) |

**Обратная совместимость:** при `ENRG_MANIFEST_REQUIRED=0` (по умолчанию)
устройство работает и без манифеста — использует `ENRG_ORACLE_URL` и хардкод-
конфигурацию, как раньше. Если манифест доступен и валиден — применяется он.

### OTA-обновления (ADR-0008)

Устройство периодически проверяет наличие новой прошивки у оракула:

```text
GET {ENRG_FIRMWARE_URL_BASE}/latest       → { version, image_hash, image_size, model, signature, ... }
GET {ENRG_FIRMWARE_URL_BASE}/latest/image → бинарный образ
```

Формат подписи (каноническая строка, совпадает с `policy.js::buildFirmwareMessage`):

```text
version|image_hash|image_size   →  Ed25519 (ключ основателя)
```

Цикл `checkForUpdates()`:

1. **Проверка наличия** — `GET /latest`; если модель не совпадает — пропуск.
2. **Анти-откат** — версия из метаданных должна быть **строго выше** текущей
   (`fw_version` в NVS); старые/равные образы отклоняются.
3. **Проверка подписи** — `verify_firmware_signature()`: подпись метаданных
   ключом основателя (`ENRG_FOUNDER_PUBKEY_HEX`); неподписанные/чужие образы
   отклоняются.
4. **Скачивание** — `downloadFirmware()` пишет образ в LittleFS
   (`/fw_update.bin`) с параллельным вычислением SHA-256; расхождение с
   `image_hash` → отказ.
5. **Применение** — `applyFirmwareUpdate()` через ESP32 OTA (`Update`),
   затем запись новой версии в NVS и `ESP.restart()`.

Настройки OTA:

| #define | По умолчанию | Смысл |
|---|---|---|
| `ENRG_FW_VERSION` | `"1.0.0"` | текущая версия прошивки (анти-откат) |
| `ENRG_FIRMWARE_URL_BASE` | `https://oracle.example.com/api/v1/firmware` | база URL эндпоинтов firmware |
| `ENRG_FW_MODEL` | `"ENRG-ESP32-v1"` | модель устройства (фильтр обновлений) |
| `ENRG_UPDATE_CHECK_MS` | `21600000` (6 ч) | интервал проверки обновлений |
| `ENRG_MAX_FW_SIZE` | `1300000` | максим. размер образа (байт) |

> Публикация образов: `POST /api/v1/firmware/update` на оракуле (см.
> `oracle/README.md`). Образы сохраняются в `firmware/updates/` (в `.gitignore`).

### Отзыв и ротация ключей (ADR-0007)

- **Отзыв** — устройство навсегда деактивируется (on-chain `revoke_device`):
  состояние → `Revoked`, флаг `revoked=true`. Отозванное устройство **не может**
  минтить и менять состояние. Инициируется владельцем или протокольным админом
  (`POST /api/v1/device/revoke/:device_id` на оракуле).
- **Ротация ключа** — владелец меняет публичный ключ устройства
  (on-chain `rotate_device_key`). Требуется:
  1. подпись владельца (authority) над `` `${device_id}|${new_device_id}` ``;
  2. подпись **нового** ключа над `b"enrg:device:rotate" || new(32) || owner(32)
     || nonce(8) || ts(8)` — proof-of-possession нового ключа.
  После ротации: старая запись → `revoked` + `rotated_to` (аудит-след), новая
  запись наследует состояние (owner, nonce, накопленную энергию, tier, state).
  Для устройства это означает: сгенерировать новый Ed25519-ключ, зарегистрировать
  его через оракул и продолжать отправлять proof'ы с новым ключом.
- Эндпоинты оракула: `POST /api/v1/device/revoke/:device_id`,
  `POST /api/v1/device/rotate/:device_id` (см. `oracle/README.md`).
- Аудит: события `DeviceRevoked` и `DeviceKeyRotated` эмитятся on-chain.

### ATECC608A (Secure Element)

```bash
pio run -e esp32dev-atecc
```

Для сборки этого env нужно сгенерировать `atca_config.h` для вашей
конфигурации (см. документацию Microchip `cryptoauthlib`; конфигурация слота
Data-Zone — в `ENRG_ATECC_SLOT`, по умолчанию 4). Если чип недоступен на
устройстве — прошивка автоматически откатывается на NVS с предупреждением.

### Key Management

- Keypair генерируется на устройстве при первой загрузке и никогда не
  печатается в Serial/log.
- Публичный ключ (device_id) печатается при старте и регистрируется в oracle
  (`POST /api/v1/device/register` с подписью `device_id|public_key`).
- Nonce персистентный (NVS) — анти-replay между перезагрузками.

### Operation

- Читает энергию (kWh) с PZEM-004T каждые `ENRG_REPORT_INTERVAL_MS` (60 c).
- Подписывает бинарное сообщение `device_id(32)||nonce||ts||energy_wh(8)`
  Ed25519-ключом устройства.
- Отправляет proof по HTTPS на `ENRG_ORACLE_URL` в формате:
  `{"device_id":"0x...","timestamp":<epoch>,"energyWh":<Wh>,"nonce":<n>,"signature":"<base64>"}`.

