# ENRG Protocol — Oracle Server

This server receives signed energy proofs from IoT devices, verifies Ed25519 signatures, accumulates energy, and automatically calls `mint_energy` on the deployed Solana program when the threshold is reached.

## Quick Start
1. Install dependencies: `npm install`
2. Place your founder keypair at `~/founder-keypair.json` (64-byte array) or set `FOUNDER_KEY_PATH`
3. Register device public keys via `POST /api/v1/device/register` (base64-encoded Ed25519 public key + proof-of-possession signature)
4. Start the server: `node server.js`

## API
- `POST /api/v1/device/register` — register a device (proof-of-possession: Ed25519 signature over `device_id|public_key`)
- `POST /api/v1/proof/submit` — submit a signed energy proof
  - Body: `{ device_id, timestamp, energyWh, nonce, signature }`
  - `signature` — base64 Ed25519-подпись в **binary** (on-chain) либо **legacy** (строковый) формате
- `GET /api/v1/manifest/:device_id` — подписанный **Device Manifest** (ADR-0004)
  - Ответ: `{ device_id, rated_power, oracle_url, public_key, timestamp, signature }`
  - Подпись: Ed25519 ключом основателя (`FOUNDER_KEY`) над канонической строкой
    `device_id|rated_power|oracle_url|public_key|timestamp`
    (см. `policy.buildManifestMessage` / `verifyManifest`)
  - Устройство проверяет подпись вшитым публичным ключом основателя ДО
    использования манифеста; при невалидном манифесте proof'ы не отправляются
  - Опциональный query-параметр `?rated_power=<Вт>` — переопределить мощность
- `POST /api/v1/firmware/update?version=1.2.0[&model=ENRG-ESP32-v1]` — публикация OTA-образа (ADR-0008)
  - Body: raw binary образ прошивки; заголовок `x-api-key: <FIRMWARE_ADMIN_KEY>`
  - Сохраняет образ в `firmware/updates/` (или `FIRMWARE_UPDATES_DIR`),
    подписывает метаданные ключом основателя (`version|image_hash|image_size`),
    возвращает `{ ok, version, image_size, image_hash, signature }`
- `GET /api/v1/firmware/latest` — метаданные текущей прошивки
  (`{ version, image_hash, image_size, model, image_url, signature, signed_by, issued_at }`)
- `GET /api/v1/firmware/latest/image` — бинарный образ (заголовки `X-Firmware-Version`, `X-Firmware-Hash`)
- `GET /api/v1/device/:id/status` | `GET /api/v1/device/:id/balance` | `GET /api/v1/device/:id/history`
- `POST /api/v1/pool/create`, `GET /api/v1/stats`

## Policy Engine (ADR-0003)

Вся проверка входящих данных вынесена из `server.js` в отдельный модуль
**`policy.js`** — это соответствует требованию Axis ADR-0003 (Verifier ≠ Policy
Engine). `server.js` (Verifier) только принимает данные и исполняет решения,
`policy.js` (Policy Engine) принимает решения о допустимости proof.

### Функции валидации (каждая — отдельная проверка)

| Функция | Что проверяет | Ошибки (HTTP / error) |
|---|---|---|
| `validateDeviceId(id)` | base58 или `0x`-hex (≤128 симв., без спецсимволов/XSS) | `400 invalid device_id format (base58 or hex only)` |
| `validateEnergyWh(v)` | число/строка, конечное, `> 0`, `≤ maxEnergyPerReportWh` | `400 invalid energyWh …` / `400 energyWh exceeds maximum…` |
| `validateTimestamp(ts, nowSec?)` | число/строка, конечное, свежесть (skew 5 мин, возраст ≤ 15 мин) | `400 FutureTimestamp` / `400 StaleProof` |
| `validateNonce(n, lastNonce)` | положительное целое, строго больше `lastNonce` | `400 invalid nonce …` / `400 InvalidNonce` |
| `validateSignature(params)` | длина 64/32 байта, Ed25519 binary- или legacy-формат | `400 invalid signature format` / `401 invalid signature` |
| `validateRegister(device_id, public_key, signature)` | формат + proof-of-possession | `400 …` / `403 invalid signature: proof of device key ownership required` |
| `validateProof(proof, ctx)` | все проверки выше в одном вызове | первый же код ошибки |

Пример вызова из server.js:

```js
const v = policy.validateProof(req.body, {
    getPublicKey: (id) => devices[id] || null,      // реестр устройств
    getLastNonce: (id) => (energyStore[id] || { nonce: 0 }).nonce,
});
if (!v.ok) return res.status(v.status).json({ error: v.error });
```

### Конфигурация политик

Лимиты задаются в **`policy-config.json`** в корне репозитория (или переменными
окружения — env имеет приоритет над файлом, файл — над дефолтами).

| Ключ в policy-config.json | Env-переменная | Дефолт | Смысл |
|---|---|---|---|
| `maxEnergyPerReportWh` | `MAX_ENERGY_PER_REPORT_WH` | `1000000000` | макс. энергия в одном отчёте (Wh) |
| `maxTimestampSkewSec` | `MAX_TIMESTAMP_SKEW_SEC` | `300` | метка не в будущем более чем на N сек (5 мин) |
| `maxProofAgeSec` | `MAX_PROOF_AGE_SEC` | `900` | отчёт не старше N сек (15 мин) |
| `rateLimitPerMinute` | `RATE_LIMIT_PER_MINUTE` | `100` | глобальный rate-limit (запросов/мин на IP) |
| `oracleUrl` | `ORACLE_URL` | `http://localhost:3000` | публичный URL оракула для Device Manifest (ADR-0004) |
| `defaultRatedPowerW` | `DEFAULT_RATED_POWER_W` | `10000` | rated_power по умолчанию (Вт) в Device Manifest |
| `maxFirmwareSizeBytes` | `MAX_FIRMWARE_SIZE_BYTES` | `2000000` | макс. размер OTA-образа (байт) |

Пример `policy-config.json`:

```json
{
  "maxEnergyPerReportWh": 1000000000,
  "maxTimestampSkewSec": 300,
  "maxProofAgeSec": 900,
  "rateLimitPerMinute": 100,
  "oracleUrl": "https://oracle.enrg.network",
  "defaultRatedPowerW": 10000,
  "maxFirmwareSizeBytes": 2000000
}
```

Путь к файлу можно переопределить через `POLICY_CONFIG_PATH`.
Конфигурация загружается при старте оракула; в рантайме доступна как
`policy.config` (для тестов — `policy.setConfig()`, `policy.reloadConfig()`).

### Тесты

```bash
npm run test:policy        # mocha tests/policy.test.js (40 unit-тестов)
npx mocha tests/policy.test.js
```

## Configuration
- `ENERGY_THRESHOLD` — Wh to accumulate before minting (default: 1,000,000 Wh = 1 MWh)
- `PROGRAM_ID` — deployed Solana program address
- `MINT_ADDRESS` — SRC token mint
- `FOUNDER_KEY` / `FOUNDER_KEY_PATH` — ключ основателя (оракул), подписывающий OracleReport
- `RPC_ENDPOINT` — Solana RPC (по умолчанию devnet)
- `ENRG_SQLITE_PATH` / `DATABASE_URL` — хранилище (SQLite / PostgreSQL)

