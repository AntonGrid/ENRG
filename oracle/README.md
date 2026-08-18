# ENRG Protocol — Oracle Server

This server receives signed energy proofs from IoT devices, verifies Ed25519 signatures, accumulates energy, and automatically calls `mint_energy` on the deployed Solana program when the threshold is reached.

## Quick Start
1. Install dependencies: `npm install`
2. Place your founder keypair at `~/founder-keypair.json` (64-byte array) or set `FOUNDER_KEY_PATH`
3. Register device public keys via `POST /api/v1/device/register` (base64-encoded Ed25519 public key + proof-of-possession signature)
4. Start the server: `node server.js`

## API
- `POST /api/v1/device/register` — register a device (proof-of-possession: Ed25519 signature over `device_id|public_key`)
  - **P0-2 (ADR-0002):** локальный реестр оракула НЕ является источником истины —
    для приёма proof'ов устройство должно быть зарегистрировано on-chain
    (`EnergyProducer` PDA, `register_device`).
- `POST /api/v1/proof/submit` — submit a signed energy proof
  - Body: `{ device_id, timestamp, energyWh, nonce, signature }`
  - `device_id` — base58 Ed25519 публичный ключ (32 байта)
  - Публичный ключ и nonce берутся из **on-chain Device Registry**
    (EnergyProducer PDA). Устройство без on-chain-регистрации отклоняется
    (`404 device_not_registered_on_chain`).
  - `signature` — base64 Ed25519-подпись в **binary** (on-chain) либо **legacy** (строковый) формате
- `GET /api/v1/manifest/:device_id` — подписанный **Device Manifest** (ADR-0004)
  - Ответ: `{ device_id, rated_power, oracle_url, public_key, timestamp,
    trust_level, heartbeat_interval, proof_threshold, policy_version,
    verifier_endpoint, signature }`
  - Подпись: Ed25519 ключом основателя (`FOUNDER_KEY`) над канонической строкой
    `device_id|rated_power|oracle_url|public_key|timestamp|trust_level|heartbeat_interval|proof_threshold|policy_version|verifier_endpoint`
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
- `POST /api/v1/device/revoke/:device_id` — **отзыв устройства** (ADR-0007)
  - Только основатель (транзакция подписывается `FOUNDER_KEY` = vault.authority)
  - Вызывает on-chain `revoke_device` → `revoked=true`, состояние `Revoked` (терминальное)
  - Отозванное устройство не может минтить и менять состояние
- `POST /api/v1/device/rotate/:device_id` — **ротация ключа** (ADR-0007)
  - Body: `{ new_device_id, owner_signature, new_device_signature }`
  - `owner_signature` — Ed25519 подпись владельца (authority producer'а) над
    `` `${device_id}|${new_device_id}` `` — подтверждение намерения владельца
  - `new_device_signature` — Ed25519 подпись НОВОГО ключа над
    `b"enrg:device:rotate" || new(32) || owner(32) || nonce(8) || ts(8)`
    (proof-of-possession нового ключа)
  - Вызывает on-chain `rotate_device_key`: старая запись → `revoked` + `rotated_to`,
    новая запись наследует состояние (owner, nonce, энергия, tier)
- `GET /api/v1/device/:id/status` | `GET /api/v1/device/:id/balance` | `GET /api/v1/device/:id/history`
- `POST /api/v1/pool/create`, `GET /api/v1/stats`
  - ⚠️ **Пул (аудит 2026-08-18, P1):** off-chain пул ведёт накопление энергии,
    но НЕ распределяет токены. Реальное распределение выполняется on-chain
    (`instructions/pool.rs::distribute_pool`); оракул передаёт `pool=null` в
    `mint_energy`. При достижении порога возвращается честный ответ
    `pool_threshold_reached_offchain_distribution_not_implemented`.

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

### Мульти-владельческий mint (ADR-0003)

Mint выполняет **любой доверенный оракул из OracleRegistry**, а не основатель:

1. **Ключ оракула** задаётся отдельно от founder:
   - `ORACLE_KEY` (env, JSON-массив 64 байт) или `ORACLE_KEY_PATH` (файл) —
     загружается через `policy.getOracleKeypair()`.
   - Публичный ключ оракула обязан быть **в on-chain OracleRegistry**
     (`addOracle`), иначе `mint_energy` вернёт `UntrustedOracle`.
2. **On-chain** (`mint_energy`):
   - C-0: `report.oracle ∈ OracleRegistry`;
   - C-2: подписант транзакции = владелец устройства **ИЛИ** `report.oracle`
     (мульти-владельческий mint);
   - награда идёт **владельцу** устройства (`producer.authority`), а не оракулу;
   - отчёт подписывается ключом оракула (не founder).
3. **Оракул подписывает** OracleReport своим ключом и отправляет транзакцию
   `mint_energy` (authority = ключ оракула); ATA владельца создаётся
   автоматически (`getOrCreateAssociatedTokenAccount`).

Добавление оракула в OracleRegistry (on-chain):

```bash
# ключ оракула (сгенерировать и сохранить в защищённом месте)
solana-keygen new -o oracle-keypair.json
# добавить в реестр (authority = oracle_admin, по умолчанию vault.authority)
# через Anchor-клиент: program.methods.addOracle(oraclePubkey)...
#  .accounts({ registry: oracleRegistryPda, authority: oracleAdmin })
```

Если `ORACLE_KEY_PATH`/`ORACLE_KEY` не задан — mint недоступен
(`oracle_key_missing`), оракул продолжает работать (приём proof, манифесты, OTA).

### Тесты

```bash
npm run test:policy        # mocha tests/policy.test.js (юнит Policy Engine)
npm run test:manifest      # tests/manifest.test.js
npm run test:firmware      # tests/firmware.test.js
npm run test:keyrotation   # tests/keyrotation-api.test.js
npm run test:mint          # tests/mint-oracle.test.js (мульти-оракульный mint)
npm run test:anchor        # anchor test --skip-build (on-chain, solana-test-validator)
```

## Configuration
- `ENERGY_THRESHOLD` — Wh to accumulate before minting (default: 1,000,000 Wh = 1 MWh)
- `PROGRAM_ID` — deployed Solana program address
- `MINT_ADDRESS` — SRC token mint
- `FOUNDER_KEY` / `FOUNDER_KEY_PATH` — ключ основателя (оракул), подписывающий OracleReport
- `RPC_ENDPOINT` — Solana RPC (по умолчанию devnet)
- `ENRG_SQLITE_PATH` / `DATABASE_URL` — хранилище (SQLite / PostgreSQL)

