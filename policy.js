'use strict';

/**
 * ENRG Policy Engine — отдельный модуль политик (ADR-0003).
 *
 * Axis-спецификация (ADR-0003) требует разделять Verifier (криптография и
 * передача данных) и Policy Engine (решения о допустимости Proof, лимитах,
 * quarantine и т.п.). Этот модуль реализует Policy Engine для off-chain
 * оракула: ВСЕ проверки входящих данных (format / range / freshness / nonce /
 * signature) вынесены из server.js сюда.
 *
 * Контракт:
 *   - каждая проверка — отдельная чистая функция `validateXxx(...)`;
 *   - результат: `{ ok: true, ...данные }` либо `{ ok: false, status, error }`,
 *     где `status` — HTTP-код, `error` — строка ошибки (обратно совместимы
 *     с прежними ответами server.js);
 *   - `validateProof(proof, ctx)` и `validateRegister(...)` — агрегаты для
 *     маршрутов `/api/v1/proof/submit` и `/api/v1/device/register`.
 *
 * Конфигурация лимитов загружается при старте:
 *   приоритет: переменные окружения > policy-config.json > дефолты.
 *   См. policy-config.json и раздел "Конфигурация политик" в oracle/README.md.
 */

const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const { PublicKey } = require('@solana/web3.js');

// ════════════════════════════════════════════════════════════════
//  КОНФИГУРАЦИЯ ПОЛИТИК (ADR-0003: лимиты — параметры, не хардкод)
// ════════════════════════════════════════════════════════════════

/**
 * Значения по умолчанию. Синхронизированы с on-chain:
 *   - constants.rs::MAX_CLOCK_SKEW = 300
 *   - security/validation.rs::MAX_PROOF_AGE = 900
 */
const DEFAULT_CONFIG = {
    // Лимит энергии в одном отчёте (Wh) — защита от инфляции (CR-2).
    maxEnergyPerReportWh: 1_000_000_000,
    // Метка времени не может быть в будущем более чем на это число секунд (M-3).
    maxTimestampSkewSec: 300,
    // Доказательство не может быть старше этого числа секунд (M-3).
    maxProofAgeSec: 900,
    // Глобальный rate-limit: запросов в минуту на один IP (M-6).
    rateLimitPerMinute: 100,
    // Публичный URL оракула, который попадает в подписанный Device Manifest
    // (ADR-0004). Устройство будет слать proof'ы именно на этот адрес.
    oracleUrl: 'http://localhost:3000',
    // Номинальная мощность устройства по умолчанию (Вт) для Device Manifest,
    // если для устройства не задано иное значение (ADR-0004).
    defaultRatedPowerW: 10_000,
};

/** Маппинг env-переменных → ключей конфигурации (env имеет приоритет). */
const CONFIG_ENV_KEYS = {
    MAX_ENERGY_PER_REPORT_WH: 'maxEnergyPerReportWh',
    MAX_TIMESTAMP_SKEW_SEC: 'maxTimestampSkewSec',
    MAX_PROOF_AGE_SEC: 'maxProofAgeSec',
    RATE_LIMIT_PER_MINUTE: 'rateLimitPerMinute',
    ORACLE_URL: 'oracleUrl',
    DEFAULT_RATED_POWER_W: 'defaultRatedPowerW',
};

/** Текущая (активная) конфигурация. Мутируется через setConfig/reloadConfig. */
let config = { ...DEFAULT_CONFIG };

function _isPositiveNumber(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function _isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Привести значение к валидному типу для ключа конфигурации.
 * Числовые ключи принимают number или числовую строку (> 0); строковые —
 * непустую строку. Возвращает значение или undefined, если оно некорректно.
 */
function _coerceValue(key, v) {
    if (typeof DEFAULT_CONFIG[key] === 'string') {
        return _isNonEmptyString(v) ? v.trim() : undefined;
    }
    const num = typeof v === 'number' ? v : Number(v);
    return _isPositiveNumber(num) ? num : undefined;
}

/**
 * Загрузить конфигурацию: дефолты → policy-config.json → переменные окружения.
 * Возвращает новый объект конфигурации и кладёт его в `config`.
 *
 * @param {object} [opts]
 * @param {string} [opts.configPath] путь к JSON-файлу (по умолчанию POLICY_CONFIG_PATH или ./policy-config.json)
 * @returns {object} активная конфигурация
 */
function loadConfig(opts = {}) {
    const cfg = { ...DEFAULT_CONFIG };

    const configPath =
        opts.configPath ||
        process.env.POLICY_CONFIG_PATH ||
        path.join(__dirname, 'policy-config.json');
    try {
        if (fs.existsSync(configPath)) {
            const fileCfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            for (const key of Object.keys(DEFAULT_CONFIG)) {
                const coerced = _coerceValue(key, fileCfg[key]);
                if (coerced !== undefined) cfg[key] = coerced;
            }
        }
    } catch (e) {
        console.warn('[policy] Cannot load policy-config.json:', e && e.message);
    }

    for (const envKey of Object.keys(CONFIG_ENV_KEYS)) {
        const raw = process.env[envKey];
        if (raw !== undefined) {
            const coerced = _coerceValue(CONFIG_ENV_KEYS[envKey], raw);
            if (coerced !== undefined) cfg[CONFIG_ENV_KEYS[envKey]] = coerced;
        }
    }

    // Мутируем объект на месте, чтобы внешняя ссылка `module.exports.config`
    // всегда отражала актуальную конфигурацию (важно для тестов/горячей смены).
    for (const key of Object.keys(DEFAULT_CONFIG)) {
        config[key] = cfg[key];
    }
    return config;
}

/**
 * Перезагрузить конфигурацию из policy-config.json + env.
 * Полезно при смене файла конфигурации без рестарта, а также в тестах.
 */
function reloadConfig() {
    return loadConfig();
}

/**
 * Задать/переопределить значения конфигурации в рантайме (в основном для тестов).
 * @param {object} overrides частичные переопределения ключей DEFAULT_CONFIG
 */
function setConfig(overrides = {}) {
    for (const key of Object.keys(DEFAULT_CONFIG)) {
        const coerced = _coerceValue(key, overrides[key]);
        if (coerced !== undefined) config[key] = coerced;
    }
    return config;
}

/**
 * Готовый объект опций для express-rate-limit (RATE_LIMIT_PER_MINUTE).
 * Сервер просто подставляет его в rateLimit(policy.rateLimitOptions()).
 */
function rateLimitOptions() {
    return {
        windowMs: 60 * 1000,
        max: config.rateLimitPerMinute,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'too many requests, please retry later' },
    };
}

// ════════════════════════════════════════════════════════════════
//  ХЕЛПЕРЫ (канонические сообщения подписи, on-chain формат)
// ════════════════════════════════════════════════════════════════

/** little-endian u64 (совпадает с state/oracle.rs device_message_to_sign). */
function le8(value) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(Math.trunc(Number(value))), 0);
    return b;
}

/** OracleReport::device_message_to_sign(): device_id || nonce || device_timestamp || energy_wh */
function buildDeviceMessage(deviceIdPubkey, nonce, timestamp, energyWh) {
    return Buffer.concat([deviceIdPubkey.toBuffer(), le8(nonce), le8(timestamp), le8(energyWh)]);
}

/** OracleReport::oracle_message_to_sign(): device_id || nonce || device_timestamp || verified_at || energy_wh */
function buildOracleMessage(deviceIdPubkey, nonce, timestamp, verifiedAt, energyWh) {
    return Buffer.concat([deviceIdPubkey.toBuffer(), le8(nonce), le8(timestamp), le8(verifiedAt), le8(energyWh)]);
}

/**
 * Разобрать device_id как Solana Pubkey (32 байта):
 *   - "0x" + 64 hex-символа, либо
 *   - base58-строка, декодирующаяся ровно в 32 байта.
 * Возвращает PublicKey или null.
 */
function parseDevicePubkey(device_id) {
    if (typeof device_id !== 'string' || !device_id) return null;
    try {
        if (/^0x[0-9a-fA-F]{64}$/.test(device_id)) return new PublicKey(Buffer.from(device_id.slice(2), 'hex'));
        const b = bs58.decode(device_id);
        if (b.length !== 32) return null;
        return new PublicKey(b);
    } catch (e) {
        return null;
    }
}



// ════════════════════════════════════════════════════════════════
//  DEVICE MANIFEST (ADR-0004) — каноническое сообщение и подписи
// ════════════════════════════════════════════════════════════════

/**
 * Каноническая строка для подписи Device Manifest (ADR-0004).
 *
 * Формат (должен побайтово совпадать в оракуле и в прошивке ESP32):
 *   `device_id|rated_power|oracle_url|public_key|timestamp`
 *
 * Ограничение: поля НЕ должны содержать символ '|'. Оракул гарантирует это
 * для oracle_url (валидируется в эндпоинте), остальные поля — base58/hex/
 * base64/число, в которых '|' невозможен.
 *
 * @param {object} m { device_id, rated_power, oracle_url, public_key, timestamp }
 * @returns {string}
 */
function buildManifestMessage(m) {
    return `${m.device_id}|${m.rated_power}|${m.oracle_url}|${m.public_key}|${m.timestamp}`;
}

/**
 * Подписать Device Manifest ключом оракула (FOUNDER_KEY, Ed25519).
 *
 * @param {object} manifest поля манифеста (см. buildManifestMessage)
 * @param {Uint8Array} secretKey Ed25519 secret key (64 байта)
 * @returns {string} base64-подпись (64 байта)
 */
function signManifest(manifest, secretKey) {
    const msg = Buffer.from(buildManifestMessage(manifest), 'utf8');
    const sig = nacl.sign.detached(new Uint8Array(msg), secretKey);
    return Buffer.from(sig).toString('base64');
}

/**
 * Проверить подпись Device Manifest публичным ключом оракула (Ed25519).
 * Зеркалит логику прошивки ESP32 (verifyManifest в esp32_proof_sender_v3.ino).
 *
 * @param {object} manifest поля манифеста (см. buildManifestMessage)
 * @param {string} signature base64-подпись
 * @param {Uint8Array|string} publicKey публичный ключ оракула (32 байта) или base64
 * @returns {{ok: true} | {ok: false, error: string}}
 */
function verifyManifest(manifest, signature, publicKey) {
    if (!manifest || typeof manifest !== 'object') {
        return { ok: false, error: 'manifest_missing' };
    }
    const required = ['device_id', 'rated_power', 'oracle_url', 'public_key', 'timestamp'];
    for (const f of required) {
        if (manifest[f] === undefined || manifest[f] === null || manifest[f] === '') {
            return { ok: false, error: `manifest_field_missing:${f}` };
        }
    }
    if (typeof signature !== 'string') {
        return { ok: false, error: 'signature_missing' };
    }
    let sigBytes;
    let pubBytes;
    try {
        sigBytes = Buffer.from(signature, 'base64');
        pubBytes = typeof publicKey === 'string' ? Buffer.from(publicKey, 'base64') : Buffer.from(publicKey);
        if (sigBytes.length !== 64 || pubBytes.length !== 32) {
            return { ok: false, error: 'bad_signature_or_key_length' };
        }
    } catch (e) {
        return { ok: false, error: 'bad_encoding' };
    }
    const msg = Buffer.from(buildManifestMessage(manifest), 'utf8');
    const valid = nacl.sign.detached.verify(
        new Uint8Array(msg),
        new Uint8Array(sigBytes),
        new Uint8Array(pubBytes)
    );
    if (!valid) return { ok: false, error: 'signature_invalid' };
    return { ok: true };
}

/** Короткая фабрика результата-ошибки. */
function fail(status, error) {
    return { ok: false, status, error };
}


// ════════════════════════════════════════════════════════════════
//  ВАЛИДАЦИИ (по одной функции на проверку)
// ════════════════════════════════════════════════════════════════

/**
 * Проверка формата device_id.
 * Допустимо: base58 (алфавит без 0/O/I/l) или hex с префиксом "0x" (чётная длина).
 * Отклоняет спецсимволы, пробелы, XSS-пейлоады, строки > 128 символов (M-5).
 *
 * @param {*} device_id значение из запроса
 * @returns {{ok: true, deviceIdPubkey: (PublicKey|null)} | {ok: false, status: number, error: string}}
 */
function validateDeviceId(device_id) {
    if (typeof device_id !== 'string' || device_id.length === 0 || device_id.length > 128) {
        return fail(400, 'invalid device_id format (base58 or hex only)');
    }
    const isBase58 = /^[1-9A-HJ-NP-Za-km-z]+$/.test(device_id);
    const isHex = /^0x[0-9a-fA-F]+$/.test(device_id) && device_id.length % 2 === 0;
    if (!isBase58 && !isHex) {
        return fail(400, 'invalid device_id format (base58 or hex only)');
    }
    return { ok: true, deviceIdPubkey: parseDevicePubkey(device_id) };
}

/**
 * Валидация energyWh: тип number/string, конечное значение, строка только
 * цифры с опциональной дробной частью, положительное, ≤ maxEnergyPerReportWh.
 * Отклоняет NaN/Infinity, null (Number(null)=0), отрицательные, нуль и
 * значения выше лимита (CR-2).
 *
 * @param {*} energyWh значение из запроса
 * @returns {{ok: true, energyWhNum: number, energyWhInt: number} | {ok: false, status, error}}
 */
function validateEnergyWh(energyWh) {
    if (typeof energyWh !== 'number' && typeof energyWh !== 'string') {
        return fail(400, 'invalid energyWh (must be a number)');
    }
    const energyWhNum = Number(energyWh);
    if (!Number.isFinite(energyWhNum)) {
        return fail(400, 'invalid energyWh (must be a finite number)');
    }
    if (typeof energyWh === 'string' && !/^\d+(\.\d+)?$/.test(energyWh.trim())) {
        return fail(400, 'invalid energyWh format');
    }
    if (energyWhNum <= 0) {
        return fail(400, 'invalid energyWh (must be positive)');
    }
    if (energyWhNum > config.maxEnergyPerReportWh) {
        return fail(400, `energyWh exceeds maximum allowed per report (${config.maxEnergyPerReportWh} Wh)`);
    }
    return { ok: true, energyWhNum, energyWhInt: Math.round(energyWhNum) };
}

/**
 * Валидация timestamp: тип number/string, конечное значение, свежесть.
 *   - не в будущем более чем на maxTimestampSkewSec (по умолчанию 300 = 5 мин);
 *   - не старше maxProofAgeSec (по умолчанию 900 = 15 мин).
 * Синхронизировано с on-chain verify_timestamp() (M-3).
 *
 * @param {*} timestamp значение из запроса
 * @param {number} [nowSec] текущее время в секундах (для тестов; по умолчанию Date.now()/1000)
 * @returns {{ok: true, timestamp: number} | {ok: false, status, error}}
 */
function validateTimestamp(timestamp, nowSec) {
    if (typeof timestamp !== 'number' && typeof timestamp !== 'string') {
        return fail(400, 'invalid timestamp (must be a number)');
    }
    const timestampNum = Number(timestamp);
    if (!Number.isFinite(timestampNum)) {
        return fail(400, 'invalid timestamp (must be a finite number)');
    }
    const now = nowSec !== undefined ? nowSec : Math.floor(Date.now() / 1000);
    if (timestampNum > now + config.maxTimestampSkewSec) {
        return fail(400, 'FutureTimestamp');
    }
    if (now - timestampNum > config.maxProofAgeSec) {
        return fail(400, 'StaleProof');
    }
    return { ok: true, timestamp: timestampNum };
}

/**
 * Валидация nonce: положительное целое, строго больше последнего принятого
 * nonce устройства (защита от replay, CR-2). Последний nonce передаётся
 * аргументом либо резолвится в validateProof через ctx.getLastNonce.
 *
 * @param {*} nonce значение из запроса
 * @param {number} [lastNonce] последний принятый nonce (по умолчанию 0)
 * @returns {{ok: true, nonce: number} | {ok: false, status, error}}
 */
function validateNonce(nonce, lastNonce = 0) {
    if (typeof nonce !== 'number' && typeof nonce !== 'string') {
        return fail(400, 'invalid nonce (must be a positive integer)');
    }
    const nonceNum = Number(nonce);
    if (!Number.isInteger(nonceNum) || nonceNum <= 0) {
        return fail(400, 'invalid nonce (must be a positive integer)');
    }
    if (nonceNum <= lastNonce) {
        return fail(400, 'InvalidNonce');
    }
    return { ok: true, nonce: nonceNum };
}


/**
 * Проверка подписи (proof-of-possession) для proof.
 *
 * Форматы (CR-3):
 *   - 'binary' (on-chain совместимая): Ed25519 над
 *       device_id(32) || nonce(le8) || device_timestamp(le8) || energy_wh(le8)
 *     — только её можно использовать для on-chain mint;
 *   - 'legacy' (строковый формат): Ed25519 над
 *       `${device_id}|${timestamp}|${energyWh}|${nonce}`
 *     — принимается, но mint недоступен (только накопление).
 *
 * Ошибки обратно совместимы: 400 'invalid signature format' при битой base64,
 * 401 'invalid signature' при неверной длине/невалидной подписи.
 *
 * @param {object} p
 * @param {string} p.device_id
 * @param {PublicKey|null} p.deviceIdPubkey
 * @param {string} p.publicKeyB64 base64-публичный ключ устройства (из реестра)
 * @param {string} p.signature base64-подпись
 * @param {*} p.rawNonce / p.rawTimestamp / p.rawEnergyWh — исходные значения (для legacy-формата)
 * @param {number} p.nonce / p.timestamp / p.energyWhInt — проверенные числовые значения (для binary-формата)
 * @returns {{ok: true, sigMode: 'binary'|'legacy', sigBytes: Buffer, pubBytes: Buffer, deviceIdPubkey: PublicKey|null} | {ok: false, status, error}}
 */
function validateSignature(p) {
    let sigBytes;
    let pubBytes;
    try {
        if (typeof p.signature !== 'string') throw new Error('bad signature type');
        sigBytes = Buffer.from(p.signature, 'base64');
        pubBytes = Buffer.from(p.publicKeyB64, 'base64');
    } catch (e) {
        return fail(400, 'invalid signature format');
    }
    if (sigBytes.length !== 64 || pubBytes.length !== 32) {
        return fail(401, 'invalid signature');
    }

    let sigMode = null;
    try {
        if (p.deviceIdPubkey) {
            const bmsg = buildDeviceMessage(p.deviceIdPubkey, p.nonce, p.timestamp, p.energyWhInt);
            if (nacl.sign.detached.verify(new Uint8Array(bmsg), new Uint8Array(sigBytes), new Uint8Array(pubBytes))) {
                sigMode = 'binary';
            }
        }
        if (!sigMode) {
            const lmsg = Buffer.from(`${p.device_id}|${p.rawTimestamp}|${p.rawEnergyWh}|${p.rawNonce}`, 'utf8');
            if (nacl.sign.detached.verify(new Uint8Array(lmsg), new Uint8Array(sigBytes), new Uint8Array(pubBytes))) {
                sigMode = 'legacy';
            }
        }
    } catch (e) {
        return fail(400, 'invalid signature');
    }
    if (!sigMode) return fail(401, 'invalid signature');

    return { ok: true, sigMode, sigBytes, pubBytes, deviceIdPubkey: p.deviceIdPubkey };
}


/**
 * Агрегат: полная валидация входящего proof для /api/v1/proof/submit.
 *
 * Порядок проверок (и HTTP-коды) сохранены такими же, как в прежнем server.js:
 *   missing fields(400) → device_id(400) → energyWh(400) → timestamp(400)
 *   → unknown device(400, через ctx.getPublicKey) → nonce(400) → signature(400/401).
 *
 * @param {object} proof тело запроса { device_id, timestamp, energyWh, nonce, signature, pool_id? }
 * @param {object} [ctx]
 * @param {(device_id: string) => string|null} [ctx.getPublicKey] резолвер base64-публичного ключа из реестра
 * @param {(device_id: string) => number} [ctx.getLastNonce] резолвер последнего принятого nonce
 * @param {number} [ctx.nowSec] текущее время (сек) для проверки свежести; по умолчанию Date.now()/1000
 * @returns {{ok: true, proof: object, pool_id?: string} | {ok: false, status, error}}
 */
function validateProof(proof, ctx = {}) {
    if (!proof || typeof proof !== 'object') {
        return fail(400, 'missing fields');
    }
    const { device_id, timestamp, energyWh, nonce, signature, pool_id } = proof;
    if (!device_id || timestamp === undefined || energyWh === undefined || nonce === undefined || !signature) {
        return fail(400, 'missing fields');
    }

    const d = validateDeviceId(device_id);
    if (!d.ok) return d;

    const e = validateEnergyWh(energyWh);
    if (!e.ok) return e;

    const t = validateTimestamp(timestamp, ctx.nowSec);
    if (!t.ok) return t;

    // Реестр: устройство должно быть известно оракулу (registry-состояние).
    const publicKeyB64 = ctx.getPublicKey ? ctx.getPublicKey(device_id) : ctx.publicKeyB64;
    if (!publicKeyB64) return fail(400, 'unknown device');

    const lastNonce = ctx.getLastNonce ? ctx.getLastNonce(device_id) : ctx.lastNonce || 0;
    const n = validateNonce(nonce, lastNonce);
    if (!n.ok) return n;

    const s = validateSignature({
        device_id,
        deviceIdPubkey: d.deviceIdPubkey,
        publicKeyB64,
        signature,
        rawNonce: nonce,
        rawTimestamp: timestamp,
        rawEnergyWh: energyWh,
        nonce: n.nonce,
        timestamp: t.timestamp,
        energyWhInt: e.energyWhInt,
    });
    if (!s.ok) return s;

    return {
        ok: true,
        proof: {
            device_id,
            device_id_pubkey: s.deviceIdPubkey,
            nonce: n.nonce,
            device_timestamp: t.timestamp,
            energy_wh: e.energyWhInt,
            device_signature: s.sigBytes,
            sig_mode: s.sigMode,
        },
        pool_id,
    };
}


/**
 * Агрегат: полная валидация регистрации устройства для /api/v1/device/register.
 * Ошибки обратно совместимы: 400 для формата/длин, 403 при неверной
 * proof-of-possession-подписи.
 *
 * @param {string} device_id
 * @param {string} public_key base64 (32 байта)
 * @param {string} signature base64 (64 байта) над сообщением `${device_id}|${public_key}`
 * @returns {{ok: true, pubBytes: Buffer, sigBytes: Buffer} | {ok: false, status, error}}
 */
function validateRegister(device_id, public_key, signature) {
    const d = validateDeviceId(device_id);
    if (!d.ok) return d;

    let pubBytes;
    try {
        pubBytes = Buffer.from(public_key, 'base64');
        if (pubBytes.length !== 32) {
            return fail(400, 'invalid public key (must be 32 bytes base64)');
        }
    } catch (e) {
        return fail(400, 'invalid public key format');
    }

    let sigBytes;
    try {
        sigBytes = Buffer.from(signature, 'base64');
        if (sigBytes.length !== 64) {
            return fail(400, 'invalid signature (must be 64 bytes base64)');
        }
    } catch (e) {
        return fail(400, 'invalid signature format');
    }

    // CR-1: proof-of-possession по детерминированному challenge.
    const msgBytes = Buffer.from(`${device_id}|${public_key}`, 'utf8');
    const verified = nacl.sign.detached.verify(
        new Uint8Array(msgBytes),
        new Uint8Array(sigBytes),
        new Uint8Array(pubBytes)
    );
    if (!verified) {
        return fail(403, 'invalid signature: proof of device key ownership required');
    }
    return { ok: true, pubBytes, sigBytes };
}

// Загружаем конфигурацию при импорте модуля (старт оракула).
loadConfig();

module.exports = {
    // config
    config,
    DEFAULT_CONFIG,
    loadConfig,
    reloadConfig,
    setConfig,
    rateLimitOptions,
    // helpers
    le8,
    buildDeviceMessage,
    buildOracleMessage,
    parseDevicePubkey,
    // manifest (ADR-0004)
    buildManifestMessage,
    signManifest,
    verifyManifest,
    // validators
    validateDeviceId,
    validateEnergyWh,
    validateTimestamp,
    validateNonce,
    validateSignature,
    // aggregates
    validateProof,
    validateRegister,
};

