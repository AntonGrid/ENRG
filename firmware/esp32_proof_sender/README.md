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
- PZEM-004T sensor (v3.0, Modbus) — подключён на `Serial2`, RX=16/TX=17;
  `ENRG_USE_PZEM=1` уже включён в build_flags всех env
- PlatformIO (рекомендуется) или Arduino IDE

### Setup (PlatformIO)

```bash
cd firmware/esp32_proof_sender
pio run -e esp32dev
pio run -t upload -e esp32dev
```

Конфигурация — в шапке `src/esp32_proof_sender_v3/esp32_proof_sender_v3.ino`:
`ENRG_ORACLE_URL`, `ENRG_CA_CERT`, `ENRG_NTP_SERVER`, `ENRG_USE_ATECC608`;
`ENRG_USE_PZEM=1` и `ENRG_MIN_START_NONCE` задаются в `platformio.ini`
(`build_flags`), плюс Plug & Play (`ENRG_SIGNER_PORT`, `ENRG_SIGNER_LAN_ONLY`).
**Wi-Fi-креды здесь не настраиваются** — только через Captive Portal (см. ниже).

> ⚠️ Системный `pio` может быть сломан (несовместимость с `click`). В этом
> workspace используйте PlatformIO из виртуального окружения:
> `/home/enrg/Axis-workspace/.venv/bin/pio`. Скрипт
> [`upload-firmware.sh`](upload-firmware.sh) находит его автоматически.

## Build matrix — что реально собирается (измерено 2026-10-21)

Перед сборкой SE050-тиров один раз вендорим middleware (BSD-3-Clause, не
реестровый пакет): `scripts/vendor-se050.sh` → `vendor/se05x/` (gitignored,
пиннутая версия в `VERSION`).

| env | tier (ADR-0007) | Статус | Почему |
|---|---|---|---|
| `esp32dev` | `basic` (ключ в NVS, подпись в CPU) | ✅ `SUCCESS` | PZEM включён; 89.5% слота (1.17 МБ из 1.31 МБ) |
| `esp32dev-ota` | `basic` + A/B OTA + eFuse anti-rollback | ✅ `SUCCESS` | PZEM включён; 64.1% слота (1.18 МБ из 1.83 МБ) |
| `esp32dev-se050` | `conforming` (Ed25519 внутри SE050) | ✅ `SUCCESS` | вендоренный middleware + порт `lib/enrg_se050_port/`; 94.1% слота (1.23 МБ из 1.31 МБ) |
| `esp32dev-mainnet` | production (SE050 обязателен) | ✅ `SUCCESS` | `extends = esp32dev-se050` + production-флаги; 67.3% слота (1.24 МБ из 1.83 МБ) |
| `esp32dev-atecc` | `hardware-aided` (seed в ATECC608A, подпись в CPU) | ❌ не собирается | `cryptoauthlib` требует `atca_config.h` (HAL-конфиг под вашу плату) — не вендорен |

> ℹ️ С 2026-10-21 PZEM (`-D ENRG_USE_PZEM=1` + `mandulaj/PZEM-004T-v30`)
> включён во все собираемые env; это +~60 КБ к flash (в цифрах выше уже учтено).

**Важно про размер:** дефолтная таблица разделов даёт приложению 1.31 МБ, и
SE050-образ занимает 94.1% — впритык. `esp32dev-mainnet` собирается с
`partitions_ota.csv` (слот 1.83 МБ) и укладывается в 67%. Практический вывод: для
SE050-тира берите OTA-таблицу разделов, даже если A/B пока не нужен, — иначе
любое добавление кода упрётся в потолок.

**Важно про чип:** сборка — это ещё не bring-up. Ни одна плата с SE050 не
подключалась, ни один proof не подписан на чипе. Что осталось: плата
(ESP32 + SE05x/OM-SE050ARD), включённый в апплет EDDSA, первые кадры T=1-over-I2C
под логическим анализатором. Чек-лист — `SE050-HARDWARE-SIGNING.md` §Bring-up.

## Загрузка прошивки на ESP32

### 1. Сборка

```bash
cd firmware/esp32_proof_sender

# ═══ MAINNET (P1-1, audit 2026-08-30) — ЕДИНСТВЕННАЯ production-сборка ═══
# SE050 (tier conforming, ADR-0007) + manifest required + A/B eFuse anti-rollback.
# Fail-closed: без SE050 устройство НЕ запускается. Требует ПЛАТУ с NXP SE050 и
# middleware NXP Plug & Trust в lib/ (НЕ `pio pkg install se050` — такого пакета
# в реестре нет; см. SE050-HARDWARE-SIGNING.md §Vendoring).
pio run -e esp32dev-mainnet     # SE050 обязателен (fail-closed); 67.3% слота

# OTA-версия (dual-bank A/B + anti-rollback, ADR-0008) — dev/QA
pio run -e esp32dev-ota

# Базовая версия (ключ в NVS — tier basic) — ЕДИНСТВЕННАЯ собирающаяся сегодня
# ⚠️ НЕ для mainnet — только разработка/обучение (ADR-0007 запрещает basic).
pio run -e esp32dev

# ATECC608A (tier hardware-aided) — нужен atca_config.h под вашу плату
pio run -e esp32dev-atecc
```

Успешная сборка: `[SUCCESS]`, размер `firmware.bin` выводится в конце
(RAM/Flash usage). Пример:
```
RAM:   [==        ]  15.3% (used 50120 bytes from 327680 bytes)
Flash: [========= ]  89.5% (used 1172761 bytes from 1310720 bytes)
========================= [SUCCESS] Took 49.51 seconds =========================
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
- `[NONCE] stored = N, the next proof uses N+1` — счётчик анти-replay; перед
  первым запуском он должен быть ≥ on-chain nonce (см. `SETNONCE` ниже).
- `[SENSOR] PZEM total=… baseline=… delta=…` — кумулятивный счётчик PZEM,
  подтверждённый baseline и дельта, которая уйдёт в proof.
- `[PROOF] sent` — отправка подписанного proof на оракул
  (интервал — `ENRG_REPORT_INTERVAL_MS`, по умолчанию 60 с).
- `[SENSOR] baseline committed: …` — оракул ответил `200`, baseline сдвинут;
  если этой строки нет, энергия уйдёт следующим отчётом.

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

**Полный список Serial-команд** (та же выдача по `HELP`):

```text
HELP              — список команд
INFO              — device_id, public_key (base64/hex), WiFi/mDNS/signer, storage
SIGN <hex>        — подписать произвольное сообщение (hex, ≤256 байт) ключом
                    устройства; в лог уходит только sig_base64/sig_hex
WIFI <ssid> <pass> — сохранить Wi-Fi-креды в NVS и перезагрузиться в STA
CLEARWIFI         — стереть Wi-Fi-креды из NVS и перезагрузиться в AP-режим
NONCE             — показать сохранённый anti-replay счётчик
SETNONCE <n>      — выставить счётчик (n ≥ on-chain nonce, иначе 400 InvalidNonce)
PZEM              — живое чтение датчика: V/A/W/Hz/PF + counter/baseline/pending Wh
                    (показывает, за сколько секунд набегает 1 Wh при текущей нагрузке)
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

### Регистрация устройства — строго on-chain (PoP через Serial-команду `SIGN`)

Приём proof'ов открывает **только** on-chain регистрация в программе
`enrg-mvp`. `POST /api/v1/proof/submit` берёт публичный ключ и nonce устройства
из аккаунта `EnergyProducer`, поэтому незарегистрированное устройство получает
`404 device_not_registered_on_chain` (см. `server.js` и
`policy.validateProofAsync`).

> ⚠️ Локальный `POST /api/v1/device/register` (скрипт
> `scripts/register-device.js`) пишет только запись в БД оракула
> (метаданные/история) и **НЕ открывает приём proof'ов**. Прежняя редакция
> этого README утверждала, что оракул отвечает `400 unknown device` — это
> устарело: источник истины — блокчейн.

Жизненный цикл аккаунта:
`register_device → claim_device → provision_device → activate_device`
(`programs/enrg-mvp/src/instructions/device_lifecycle.rs`).

**Шаг 1 — узнать device_id** (в `pio device monitor`, физический доступ):

```text
INFO
# [INFO] device_id     = 0x<cbec…>
# [INFO] public_key_hex= <hex>
```

**Шаг 2 — подготовить сообщения и подписать их на устройстве**
(ADR-0001: приватный ключ не покидает ESP32):

```bash
npx ts-node scripts/register-onchain.ts --prepare --device-id 0x<cbec…>
# → REGISTER_MESSAGE_HEX / CLAIM_MESSAGE_HEX / ts
```

```text
SIGN <REGISTER_MESSAGE_HEX>
SIGN <CLAIM_MESSAGE_HEX>
# скопировать обе строки [SIGN] sig_base64 = ...
```

**Шаг 3 — отправить транзакции** (обязательно тот же `ts`, что вывел
`--prepare`, иначе подписи не совпадут):

```bash
TS=<ts> REG_SIG=<reg> CLAIM_SIG=<claim> \
  npx ts-node scripts/register-onchain.ts --send --device-id 0x<cbec…>
# ✅ register_device → claim_device → provision_device → activate_device
```

**Шаг 4 — проверить (read-only, ничего не отправляет):**

```bash
npx ts-node scripts/register-onchain.ts --check --device-id 0x<cbec…>
# state            : registered on-chain ✅
# device_state     : {"active":{}}
# nonce            : 1029
```

Кластер задаётся `--cluster <url>` (или `ANCHOR_PROVIDER_URL`/`RPC_ENDPOINT`),
кошелёк оператора — `--wallet`, device_id — `--device-id` или `DEVICE_ID`.
`--prepare` печатает предупреждение, если аккаунт уже существует, а `--send`
в этом случае отказывается отправлять `register_device` (иначе
`account already in use`).

### Nonce: догнать on-chain счётчик перед первым proof

Сервер принимает proof только если `nonce > nonce` аккаунта `EnergyProducer`
(`validateNonce`, `policy.js`). После перепрошивки или замены платы NVS пуст →
счётчик начинается с 1, и все отправки получают `400 InvalidNonce`.

Любой из вариантов:

```bash
# A. build flag — поднять счётчик при старте (значение = текущий on-chain nonce)
PLATFORMIO_BUILD_FLAGS='-D ENRG_MIN_START_NONCE=1029' pio run -e esp32dev -t upload
```

```text
# B. Serial-команда, без перепрошивки
SETNONCE 1029
NONCE
# [NONCE] stored = 1029, the next proof uses 1030
```

Текущее значение on-chain:

```bash
npx ts-node scripts/register-onchain.ts --check --device-id 0x<cbec…> | grep nonce
```

### Энергия: отправляется ДЕЛЬТА, а не счётчик PZEM

PZEM-004T отдаёт кумулятивный счётчик (кВт·ч с момента сброса), а оракул
прибавляет `energyWh` к накопленному итогу устройства. Поэтому прошивка хранит
в NVS (`enrg` / `pzem_wh`) показание, уже подтверждённое оракулом, и отправляет
разницу `current − baseline`:

- baseline обновляется **только после HTTP 200** — при сетевой ошибке энергия
  не теряется, а уходит следующим отчётом;
- на первом старте baseline := текущее показание (энергия, накопленная до
  ввода в эксплуатацию, не отправляется);
- сброс/переполнение счётчика PZEM трактуется как reset, а не как
  отрицательная дельта;
- при `ENRG_USE_PZEM=1` и неотвечающем датчике отчёт не отправляется
  (`energyWh=0` сервер всё равно отверг бы).

Датчик включён в env `esp32dev`, `esp32dev-ota`, `esp32dev-atecc`,
`esp32dev-se050`, `esp32dev-mainnet` (`-D ENRG_USE_PZEM=1` +
`mandulaj/PZEM-004T-v30`); подключение — `Serial2`, RX=16, TX=17.

```bash
pio run -e esp32dev -t upload
# в мониторе: [SENSOR] PZEM total=… baseline=… delta=…
```

> Первый proof после прошивки появится только после того, как счётчик прибавит
> энергию: baseline на первом запуске берётся из текущего показания.

#### Разрешение счётчика: почему с малой нагрузкой proof'ов нет

PZEM-004T v3 считает энергию **целыми Wh** (0.001 кВт·ч), и протокол proof тоже
несёт целое `energyWh`. Поэтому при малой нагрузке дельта остаётся `0Wh`
и прошивка корректно пропускает отправку (`energyWh ≤ 0` сервер отвергает).
Сколько ждать первого proof'а при непрерывной нагрузке:

| Нагрузка | 1 Wh набегает за | Proof'ы (цикл 60 с) |
|---|---|---|
| 6 Вт (LED-лампа) | ≈ 600 с ≈ 10 мин (при PF≈1); с PF≈0.5 — до 20 мин | раз в 10–20 мин |
| 60 Вт | ≈ 60 с | ≈ каждую минуту |
| 100 Вт | ≈ 36 с | каждую минуту, `delta≈1–2Wh` |
| 1 кВт (фен/обогреватель) | ≈ 3.6 с | каждую минуту, `delta≈16Wh` |

Проверить, что датчик вообще «видит» нагрузку, можно командой `PZEM`
(живые V/A/W/Hz/PF + `pending` Wh + сколько секунд нужно на 1 Wh):

```text
[SENSOR] V=231.4 V  I=0.026 A  P=6.1 W  f=50.0 Hz  PF=0.98
[SENSOR] total=5Wh baseline=2Wh pending=3Wh  (1 Wh ≈ 590 s at P=6.1 W)
```

Если `P=0.0 W` при подключённой лампе — проверьте, что кольцо CT надето
**на фазный (L) провод** (один провод, не оба), стрелка — от сети к нагрузке,
и что TX/RX датчика идут на GPIO16/17 с общим GND.

Быстрая проверка end-to-end (без ожидания): включите нагрузку ≥ 100 Вт на
1–2 минуты и дождитесь `[PROOF] sent … (code=200)` и
`[SENSOR] baseline committed`. После этого можно вернуть 6-ваттную лампу —
дельта просто будет накапливаться медленнее (до 20 минут).


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

### Агрегация proof'ов (P3, audit 2026-08-30)

Снижает число on-chain транзакций в 10–60 раз без изменения контракта.

- `ENRG_AGGREGATE_WINDOW_MS` (по умолчанию 0 — выключено): если > 0,
  устройство НЕ шлёт каждое показание, а раз в окно подписывает **один
  агрегированный proof**.
- Формат подписи тот же: `device_id(32) || nonce(8) || ts(8) || energy_wh(8)`,
  где `energy_wh` — вся энергия, ещё не подтверждённая оракулом (разница с
  baseline в NVS; дельты не суммируются повторно). On-chain `mint_energy`
  принимает произвольное `energy_wh` — контракт не меняется.
- **Безопасность:** окно закрывается досрочно при достижении
  `rated_power` (пер-отчётный лимит on-chain, иначе `ExcessiveEnergy`) или
  абсолютного капа `ENRG_AGGREGATE_MAX_WH` (1 MWh) — валидный proof никогда
  не превысит лимит.
- При ошибке отправки baseline не сдвигается: та же неучтённая энергия уйдёт
  следующим отчётом.
- Рекомендуемое окно для mainnet: 900000 мс (15 мин).

```bash
# mainnet-сборка с агрегацией 15 мин:
PLATFORMIO_BUILD_FLAGS='-D ENRG_AGGREGATE_WINDOW_MS=900000' pio run -e esp32dev-mainnet
```

### Key Management

- Keypair генерируется на устройстве при первой загрузке и никогда не
  печатается в Serial/log.
- Публичный ключ (device_id) печатается при старте и регистрируется **on-chain**
  (`scripts/register-onchain.ts`, см. раздел «Регистрация устройства — строго
  on-chain»). Локальный `POST /api/v1/device/register` приём proof'ов не
  открывает.
- Nonce персистентный (NVS) — анти-replay между перезагрузками; перед первым
  отправлением он должен быть не меньше on-chain nonce (`SETNONCE <n>` или
  `ENRG_MIN_START_NONCE`).

### Operation

- Читает кумулятивный счётчик PZEM-004T каждые `ENRG_REPORT_INTERVAL_MS` (60 c)
  и отправляет **дельту** с последнего подтверждённого (HTTP 200) показания;
  baseline хранится в NVS (`enrg`/`pzem_wh`).
- Подписывает бинарное сообщение `device_id(32)||nonce||ts||energy_wh(8)`
  Ed25519-ключом устройства.
- Отправляет proof по HTTPS на `ENRG_ORACLE_URL` в формате:
  `{"device_id":"0x...","timestamp":<epoch>,"energyWh":<Wh>,"nonce":<n>,"signature":"<base64>"}`.

### Диагностика логов старта

| Строка в логе | Что значит |
|---|---|
| `[HTTP] GET … -> -11 (read Timeout)` | **read timeout**: ответ не пришёл за отведённое окно. Почти всегда — «холодный» Render free-tier (сервис спит 15 мин, первый запрос ждёт ~50 с). С 2026-10-21 таймаут GET = 45 с (`ENRG_HTTP_READ_TIMEOUT_MS`) + 1 ретрай, так что первая загрузка манифеста переживает пробуждение |
| `[HTTP] GET … -> 404` | сеть в порядке, но на оракуле нет такого ресурса (например, прошивка ещё не опубликована — `/api/v1/firmware/latest` отдаёт `no firmware published`) |
| `[MANIFEST] WARN: … hard-coded config` | манифест не получен; при `ENRG_MANIFEST_REQUIRED=0` устройство работает на встроенных настройках |
| `E (…) esp_littlefs: Corrupted dir pair at {0x0, 0x1}` + `[OTA] WARN: LittleFS not mounted` | раздел LittleFS не был отформатирован. С 2026-10-21 прошивка монтирует его с `formatOnFail=true` (в LittleFS лежит только временный образ `/fw_update.bin`, состояние устройства — в NVS), поэтому OTA-раздел форматируется один раз и дальше доступен |
| `[PROOF] skip: no new energy …` | корректное поведение: счётчик PZEM не прибавил ни одного Wh (см. «Разрешение счётчика» выше) |

Настройки сети/HTTP (build flags):

| define | По умолчанию | Смысл |
|---|---|---|
| `ENRG_HTTP_READ_TIMEOUT_MS` | `45000` | окно чтения ответа для GET (манифест, OTA-метаданные); перекрывает холодный старт Render |
| `ENRG_HTTP_GET_ATTEMPTS` | `2` | число попыток GET; ретрай только для сетевых ошибок и `5xx`, `4xx` не повторяется |
| `ENRG_HTTP_RETRY_DELAY_MS` | `3000` | пауза между попытками |


