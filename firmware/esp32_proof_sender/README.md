# ENRG Protocol — ESP32 Proof Sender

Arduino sketches for ESP32 that read energy data from a PZEM-004T sensor, sign it with Ed25519, and send it to the oracle server.

## Files

- `src/esp32_proof_sender_v3/esp32_proof_sender_v3.ino` — **актуальная безопасная версия** (H-3/H-4).

> ⚠️ **Legacy v1** (`esp32_proof_sender.ino`) и **v2** (`esp32_proof_sender_v2.ino`)
> **удалены из репозитория** (P0-блокер D-1, нарушение ADR-0001/0007) и
> заархивированы в `firmware/legacy/` (исключены из git через `.gitignore`).
> Актуальна только v3.

## v3 — security-hardened

- **H-3**: нет захардкоженных ключей. Ed25519-ключ генерируется при первой
  загрузке и хранится в NVS (`Preferences`, tier `basic`) либо в защищённом
  Data-Zone слоте ATECC608A (`ENRG_USE_ATECC608=1`, tier `hardware-aided`).
- **H-4**: опциональный Secure Element ATECC608A. ВАЖНО: ATECC608A не умеет
  Ed25519 — чип используется как защищённое хранилище seed, подпись выполняется
  в CPU (tier `hardware-aided`). **Полная аппаратная подпись Ed25519** — NXP SE050
  (`ENRG_USE_SE050=1`, env `esp32dev-se050`, tier `conforming`): ключ генерируется
  и подпись выполняется ВНУТРИ чипа. См. **`SE050-HARDWARE-SIGNING.md`**
  (документированный компромисс MVP + bring-up guide).

> **Key storage trust tiers (ADR-0007):** `basic` — key in NVS/flash
> (dev/education, NOT for production); `hardware-aided` — seed in a Secure
> Element slot, CPU signing (key material appears in RAM);
> `conforming` — key inside the Secure Element with on-chip Ed25519 signing.
> Mainnet requires `conforming`; `hardware-aided` only with a documented risk
> assessment and a governance decision.
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

Конфигурация — в шапке `src/esp32_proof_sender_v3/esp32_proof_sender_v3.ino`:
`ENRG_ORACLE_URL`, `ENRG_CA_CERT`, `ENRG_NTP_SERVER`, `ENRG_USE_ATECC608`,
`ENRG_USE_PZEM` + Plug & Play (`ENRG_SIGNER_PORT`, `ENRG_SIGNER_LAN_ONLY`).
**Wi-Fi-креды здесь не настраиваются** — только через Captive Portal (см. ниже).

> ⚠️ Системный `pio` может быть сломан (несовместимость с `click`). В этом
> workspace используйте PlatformIO из виртуального окружения:
> `/home/enrg/Axis-workspace/.venv/bin/pio`. Скрипт
> [`upload-firmware.sh`](upload-firmware.sh) находит его автоматически.

## Загрузка прошивки на ESP32

### 1. Сборка

```bash
cd firmware/esp32_proof_sender

# ═══ MAINNET (P1-1, audit 2026-08-30) — ЕДИНСТВЕННАЯ production-сборка ═══
# SE050 (tier conforming, ADR-0007) + manifest required + A/B eFuse anti-rollback.
# Fail-closed: без SE050 устройство НЕ запускается. Требует плату с NXP SE050
# и библиотеку se050 (pio pkg install se050).
pio run -e esp32dev-mainnet

# OTA-версия (dual-bank A/B + anti-rollback, ADR-0008) — dev/QA с SE050-опцией
pio run -e esp32dev-ota

# Базовая версия (ключ в NVS — tier basic) / ATECC608A (tier hardware-aided)
# ⚠️ НЕ для mainnet — только разработка/обучение (ADR-0007 запрещает basic).
pio run -e esp32dev
pio run -e esp32dev-atecc
```

Успешная сборка: `[SUCCESS]`, размер `firmware.bin` выводится в конце
(RAM/Flash usage). Пример:
```
RAM:   [=         ]  14.5% (used 47456 bytes from 327680 bytes)
Flash: [=====     ]  54.9% (used 1007289 bytes from 1835008 bytes)
========================= [SUCCESS] Took 7.33 seconds =========================
```

### 2. Загрузка на устройство

Устройство подключается по USB (кабель должен поддерживать передачу данных,
не только зарядку). На Linux проверьте драйвер USB-UART (CH340/CP210x) и
права группы `dialout`.

**Вариант A — скрипт `upload-firmware.sh` (рекомендуется):**

```bash
cd firmware/esp32_proof_sender
./upload-firmware.sh                    # env по умолчанию: esp32dev-ota
./upload-firmware.sh esp32dev           # другой env
./upload-firmware.sh --no-monitor       # без монитора после загрузки
```

Скрипт проверяет, что ESP32 подключён, показывает найденный порт,
предупреждает о прожиге eFuse (для `esp32dev-ota`) и запрашивает
подтверждение перед загрузкой. После загрузки открывает монитор порта.

**Вариант B — команды PlatformIO вручную:**

```bash
# Список доступных портов
pio device list

# Загрузка прошивки
pio run -e esp32dev-ota -t upload
# если порт не определяется автоматически:
pio run -e esp32dev-ota -t upload --upload-port /dev/ttyUSB0
```

### 3. Монитор порта (логи)

```bash
pio device monitor                              # baud из platformio.ini (115200)
pio device monitor --port /dev/ttyUSB0 --baud 115200
# Выход из монитора: Ctrl+]
```

**Что должно появиться в логах при успешном старте:**

- `[KEY]` / `device_id: 0x...` — публичный ключ устройства (32 байта hex).
- `[WIFI] connecting to ...` → `[WIFI] connected` — подключение к Wi-Fi
  **по кредам из NVS** (вводятся через Captive Portal, см. ниже).
- `[MDNS]` / `[SIGNER]` — mDNS `axis-device-XXXX.local` и локальный
  HTTP-signer на `:8080` (Plug & Play, см. ниже).
- `[MANIFEST]` — загрузка и проверка Device Manifest (ADR-0004), если включён.
- `[OTA]` — проверка обновлений / анти-откат (`ota_mark_boot_ok()`).
- `[PROOF] sent` — отправка подписанного proof на оракул
  (интервал — `ENRG_REPORT_INTERVAL_MS`, по умолчанию 60 с).

Если логов нет — проверьте baud (115200), порт и состояние NVS.

### ⚠️ Plug & Play онбординг (Wi-Fi через Captive Portal, без хардкода)

Wi-Fi-креды **никогда** не зашиваются в прошивку — они хранятся только в
защищённой NVS (`Preferences`, namespace `enrg`, ключи `wifi_ssid`/`wifi_pass`).
При старте устройство:

1. Читает креды из NVS и пытается подключиться **30 секунд**.
2. Если сети нет / подключение не удалось — поднимает **защищённую AP**
   `Axis-Device-XXXX` (XXXX = последние 4 hex **deviceId**, пароль = последние
   8 hex deviceId, печатается в Serial) и Captive Portal (WiFiManager).
3. Пользователь подключается к AP → портал открывается автоматически
   (DNS-редирект) → вводит SSID/пароль домашней сети.
4. Креды сохраняются в NVS, устройство перезагружается в STA-режиме.

Сброс настроек сети (переезд в другой дом):

```text
# в pio device monitor:
CLEARWIFI
# → креды полностью стираются из NVS, устройство перезагружается в AP-режим
```

> ⚠️ «Защищённость» NVS на уровне физического доступа требует включения
> **flash-encryption** в eFuse (`CONFIG_SECURE_FLASH_ENC_ENABLED`) для
> production-прошивок. Без него NVS читается при физическом доступе к чипу —
> это документированный компромисс MVP (см. SE050-HARDWARE-SIGNING.md).

### Локальный HTTP-signer + mDNS (связь с Axis-connect, порт 8080)

После подключения к Wi-Fi устройство отвечает по mDNS на
`axis-device-XXXX.local` (`XXXX` — последние 4 hex deviceId) и поднимает
HTTP-signer на порту `8080`:

```text
GET  /api/device/info → { "deviceId": "0x…", "schema": "axis-energy-v1",
                          "firmware": "1.0.0", "state": "ready|no-wifi" }
POST /api/device/sign → тело {"hex":"<message hex>"} (или raw binary)
                     → { "signature": "<0x-hex 64 bytes>", "deviceId": "0x…" }
```

Безопасность signer'а (обязательно):

- **`ENRG_SIGNER_LAN_ONLY=1`** — запросы принимаются только из локальных
  подсетей RFC1918 / loopback / link-local; внешние IP отклоняются `403`.
- **Доменная валидация**: по HTTP подписываются только сообщения с префиксом
  `enrg:device:` (register/claim/rotate) и встроенным `device_id == наш ключ`.
  Произвольный SIGN доступен **только** через Serial-кабель (физический доступ).

Транспорт исходящих запросов (`transport_allowed`): `https://` — всегда
разрешён; `http://` — только для локального контура (loopback/LAN/`.local`,
напр. локальный оракул `http://192.168.1.123:3000`); `http://` к **удалённому**
узлу блокируется (ADR-0008). `ENRG_ALLOW_HTTP=1` — явный dev-обход.

### ⚠️ ВАЖНО (ADR-0008) — env `esp32dev-ota`

- **Dual-bank A/B**: `otadata` + `app0`/`app1` (`partitions_ota.csv`). Новый
  образ стартует как «pending»; без подтверждения приложение откатывается.
- **Аппаратный anti-rollback**: `CONFIG_BOOTLOADER_EFUSE_SECURE_VERSION`
  (`sdkconfig.defaults.esp32dev-ota`) — первый успешный boot образа прожигает
  `secure_version` в eFuse. **Это необратимо.** Не смешивайте env'ы на одной
  плате (не заливайте `esp32dev` поверх `esp32dev-ota` и наоборот).

### Регистрация устройства в оракуле (PoP-подпись через Serial-команду `SIGN`)

Оракул принимает proof'ы только от зарегистрированных устройств
(`POST /api/v1/proof/submit` → `400 unknown device` иначе). Регистрация —
по proof-of-possession: устройство подписывает строку
`` `${device_id}|${public_key}` `` **своим** Ed25519-ключом (ADR-0001: ключ
не покидает устройство, наружу уходит только подпись).

Прошивка v3 поддерживает Serial-команды (в `pio device monitor`):

```text
HELP              — список команд
INFO              — device_id, public_key (base64/hex), WiFi/mDNS/signer, хранилище
SIGN <hex>        — подписать ПРОИЗВОЛЬНОЕ сообщение (hex, max 256 байт) ключом
                    устройства → вывод [SIGN] sig_base64 / sig_hex
CLEARWIFI         — стереть WiFi-креды из NVS и перезагрузиться в AP-режим
```

**Шаг 1 — подготовка (утилита):**

```bash
node scripts/register-device.js --prepare --device-id 0xcbec5afc...
# → выводит public_key (base64) и hex PoP-сообщения для команды SIGN
```

**Шаг 2 — подпись на устройстве:**

```text
# в pio device monitor:
SIGN <hex из шага 1>
# скопировать строку [SIGN] sig_base64 = <...>
```

**Шаг 3 — регистрация (утилита):**

```bash
node scripts/register-device.js --send --device-id 0xcbec5afc... --signature <sig_base64> \
    --url https://oracle.enrg.network
# → ✅ Device registered successfully (HTTP 200)
```

После этого ESP32 отправляет proof'ы и получает `200 OK`; энергия
накапливается в `energyStore`, при binary-подписи оракул вызывает
`mint_energy` (если mint временно невозможен — proof принимается,
`mint: "deferred"`, энергия не теряется).

> ⚠️ On-chain регистрация (`register_device`/`claim_device` на Solana) —
> отдельный шаг: для него устройство подписывает бинарные сообщения
> (`enrg:device:register ‖ device_id ‖ ts` и `enrg:device:claim ‖ …`),
> которые также можно получить через `SIGN <hex>` и передать оператору.

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
| `ENRG_FOUNDER_PUBKEY_HEX` | `545ebb75…bfafd` (реальный founder-ключ) | публичный ключ оракула (основателя), 32 байта hex; соответствует founder-кошельку `~/.config/solana/founder-wallet.json` (base58 `6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8`). При смене FOUNDER_KEY на оракуле — обновить и перепрошить |
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
version|image_hash|image_size   →  Ed25519 (ОТДЕЛЬНЫЙ холодный firmware-ключ, D-5)
```

Цикл `checkForUpdates()`:

1. **Проверка наличия** — `GET /latest`; если модель не совпадает — пропуск.
2. **Анти-откат** — версия из метаданных должна быть **строго выше** текущей
   (`fw_version` в NVS); старые/равные образы отклоняются.
3. **Проверка подписи** — `verify_firmware_signature()`: подпись метаданных
   **отдельным холодным firmware-ключом** (`ENRG_FIRMWARE_PUBKEY_HEX` — НЕ
   founder-ключ); неподписанные/чужие образы отклоняются.
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
> `oracle/README.md`). Образы подписываются **холодным firmware-ключом**
> (сервер: `FIRMWARE_SIGNING_KEY_PATH`, по умолчанию
> `firmware/firmware-signing-keypair.json`, gitignored); публичный ключ вшит
> в прошивку как `ENRG_FIRMWARE_PUBKEY_HEX`. Образы сохраняются в
> `firmware/updates/` (в `.gitignore`).

### Dual-bank OTA + аппаратный monotonic-счётчик (ADR-0008)

Для серийных устройств доступен env **`esp32dev-ota`** (A/B + аппаратный
анти-откат):

- **Dual-bank A/B** — `partitions_ota.csv`: `otadata` + `app0`/`app1`.
  Новый образ стартует как «pending»; если приложение не подтвердило себя —
  бутлоадер автоматически откатывается к предыдущему образу.
- **Monotonic (eFuse)** — `sdkconfig.defaults.esp32dev-ota` включает
  `CONFIG_BOOTLOADER_EFUSE_SECURE_VERSION`; `ota_mark_hardware_anti_rollback()`
  «сжигает» версию в eFuse (значение только растёт) ПОСЛЕ успешного старта —
  бутлоадер откажет в запуске образов со старшей версией-не-новичком.
- **Подтверждение** — `ota_mark_boot_ok()` вызывает
  `esp_ota_mark_app_valid_cancel_rollback()` после успешной инициализации
  (ключ + WiFi + манифест + версия); при фатальной ошибке — rollback.

```bash
pio run -e esp32dev-ota
```

> ⚠️ Первый boot образа, собранного под `esp32dev-ota`, прожигает eFuse
> (необратимо). Не путайте env'ы на одной плате.

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

