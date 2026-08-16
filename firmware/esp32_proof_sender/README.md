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

