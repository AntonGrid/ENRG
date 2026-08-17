/*
 * ENRG Proof Sender v3 — security-hardened firmware (H-3 / H-4 fixes).
 *
 * Изменения относительно v1/v2:
 *   1. (H-3) НЕТ захардкоженного приватного ключа: ключ генерируется при
 *      первой загрузке и хранится в NVS (Preferences) либо в защищённом
 *      слоте ATECC608A (если ENRG_USE_ATECC608=1).
 *   2. (H-4) Опциональный Secure Element ATECC608A как защищённое хранилище
 *      seed-ключа. ВАЖНО: ATECC608A НЕ поддерживает Ed25519 — подпись
 *      выполняется в CPU, чип используется как защищённый Data-Zone slot
 *      (seed не лежит в открытом NVS). Для ПОЛНОЙ аппаратной подписи Ed25519
 *      добавлен путь NXP SE050 (ENRG_USE_SE050=1, env esp32dev-se050):
 *      ключ генерируется и подпись выполняется ВНУТРИ чипа (ADR-0001).
 *      Если чип недоступен — ключ в NVS + предупреждение.
 *   3. Бинарный формат подписи (как on-chain OracleReport::device_message_to_sign):
 *        device_id(32) || nonce(8 LE) || timestamp(8 LE) || energy_wh(8 LE)
 *   4. Wall-clock через NTP (не millis()).
 *   5. HTTPS c проверкой корневого сертификата; mTLS опционально.
 *
 * Зависимости (PlatformIO):
 *   - platform: espressif32 (Arduino framework)
 *   - lib_deps: rweather/Crypto   (Ed25519)
 *   - опционально: cryptoauthlib (при ENRG_USE_ATECC608)
 *   - опционально: se050          (при ENRG_USE_SE050 — NXP SE050)
 *   - опционально: PZEM004Tv30    (при ENRG_USE_PZEM)
 *
 * Поля /api/v1/proof/submit: device_id (0x-hex 64), timestamp, energyWh,
 * nonce, signature (base64). Подпись — бинарный формат, проверяется
 * server.js как sig_mode='binary'.
 */

// ════════════════════════════════════════════════════════════════
//  КОНФИГУРАЦИЯ (заполните перед прошивкой)
// ════════════════════════════════════════════════════════════════

#ifndef WIFI_SSID
#define WIFI_SSID "YOUR_WIFI_SSID"
#endif
#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#endif

// HTTP(S)-эндпоинт оракула. Прошивка поддерживает оба режима: http://
// (локальная сеть / dev) и https:// (с проверкой корневого CA, ENRG_CA_CERT).
// Используется по умолчанию (обратная совместимость). Если получен валидный
// Device Manifest (ADR-0004), реальный URL берётся из manifest.oracle_url.
// ⚠️ Если IP ноутбука с оракулом изменится — обновите этот адрес и перепрошейте.
#ifndef ENRG_ORACLE_URL
#define ENRG_ORACLE_URL "http://192.168.1.123:3000/api/v1/proof/submit"
#endif

// ── Device Manifest (ADR-0004) ──
// База URL эндпоинта манифестов: к ней добавляется "/<device_id>".
#ifndef ENRG_MANIFEST_URL_BASE
#define ENRG_MANIFEST_URL_BASE "http://192.168.1.123:3000/api/v1/manifest"
#endif

// Публичный ключ ОРАКУЛА (основателя, Ed25519, 32 байта) — вшивается в прошивку.
// Манифесты подписываются этим ключом на стороне оракула (FOUNDER_KEY);
// устройство проверяет подпись ДО использования манифеста.
// ЗАПОЛНИТЕ реальным ключом перед прошивкой (32 hex-байта, без "0x").
#ifndef ENRG_FOUNDER_PUBKEY_HEX
// Реальный founder-ключ (Ed25519, 32 байта hex) — публичный ключ оракула,
// которым подписываются Device Manifests (ADR-0004) и firmware-образы (ADR-0008).
// Соответствует founder-кошельку ~/.config/solana/founder-wallet.json
// (base58: 6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8).
// ВАЖНО: при смене FOUNDER_KEY на оракуле обновите ключ и перепрошейте устройства.
#define ENRG_FOUNDER_PUBKEY_HEX "545ebb75bdc2022c089a4813eb4e76acc7c6628cadd18eb84d74131ccf9bfafd"
#endif

// ── ОТДЕЛЬНЫЙ «холодный» ключ подписи прошивок (ADR-0008, D-5) ──
// Образы OTA подписываются ЭТИМ ключом, а НЕ founder-ключом (принцип
// разделения ключей: founder подписывает манифесты, firmware-ключ — образы).
// Приватный ключ хранится в офлайн-хранилище (HSM/холодный кошелёк); dev-копия —
// firmware/firmware-signing-keypair.json (gitignored). Публичный ключ вшит
// сюда для проверки подписи OTA-метаданных на устройстве.
#ifndef ENRG_FIRMWARE_PUBKEY_HEX
#define ENRG_FIRMWARE_PUBKEY_HEX "393561ec672d078ea3cae1962db935568fd1af06ddd25b65be3bdfe746d23354"
#endif

// 1 — манифест обязателен: без валидного манифеста proof'ы НЕ отправляются.
// 0 — обратная совместимость: при недоступном/невалидном манифесте устройство
//     работает по хардкод-конфигурации (ENRG_ORACLE_URL).
#ifndef ENRG_MANIFEST_REQUIRED
#define ENRG_MANIFEST_REQUIRED 0
#endif

// Как часто повторять попытку получить манифест (мс), если он не получен.
#ifndef ENRG_MANIFEST_RETRY_MS
#define ENRG_MANIFEST_RETRY_MS 60000UL
#endif

// ── OTA-обновления (ADR-0008) ──
// Текущая версия прошивки (используется для анти-отката).
#ifndef ENRG_FW_VERSION
#define ENRG_FW_VERSION "1.0.0"
#endif

// База URL эндпоинтов firmware оракула: к ней добавляется /latest и /latest/image.
#ifndef ENRG_FIRMWARE_URL_BASE
#define ENRG_FIRMWARE_URL_BASE "http://192.168.1.123:3000/api/v1/firmware"
#endif

// Модель устройства (оракул кладёт её в метаданные; устройство пропускает
// обновление, если модель не совпадает).
#ifndef ENRG_FW_MODEL
#define ENRG_FW_MODEL "ENRG-ESP32-v1"
#endif

// Как часто проверять наличие обновлений (мс). По умолчанию 6 часов.
#ifndef ENRG_UPDATE_CHECK_MS
#define ENRG_UPDATE_CHECK_MS 21600000UL
#endif

// Максимальный размер образа (байт) — меньше OTA-раздела ESP32 (~1.3 МБ).
#ifndef ENRG_MAX_FW_SIZE
#define ENRG_MAX_FW_SIZE 1300000UL
#endif

// NTP-сервер для wall-clock.
#ifndef ENRG_NTP_SERVER
#define ENRG_NTP_SERVER "pool.ntp.org"
#endif

// Корневой сертификат CA для проверки TLS-соединения.
// Пример для Let's Encrypt (ISRG Root X1): https://letsencrypt.org/certs/isrgrootx1.pem.txt
#ifndef ENRG_CA_CERT
#define ENRG_CA_CERT nullptr
#endif

// ── mTLS (опционально): клиентский сертификат и ключ (PEM). ──
#ifndef ENRG_MTLS
#define ENRG_MTLS 0
#endif
#ifndef ENRG_CLIENT_CERT
#define ENRG_CLIENT_CERT nullptr
#endif
#ifndef ENRG_CLIENT_PRIVKEY
#define ENRG_CLIENT_PRIVKEY nullptr
#endif

// ── Secure Element ATECC608 (опционально). Требует cryptoauthlib. ──
#ifndef ENRG_USE_ATECC608
#define ENRG_USE_ATECC608 0
#endif
// Номер Data-Zone слота ATECC608A для хранения 32-байтного seed (0..15).
#ifndef ENRG_ATECC_SLOT
#define ENRG_ATECC_SLOT 4
#endif

// ── Secure Element NXP SE050 (опционально). Требует lib_deps: se050. ──
// SE050 поддерживает Ed25519 НАТИВНО: приватный ключ хранится и подпись
// выполняется ВНУТРИ чипа — полное соответствие ADR-0001 (в отличие от
// ATECC608A, где только seed-vault, а подпись — в CPU).
// Сборка: pio run -e esp32dev-se050   (см. platformio.ini).
// ⚠️ Путь требует платы с SE050 (I2C) и библиотеки se050; по умолчанию
// выключен — не влияет на базовую сборку.
#ifndef ENRG_USE_SE050
#define ENRG_USE_SE050 0
#endif
// SSS object id Ed25519-ключа внутри SE050.
#ifndef ENRG_SE050_KEY_ID
#define ENRG_SE050_KEY_ID 0x00000011
#endif
// I2C-адрес SE050 (0x48 — по умолчанию, SE050 rev B).
#ifndef ENRG_SE050_I2C_ADDR
#define ENRG_SE050_I2C_ADDR 0x48
#endif

// ── Аппаратный анти-откат OTA (ADR-0008) ──
// 1 = dual-bank A/B + monotonic eFuse secure_version (env esp32dev-ota).
// Требует partitions_ota.csv (app0/app1/otadata) и
// sdkconfig.defaults.esp32dev-ota (CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y,
// CONFIG_BOOTLOADER_EFUSE_SECURE_VERSION=y). По умолчанию 0 — не влияет
// на базовую сборку (single-app, анти-откат только через NVS fw_version).
#ifndef ENRG_ENABLE_HW_ANTI_ROLLBACK
#define ENRG_ENABLE_HW_ANTI_ROLLBACK 0
#endif

// ── Сенсор PZEM-004T (опционально). Без него — заглушка read_energy_wh(). ──
#ifndef ENRG_USE_PZEM
#define ENRG_USE_PZEM 0
#endif

// Интервал отправки proof, мс (по умолчанию 60 c).
#ifndef ENRG_REPORT_INTERVAL_MS
#define ENRG_REPORT_INTERVAL_MS 60000UL
#endif

// Минимальный epoch для признания времени синхронизированным (2000-09-09).
#ifndef ENRG_MIN_EPOCH
#define ENRG_MIN_EPOCH 968000000L

// ════════════════════════════════════════════════════════════════
//  INCLUDE
// ════════════════════════════════════════════════════════════════

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>   // ADR-0004: разбор подписанного Device Manifest
#include <LittleFS.h>      // ADR-0008: staging-область для OTA-образа
#include <Update.h>        // ADR-0008: ESP32 OTA (обновление прошивки)
#include <Crypto.h>        // Ed25519 (подписи)
#include <SHA256.h>        // ADR-0008: SHA-256 для проверки OTA-образа
#include <Ed25519.h>

#if ENRG_USE_PZEM
#include <PZEM004Tv30.h>
#endif

#if ENRG_USE_ATECC608
#include <cryptoauthlib.h>
#endif

#if ENRG_USE_SE050
// NXP SE050 (plug-and-trust): SSS API. Требует lib_deps: se050.
#include <sss.h>
#include <fsl_sss_se05x_apis.h>
#include <fsl_sss_se05x_types.h>
#endif

#if ENRG_ENABLE_HW_ANTI_ROLLBACK
// ADR-0008: dual-bank OTA (esp_ota A/B) + monotonic eFuse secure_version.
#include <esp_ota_ops.h>
#include <esp_efuse.h>
#endif

// ── Глобальные ключи устройства (заполняются в identity_init_v3) ──
static uint8_t g_privateKey[32];
static uint8_t g_publicKey[32];
static unsigned long g_lastReportMs = 0;

// ════════════════════════════════════════════════════════════════
//  base64 (компактная реализация, без внешних библиотек)
// ════════════════════════════════════════════════════════════════

static const char BASE64_CHARS[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

String base64_encode(const uint8_t *data, size_t len) {
    String out;
    out.reserve(((len + 2) / 3) * 4);
    for (size_t i = 0; i < len; i += 3) {
        uint32_t b = ((uint32_t)data[i]) << 16;
        if (i + 1 < len) b |= ((uint32_t)data[i + 1]) << 8;
        if (i + 2 < len) b |= data[i + 2];
        out += BASE64_CHARS[(b >> 18) & 0x3F];
        out += BASE64_CHARS[(b >> 12) & 0x3F];
        out += (i + 1 < len) ? BASE64_CHARS[(b >> 6) & 0x3F] : '=' ;
        out += (i + 2 < len) ? BASE64_CHARS[b & 0x3F] : '=';
    }
    return out;
}

// Значение base64-символа (0..63) или -1, если символ недопустим.
static int b64_val(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

/**
 * Декодирование base64 (без внешних библиотек). Возвращает число
 * декодированных байт или -1 при ошибке/переполнении буфера.
 * Используется для разбора signature Device Manifest (ADR-0004).
 */
int base64_decode(const String &in, uint8_t *out, size_t maxOut) {
    size_t oi = 0;
    int buf = 0, bits = 0;
    for (size_t i = 0; i < in.length(); i++) {
        char c = in[i];
        if (c == '=' || c == '\r' || c == '\n' || c == ' ') break; // padding/мусор
        int v = b64_val(c);
        if (v < 0) return -1;
        buf = (buf << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            if (oi >= maxOut) return -1;
            out[oi++] = (uint8_t)((buf >> bits) & 0xFF);
        }
    }
    return (int)oi;
}

// ════════════════════════════════════════════════════════════════
//  hex (device_id = "0x" + 64 hex-символа публичного ключа)
// ════════════════════════════════════════════════════════════════

String to_hex(const uint8_t *data, size_t len) {
    static const char HEX_CHARS[] = "0123456789abcdef";
    String out;
    out.reserve(len * 2);
    for (size_t i = 0; i < len; ++i) {
        out += HEX_CHARS[(data[i] >> 4) & 0x0F];
        out += HEX_CHARS[data[i] & 0x0F];
    }
    return out;
}

String device_id_from_pubkey(const uint8_t *pubkey) {
    return "0x" + to_hex(pubkey, 32);
}

// ════════════════════════════════════════════════════════════════
//  ХРАНИЛИЩЕ КЛЮЧА (H-3 / H-4)
//  Приоритет: ATECC608A (если включён и доступен) → NVS.
// ════════════════════════════════════════════════════════════════

static Preferences g_prefs;
static bool g_key_in_secure_element = false;

static bool store_seed_atecc(const uint8_t seed[32]) {
#if ENRG_USE_ATECC608
    ATCA_STATUS status = atcab_init(NULL);
    if (status != ATCA_SUCCESS) return false;
    // Запись в Data-Zone слот; слот должен быть сконфигурирован как
    // write-protected/encrypted (см. datasheet ATECC608A, config zone).
    status = atcab_write_bytes(ENRG_ATECC_SLOT, 0, (uint8_t *)seed, 32);
    if (status != ATCA_SUCCESS) return false;
    g_key_in_secure_element = true;
    return true;
#else
    (void)seed;
    return false;
#endif
}

static bool load_seed_atecc(uint8_t seed[32]) {
#if ENRG_USE_ATECC608
    ATCA_STATUS status = atcab_init(NULL);
    if (status != ATCA_SUCCESS) return false;
    status = atcab_read_bytes(ENRG_ATECC_SLOT, 0, seed, 32);
    if (status != ATCA_SUCCESS) return false;
    g_key_in_secure_element = true;
    return true;
#else
    (void)seed;
    return false;
#endif
}

#if ENRG_USE_SE050
// ════════════════════════════════════════════════════════════════
//  NXP SE050 — аппаратная Ed25519-подпись (полное соответствие ADR-0001).
//
//  В отличие от ATECC608A (seed-vault + подпись в CPU), SE050 умеет Ed25519
//  НАТИВНО: приватный ключ генерируется/хранится ВНУТРИ чипа и никогда не
//  покидает его; подпись выполняется аппаратно.
//
//  ⚠️ REFERENCE IMPLEMENTATION: код требует платы с SE050 (I2C) и библиотеки
//  `se050` (PlatformIO env `esp32dev-se050`). Без чипа путь не собирается и
//  не включается (ENRG_USE_SE050=0 по умолчанию). При bring-up сверьте имена
//  SSS-функций с версией библиотеки.
// ════════════════════════════════════════════════════════════════

static sss_se05x_connect_ctx_t g_se05x_ctx = {0};
static sss_session_t g_se05x_session = {0};
static sss_key_store_t g_se05x_key_store = {0};
static sss_object_t g_se05x_key_obj = {0};
static sss_asymmetric_t g_se05x_asym = {0};
static bool g_se050_ready = false;

/** Открыть сессию с SE050 (I2C). */
static bool se050_open() {
    sss_status_t st = sss_se05x_connect(&g_se05x_ctx);
    if (st != kStatus_SSS_Success) {
        Serial.println("[SE050] connect failed");
        return false;
    }
    st = sss_open_session(&g_se05x_session, &g_se05x_ctx, kSSS_ConnectionType_Plain);
    if (st != kStatus_SSS_Success) {
        Serial.println("[SE050] open session failed");
        return false;
    }
    st = sss_key_store_init(&g_se05x_key_store, &g_se05x_session);
    if (st != kStatus_SSS_Success) {
        Serial.println("[SE050] key store init failed");
        return false;
    }
    st = sss_key_object_init(&g_se05x_key_obj, &g_se05x_key_store);
    if (st != kStatus_SSS_Success) {
        Serial.println("[SE050] key object init failed");
        return false;
    }
    return true;
}

/**
 * Загрузить существующий Ed25519-ключ из SE050 или создать новый ВНУТРИ чипа.
 * Публичный ключ получаем из SE050 (device_id стабилен между загрузками).
 */
static bool se050_load_or_create_key(uint8_t publicKey[32]) {
    sss_status_t st = sss_crypto_object_get_handle(
        &g_se05x_key_obj, &g_se05x_key_store,
        kSSS_KeyPart_Pair_Ed25519, kSSS_CipherType_EC_ED25519, ENRG_SE050_KEY_ID);
    if (st != kStatus_SSS_Success) {
        // Ключа нет — генерируем ПРЯМО В SE050 (секрет не появляется на шине).
        st = sss_crypto_object_create(
            &g_se05x_key_obj, &g_se05x_key_store,
            kSSS_KeyPart_Pair_Ed25519, kSSS_CipherType_EC_ED25519, ENRG_SE050_KEY_ID);
        if (st != kStatus_SSS_Success) {
            Serial.println("[SE050] key create failed");
            return false;
        }
        Serial.println("[SE050] Ed25519 keypair created inside chip");
    } else {
        Serial.println("[SE050] existing Ed25519 key loaded");
    }

    st = sss_asymmetric_context_init(&g_se05x_asym, &g_se05x_session,
                                     &g_se05x_key_obj, kAlgorithm_SSS_Ed25519,
                                     kMode_SSS_Sign);
    if (st != kStatus_SSS_Success) {
        Serial.println("[SE050] asymmetric context init failed");
        return false;
    }

    size_t pubLen = 32;
    st = sss_asymmetric_get_pub_key(&g_se05x_asym, &g_se05x_key_obj, publicKey, &pubLen);
    if (st != kStatus_SSS_Success || pubLen != 32) {
        Serial.println("[SE050] get pub key failed");
        return false;
    }
    return true;
}

/** Аппаратная Ed25519-подпись внутри SE050 (приватный ключ не покидает чип). */
static bool se050_sign(const uint8_t *msg, size_t msgLen, uint8_t signature[64]) {
    size_t sigLen = 64;
    sss_status_t st = sss_asymmetric_sign(&g_se05x_asym, msg, msgLen, signature, &sigLen);
    return (st == kStatus_SSS_Success && sigLen == 64);
}

/** Инициализация SE050-пути: сессия + ключ + публичный ключ. */
static bool identity_init_se050(uint8_t publicKey[32]) {
    if (!se050_open()) return false;
    if (!se050_load_or_create_key(publicKey)) return false;
    g_se050_ready = true;
    return true;
}
#endif // ENRG_USE_SE050

// Генерирует Ed25519-ключ при первой загрузке и сохраняет seed в NVS
// (или ATECC608A). При последующих загрузках — загружает.
bool identity_init_v3(uint8_t privateKey[32], uint8_t publicKey[32]) {
    g_prefs.begin("enrg", false);

    // 1) Пробуем Secure Element (если включён).
#if ENRG_USE_ATECC608
    if (load_seed_atecc(privateKey)) {
        Ed25519::derivePublicKey(publicKey, privateKey);
        Serial.println("[KEY] loaded from ATECC608A (secure slot)");
        return true;
    }
#endif

    // 2) Пробуем NVS.
    size_t privLen = g_prefs.getBytesLength("privkey");
    if (privLen == 32) {
        g_prefs.getBytes("privkey", privateKey, 32);
        Ed25519::derivePublicKey(publicKey, privateKey);
        Serial.println("[KEY] loaded from NVS");
        return true;
    }

    // 3) Нет ключа — генерируем.
    // Crypto 0.4.0: Ed25519::generatePrivateKey(privkey) использует внутренний RNG.
    Ed25519::generatePrivateKey(privateKey);
    Ed25519::derivePublicKey(publicKey, privateKey);

#if ENRG_USE_ATECC608
    if (store_seed_atecc(privateKey)) {
        g_prefs.remove("privkey"); // дубликат в NVS не нужен
        Serial.println("[KEY] generated and stored in ATECC608A");
        return true;
    }
    Serial.println("[WARN] ATECC608A недоступен — ключ хранится в NVS (не Secure Element).");
#else
    Serial.println("[WARN] Secure Element не включён (ENRG_USE_ATECC608=0) — ключ в NVS (flash).");
#endif

    g_prefs.putBytes("privkey", privateKey, 32);
    Serial.println("[KEY] generated and stored in NVS");
    return true;
}

// Монотонный nonce, персистентный между перезагрузками (анти-replay).
uint32_t next_nonce() {
    uint32_t n = g_prefs.getUInt("nonce", 0) + 1;
    g_prefs.putUInt("nonce", n);
    return n;
}

// ════════════════════════════════════════════════════════════════
//  БИНАРНАЯ ПОДПИСЬ (on-chain формат)
//  message = device_id(32) || nonce(8 LE) || timestamp(8 LE) || energy_wh(8 LE)
//  Совпадает с state/oracle.rs OracleReport::device_message_to_sign().
// ════════════════════════════════════════════════════════════════

static void le64_put(uint8_t *buf, uint64_t v) {
    for (int i = 0; i < 8; ++i) { buf[i] = (uint8_t)(v >> (8 * i)); }
}

void build_proof_message(uint8_t msg[56], const uint8_t pubkey[32],
                         uint32_t nonce, int64_t timestamp, uint64_t energyWh) {
    memcpy(msg, pubkey, 32);
    le64_put(msg + 32, nonce);
    le64_put(msg + 40, (uint64_t)timestamp);
    le64_put(msg + 48, energyWh);
}

// ════════════════════════════════════════════════════════════════
//  ЭНЕРГИЯ (Wh за интервал отчёта)
// ════════════════════════════════════════════════════════════════

#if ENRG_USE_PZEM
static PZEM004Tv30 g_pzem(Serial2, 16, 17); // RX=16, TX=17
static bool g_pzem_ok = false;
#endif

uint64_t read_energy_wh() {
#if ENRG_USE_PZEM
    float energy = g_pzem.energy(); // kWh
    if (isnan(energy)) {
        Serial.println("[SENSOR] PZEM error (NaN)");
        return 0;
    }
    return (uint64_t)(energy * 1000.0f); // kWh -> Wh
#else
    // Заглушка без сенсора. Подключите PZEM-004T и включите ENRG_USE_PZEM=1.
    return 1; // 1 Wh за интервал
#endif
}

// ════════════════════════════════════════════════════════════════
//  NTP (wall-clock вместо millis())
// ════════════════════════════════════════════════════════════════

void ntp_sync() {
    configTime(0, 0, ENRG_NTP_SERVER);
    Serial.printf("[NTP] syncing with %s ...\n", ENRG_NTP_SERVER);
}

bool time_is_synced() {
    time_t now = time(nullptr);
    return now > ENRG_MIN_EPOCH;
}

// ════════════════════════════════════════════════════════════════
//  WIFI
// ════════════════════════════════════════════════════════════════

bool connect_wifi(unsigned long timeoutMs) {
    if (WiFi.status() == WL_CONNECTED) return true;
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.printf("[WIFI] connecting to %s ...\n", WIFI_SSID);
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - start) < timeoutMs) {
        delay(200);
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("[WIFI] connected, IP=%s\n", WiFi.localIP().toString().c_str());
        return true;
    }
    Serial.println("[WIFI] connect FAILED");
    return false;
}

// ════════════════════════════════════════════════════════════════
//  ОТПРАВКА PROOF (http:// или https:// — выбор по схеме URL)
// ════════════════════════════════════════════════════════════════

// ── Глобальное состояние манифеста (ADR-0004) ──
// URL для отправки proof'ов: по умолчанию ENRG_ORACLE_URL (обратная
// совместимость); при валидном манифесте заменяется на manifest.oracle_url.
static String g_proof_url = ENRG_ORACLE_URL;
// Номинальная мощность устройства из манифеста (Вт); 0 — не задана.
static uint64_t g_rated_power = 0;
// true — манифест получен и подпись проверена.
static bool g_manifest_valid = false;

int send_proof_http(const String &body) {
    int code = -1;
    String resp = "";

    if (g_proof_url.startsWith("https://")) {
        // TLS с проверкой корневого CA (ENRG_CA_CERT); mTLS опционально.
        WiFiClientSecure client;
        client.setCACert(ENRG_CA_CERT); // обязательная проверка корневого CA
#if ENRG_MTLS
        client.setCertificate(ENRG_CLIENT_CERT);
        client.setPrivateKey(ENRG_CLIENT_PRIVKEY);
#endif
        HTTPClient http;
        if (!http.begin(client, g_proof_url)) {
            Serial.println("[HTTP] begin failed (https)");
            return -1;
        }
        http.addHeader("Content-Type", "application/json");
        code = http.POST(body);
        if (code > 0) resp = http.getString();
        http.end();
    } else {
        // Обычный HTTP (локальная сеть / dev): http://host:port
        WiFiClient client;
        HTTPClient http;
        if (!http.begin(client, g_proof_url)) {
            Serial.println("[HTTP] begin failed (http)");
            return -1;
        }
        http.addHeader("Content-Type", "application/json");
        code = http.POST(body);
        if (code > 0) resp = http.getString();
        http.end();
    }

    if (code == 200) {
        Serial.printf("[PROOF] sent successfully (code=%d, resp=%.120s)\n",
                      code, resp.c_str());
    } else if (code > 0) {
        Serial.printf("[HTTP] proof rejected, code=%d, resp=%.120s\n",
                      code, resp.c_str());
    } else {
        Serial.printf("[HTTP] send failed: %s\n",
                      HTTPClient::errorToString(code).c_str());
    }
    return code;
}

/**
 * Простой HTTP(S) GET (для получения Device Manifest, ADR-0004, и
 * метаданных OTA). Возвращает тело ответа (пустая строка при ошибке).
 */
String http_get(const String &url) {
    String body = "";
    int code;

    if (url.startsWith("https://")) {
        WiFiClientSecure client;
        client.setCACert(ENRG_CA_CERT); // обязательная проверка корневого CA
#if ENRG_MTLS
        client.setCertificate(ENRG_CLIENT_CERT);
        client.setPrivateKey(ENRG_CLIENT_PRIVKEY);
#endif
        HTTPClient http;
        if (!http.begin(client, url)) {
            Serial.println("[HTTP] GET begin failed (https)");
            return "";
        }
        code = http.GET();
        if (code == 200) body = http.getString();
        else Serial.printf("[HTTP] GET %s -> %d\n", url.c_str(), code);
        http.end();
    } else {
        WiFiClient client;
        HTTPClient http;
        if (!http.begin(client, url)) {
            Serial.println("[HTTP] GET begin failed (http)");
            return "";
        }
        code = http.GET();
        if (code == 200) body = http.getString();
        else Serial.printf("[HTTP] GET %s -> %d\n", url.c_str(), code);
        http.end();
    }

    return body;
}

// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
//  DEVICE MANIFEST (ADR-0004)
// ════════════════════════════════════════════════════════════════

// Парсинг hex-строки публичного ключа основателя в байты (32).
bool parse_hex(const char *hex, uint8_t *out, size_t outLen) {
    size_t len = strlen(hex);
    if (len != outLen * 2) return false;
    for (size_t i = 0; i < outLen; i++) {
        char hi = hex[i * 2], lo = hex[i * 2 + 1];
        auto nib = [](char c) -> int {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            return -1;
        };
        int h = nib(hi), l = nib(lo);
        if (h < 0 || l < 0) return false;
        out[i] = (uint8_t)((h << 4) | l);
    }
    return true;
}

/**
 * Проверка подписанного Device Manifest (ADR-0004).
 *
 * 1. Разбирает JSON.
 * 2. Проверяет привязку к ЭТОМУ устройству: device_id == свой, public_key == свой.
 * 3. Пересобирает каноническое сообщение подписи (то же, что в policy.js):
 *      device_id|rated_power|oracle_url|public_key|timestamp
 * 4. Декодирует base64-подпись и проверяет Ed25519 публичным ключом основателя
 *    (вшит в прошивку как ENRG_FOUNDER_PUBKEY_HEX).
 *
 * @param body тело ответа оракула (JSON)
 * @param deviceId собственный device_id ("0x" + hex публичного ключа)
 * @param ownPublicKey собственный Ed25519-публичный ключ (32 байта)
 * @param ratedPowerOut номинальная мощность (Вт) из манифеста
 * @param oracleUrlOut oracle_url из манифеста
 * @returns true, если манифест валиден
 */
bool verify_manifest(const String &body, const String &deviceId,
                     const uint8_t *ownPublicKey,
                     uint64_t &ratedPowerOut, String &oracleUrlOut) {
    // Публичный ключ основателя (оракула) из конфигурации.
    uint8_t founderPub[32];
    if (!parse_hex(ENRG_FOUNDER_PUBKEY_HEX, founderPub, sizeof(founderPub))) {
        Serial.println("[MANIFEST] FATAL: ENRG_FOUNDER_PUBKEY_HEX некорректен");
        return false;
    }

    DynamicJsonDocument doc(1024);
    if (deserializeJson(doc, body)) return false;

    const char *m_id = doc["device_id"];
    const char *m_rated = doc["rated_power"];
    const char *m_oracle = doc["oracle_url"];
    const char *m_pub = doc["public_key"];
    const char *m_ts = doc["timestamp"];
    const char *m_sig = doc["signature"];
    if (!m_id || !m_rated || !m_oracle || !m_pub || !m_ts || !m_sig) return false;

    // Привязка к этому устройству (манифест нельзя подменить/переадресовать).
    if (String(m_id) != deviceId) return false;
    if (String(m_pub) != base64_encode(ownPublicKey, 32)) return false;

    // Каноническое сообщение — побайтово как в policy.js::buildManifestMessage.
    String msg = String(m_id) + "|" + String(m_rated) + "|" +
                 String(m_oracle) + "|" + String(m_pub) + "|" + String(m_ts);

    uint8_t sig[64];
    if (base64_decode(String(m_sig), sig, sizeof(sig)) != 64) return false;
    if (!Ed25519::verify(sig, founderPub, (const uint8_t *)msg.c_str(), msg.length())) {
        return false;
    }

    ratedPowerOut = strtoull(m_rated, NULL, 10);
    oracleUrlOut = String(m_oracle);
    return true;
}

/** Применить валидный манифест: rated_power + oracle_url → эндпоинт proof. */
bool apply_manifest(const String &body, const String &deviceId) {
    uint64_t rp = 0;
    String ourl = "";
    if (!verify_manifest(body, deviceId, g_publicKey, rp, ourl)) return false;

    g_rated_power = rp;
    if (ourl.endsWith("/")) ourl.remove(ourl.length() - 1);
    g_proof_url = ourl + "/api/v1/proof/submit";
    g_manifest_valid = true;

    Serial.printf("[MANIFEST] OK device=%s rated_power=%lluW proof_url=%s\n",
                  deviceId.c_str(), (unsigned long long)g_rated_power, g_proof_url.c_str());
    return true;
}

/** Загрузить манифест из NVS и проверить подпись. */
bool load_manifest_from_nvs(const String &deviceId) {
    String stored = g_prefs.getString("manifest", "");
    if (stored.length() == 0) return false;
    if (!apply_manifest(stored, deviceId)) {
        Serial.println("[MANIFEST] NVS-копия невалидна — перезапросим");
        g_prefs.remove("manifest");
        return false;
    }
    return true;
}

/** Запросить манифест у оракула (GET /api/v1/manifest/<device_id>). */
String fetch_manifest_body(const String &deviceId) {
    String url = String(ENRG_MANIFEST_URL_BASE) + "/" + deviceId;
    Serial.printf("[MANIFEST] fetching %s\n", url.c_str());
    return http_get(url);
}

/** Полная инициализация манифеста при старте (setup). */
bool init_manifest(const String &deviceId) {
    // 1) Сначала NVS-копия (устройство может работать офлайн, ADR-0004).
    if (load_manifest_from_nvs(deviceId)) return true;

    // 2) Иначе — получить свежий манифест и сохранить.
    String body = fetch_manifest_body(deviceId);
    if (body.length() > 0 && apply_manifest(body, deviceId)) {
        g_prefs.putString("manifest", body);
        return true;
    }

    g_manifest_valid = false;
    if (ENRG_MANIFEST_REQUIRED) {
        Serial.println("[MANIFEST] FATAL: манифест не получен/невалиден — proof'ы заблокированы");
    } else {
        Serial.println("[MANIFEST] WARN: манифест недоступен — работаем по хардкод-конфигу (обратная совместимость)");
    }
    return false;
}


//  PROOF
// ════════════════════════════════════════════════════════════════

void send_proof(const uint8_t privateKey[32], const uint8_t publicKey[32]) {
    // ADR-0004: если манифест обязателен, но не получен/невалиден — proof'ы НЕ отправляем.
    if (ENRG_MANIFEST_REQUIRED && !g_manifest_valid) {
        Serial.println("[PROOF] пропуск: нет валидного манифеста (ENRG_MANIFEST_REQUIRED)");
        return;
    }

    if (!time_is_synced()) {
        Serial.println("[NTP] время ещё не синхронизировано — proof пропущен");
        return;
    }

    uint64_t energyWh = read_energy_wh();

    // ADR-0004: если известна номинальная мощность (rated_power из манифеста),
    // энергия одного отчёта ограничена ею (грубая защита от ложных показаний).
    if (g_rated_power > 0 && energyWh > g_rated_power) {
        Serial.printf("[PROOF] WARN: energy %lluWh > rated_power %lluW — ограничиваем\n",
                      (unsigned long long)energyWh, (unsigned long long)g_rated_power);
        energyWh = g_rated_power;
    }

    uint32_t nonce = next_nonce();
    int64_t timestamp = (int64_t)time(nullptr); // wall-clock (epoch)

    // Бинарное сообщение и подпись.
    uint8_t msg[56];
    build_proof_message(msg, publicKey, nonce, timestamp, energyWh);

    uint8_t signature[64];
#if ENRG_USE_SE050
    if (g_se050_ready) {
        // Аппаратная Ed25519-подпись внутри SE050 (приватный ключ не покидает чип).
        if (!se050_sign(msg, sizeof(msg), signature)) {
            Serial.println("[PROOF] SE050 signing failed — proof пропущен");
            return;
        }
    } else {
        Ed25519::sign(signature, privateKey, publicKey, msg, sizeof(msg));
    }
#else
    Ed25519::sign(signature, privateKey, publicKey, msg, sizeof(msg));
#endif

    String deviceId = device_id_from_pubkey(publicKey);
    String sigB64 = base64_encode(signature, sizeof(signature));

    // JSON без внешних библиотек.
    String body;
    body.reserve(256);
    body += "{\"device_id\":\"";
    body += deviceId;
    body += "\",\"timestamp\":";
    body += String(timestamp);
    body += ",\"energyWh\":";
    body += String((unsigned long long)energyWh);
    body += ",\"nonce\":";
    body += String(nonce);
    body += ",\"signature\":\"";
    body += sigB64;
    body += "\"}";

    Serial.printf("[PROOF] device=%s ts=%lld energy=%llu nonce=%u\n",
                  deviceId.c_str(), (long long)timestamp,
                  (unsigned long long)energyWh, nonce);

    if (WiFi.status() != WL_CONNECTED) {
        if (!connect_wifi(20000)) return;
    }
    send_proof_http(body);
}

// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
//  OTA-ОБНОВЛЕНИЯ ПРОШИВКИ (ADR-0008)
// ════════════════════════════════════════════════════════════════

/**
 * Сравнение версий "a.b.c..." (числовое, по компонентам).
 * Возвращает >0 если a > b, <0 если a < b, 0 если равны.
 */
int compare_versions(const String &a, const String &b) {
    int pa = 0, pb = 0;
    while (pa < a.length() || pb < b.length()) {
        long na = 0, nb = 0;
        while (pa < a.length() && a[pa] != '.') { na = na * 10 + (a[pa] - '0'); pa++; }
        while (pb < b.length() && b[pb] != '.') { nb = nb * 10 + (b[pb] - '0'); pb++; }
        if (na != nb) return na < nb ? -1 : 1;
        pa++; pb++;
    }
    return 0;
}

/**
 * Проверка подписи firmware-метаданных (ADR-0008).
 * Каноническое сообщение — `version|image_hash|image_size` (то же, что в
 * policy.js::buildFirmwareMessage). Публичный ключ вшит в прошивку
 * (ENRG_FIRMWARE_PUBKEY_HEX — ОТДЕЛЬНЫЙ «холодный» firmware-ключ, D-5;
 * НЕ founder-ключ, который используется для манифестов).
 */
bool verify_firmware_signature(const String &version, const String &hashHex,
                               long imageSize, const String &sigB64) {
    uint8_t fwPub[32];
    if (!parse_hex(ENRG_FIRMWARE_PUBKEY_HEX, fwPub, sizeof(fwPub))) {
        Serial.println("[OTA] FATAL: ENRG_FIRMWARE_PUBKEY_HEX некорректен");
        return false;
    }
    String msg = version + "|" + hashHex + "|" + String(imageSize);
    uint8_t sig[64];
    if (base64_decode(sigB64, sig, sizeof(sig)) != 64) return false;
    return Ed25519::verify(sig, fwPub, (const uint8_t *)msg.c_str(), msg.length());
}

#if ENRG_ENABLE_HW_ANTI_ROLLBACK
// ════════════════════════════════════════════════════════════════
//  DUAL-BANK OTA + АППАРАТНЫЙ MONOTONIC-СЧЁТЧИК (ADR-0008)
//
//  Dual-bank A/B: otadata + app0/app1 (partitions_ota.csv). Новый образ
//  стартует как «pending»; если приложение НЕ подтвердило себя
//  (esp_ota_mark_app_valid_cancel_rollback не вызван или вызван
//  esp_ota_mark_app_invalid) — бутлоадер автоматически откатывается
//  к предыдущему образу при следующей перезагрузке.
//  Monotonic: secure_version «сжигается» в eFuse (значение может только
//  расти); бутлоадер (CONFIG_BOOTLOADER_EFUSE_SECURE_VERSION=y) отказывает
//  в запуске образов со СТАРШЕЙ secure_version — аппаратный анти-откат,
//  в отличие от NVS fw_version, который можно перезаписать физическим доступом.
// ════════════════════════════════════════════════════════════════

/** "1.2.3" → 1*10000 + 2*100 + 3 (монотонно растёт с версией). */
static uint32_t fw_version_number(const char *v) {
    uint32_t maj = 0, min = 0, pat = 0;
    int p = 0;
    while (v[p] && v[p] != '.') { maj = maj * 10 + (uint32_t)(v[p] - '0'); p++; }
    if (v[p] == '.') p++;
    while (v[p] && v[p] != '.') { min = min * 10 + (uint32_t)(v[p] - '0'); p++; }
    if (v[p] == '.') p++;
    while (v[p] >= '0' && v[p] <= '9') { pat = pat * 10 + (uint32_t)(v[p] - '0'); p++; }
    return maj * 10000 + min * 100 + pat;
}

/** Подтвердить текущий образ (отменяет автоматический rollback). */
static void ota_mark_boot_ok() {
    esp_err_t e = esp_ota_mark_app_valid_cancel_rollback();
    Serial.printf("[OTA] mark_app_valid_cancel_rollback: %s\n", esp_err_to_name(e));
}

/** Сжечь secure_version в eFuse (только увеличение) — аппаратный анти-откат. */
static void ota_mark_hardware_anti_rollback() {
    uint32_t ver = fw_version_number(ENRG_FW_VERSION);
    esp_err_t e = esp_efuse_update_secure_version(ver);
    Serial.printf("[OTA] eFuse secure_version -> %lu (%s)\n",
                  (unsigned long)ver, esp_err_to_name(e));
}

/** Пометить текущий образ невалидным и перезагрузиться → rollback на предыдущий. */
static void ota_mark_app_invalid() {
    // В текущей IDF: esp_ota_mark_app_invalid_rollback_and_reboot() сама
    // выполняет перезагрузку. ESP.restart() ниже — страховка.
    esp_err_t e = esp_ota_mark_app_invalid_rollback_and_reboot();
    Serial.printf("[OTA] mark_app_invalid_rollback_and_reboot: %s — rollback...\n",
                  esp_err_to_name(e));
    ESP.restart();
}
#endif // ENRG_ENABLE_HW_ANTI_ROLLBACK


//  SETUP / LOOP
// ════════════════════════════════════════════════════════════════

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n[BOOT] ENRG Proof Sender v3 (secure)");

    // H-3: генерация ключа при первой загрузке / загрузка из NVS/ATECC608.
    // Приоритет хранилища (ADR-0001): NXP SE050 (аппаратная Ed25519) →
    // ATECC608A (seed-vault) → NVS.
#if ENRG_USE_SE050
    if (identity_init_se050(g_publicKey)) {
        Serial.println("[KEY] хранилище: NXP SE050 (аппаратная Ed25519-подпись)");
        g_key_in_secure_element = true;
        // Приватный ключ не покидает SE050 — seed в RAM не нужен.
        memset(g_privateKey, 0, sizeof(g_privateKey));
    } else {
        Serial.println("[SE050] чип недоступен — fallback на ATECC/NVS");
        if (!identity_init_v3(g_privateKey, g_publicKey)) {
            Serial.println("[FATAL] key init failed");
#if ENRG_ENABLE_HW_ANTI_ROLLBACK
            ota_mark_app_invalid(); // A/B rollback на предыдущий образ
#else
            while (true) { delay(1000); }
#endif
        }
    }
#else
    if (!identity_init_v3(g_privateKey, g_publicKey)) {
        Serial.println("[FATAL] key init failed");
#if ENRG_ENABLE_HW_ANTI_ROLLBACK
        ota_mark_app_invalid(); // A/B rollback на предыдущий образ
#else
        while (true) { delay(1000); }
#endif
    }
#endif
    if (g_key_in_secure_element) {
        Serial.println("[KEY] хранилище: Secure Element (ATECC608A / SE050)");
    } else {
        Serial.println("[KEY] хранилище: NVS (не Secure Element) — см. ENRG_USE_ATECC608");
    }
    Serial.printf("[KEY] device_id = %s\n", device_id_from_pubkey(g_publicKey).c_str());

#if ENRG_USE_PZEM
    g_pzem_ok = true;
#endif

    // ADR-0008: LittleFS — staging-область для OTA-образа.
    if (!LittleFS.begin()) {
        Serial.println("[OTA] WARN: LittleFS не смонтирован — OTA недоступен");
    }

    if (!connect_wifi(30000)) {
        Serial.println("[WARN] WiFi не подключён — жду в loop");
    }

    // ADR-0004: получаем и проверяем подписанный манифест при старте.
    // device_id = "0x" + hex публичного ключа (как при регистрации в оракуле).
    String deviceId = device_id_from_pubkey(g_publicKey);
    init_manifest(deviceId);

    // ADR-0008: текущая версия прошивки (из NVS или дефолт) — для анти-отката.
    if (g_prefs.getString("fw_version", "").length() == 0) {
        g_prefs.putString("fw_version", ENRG_FW_VERSION);
    }
    Serial.printf("[OTA] текущая версия: %s\n", g_prefs.getString("fw_version", ENRG_FW_VERSION).c_str());

#if ENRG_ENABLE_HW_ANTI_ROLLBACK
    // ADR-0008: A/B rollback — подтверждаем текущий образ ПОСЛЕ успешного
    // старта (ключ, WiFi, манифест, версия) и сжигаем monotonic secure_version.
    ota_mark_boot_ok();
    ota_mark_hardware_anti_rollback();
#endif

    // Первая проверка обновления сразу после старта (не ждём ENRG_UPDATE_CHECK_MS).
    checkForUpdates();

    ntp_sync();
    g_lastReportMs = millis();
}

void loop() {
    // ADR-0008: периодическая проверка обновлений прошивки.
    static unsigned long g_lastUpdateCheckMs = 0;
    unsigned long nowMs = millis();
    if (nowMs - g_lastUpdateCheckMs >= ENRG_UPDATE_CHECK_MS) {
        g_lastUpdateCheckMs = nowMs;
        checkForUpdates(); // внутри — ESP.restart() при успешной установке
    }

    // ADR-0004: если манифест обязателен, но ещё не получен — периодически
    // повторяем запрос (иначе устройство никогда не выйдет из блокировки).
    if (ENRG_MANIFEST_REQUIRED && !g_manifest_valid) {
        static unsigned long lastAttemptMs = 0;
        unsigned long nowMs = millis();
        if (nowMs - lastAttemptMs >= ENRG_MANIFEST_RETRY_MS) {
            lastAttemptMs = nowMs;
            String deviceId = device_id_from_pubkey(g_publicKey);
            if (!load_manifest_from_nvs(deviceId)) {
                String body = fetch_manifest_body(deviceId);
                if (body.length() > 0 && apply_manifest(body, deviceId)) {
                    g_prefs.putString("manifest", body);
                }
            }
        }
    }

    unsigned long now = millis();
    if (now - g_lastReportMs >= ENRG_REPORT_INTERVAL_MS) {
        g_lastReportMs = now;
        send_proof(g_privateKey, g_publicKey);
    }
    delay(10);
}

/**
 * Скачивание образа в LittleFS (/fw_update.bin) с параллельным вычислением
 * SHA-256. Возвращает true, если размер и хеш совпали с метаданными.
 */
bool download_firmware(const String &url, long expectedSize, const String &expectedHashHex) {
    // Транспорт по схеме URL: https:// → TLS (WiFiClientSecure + проверка CA),
    // http:// → обычный TCP (локальная dev-сеть, порт 3000).
    WiFiClientSecure secureClient;
    WiFiClient plainClient;
    WiFiClient *client;
    if (url.startsWith("https://")) {
        secureClient.setCACert(ENRG_CA_CERT);
        client = &secureClient;
    } else {
        client = &plainClient;
    }

    HTTPClient http;
    if (!http.begin(*client, url)) { Serial.println("[OTA] GET begin failed"); return false; }
    int code = http.GET();
    if (code != 200) {
        Serial.printf("[OTA] GET %s -> %d\n", url.c_str(), code);
        http.end();
        return false;
    }
    int len = http.getSize();
    if (len <= 0 || len > (int)ENRG_MAX_FW_SIZE) {
        Serial.printf("[OTA] bad size: %d\n", len);
        http.end();
        return false;
    }

    LittleFS.remove("/fw_update.bin");
    File out = LittleFS.open("/fw_update.bin", "w");
    if (!out) { http.end(); return false; }

    WiFiClient *stream = http.getStreamPtr();
    SHA256 sha;
    sha.reset();
    uint8_t buf[512];
    size_t total = 0;
    while (http.connected() && total < (size_t)len) {
        size_t n = stream->readBytes(buf, sizeof(buf));
        if (n == 0) break;
        sha.update(buf, n);
        out.write(buf, n);
        total += n;
    }
    out.close();
    http.end();

    if (total != (size_t)len) {
        Serial.printf("[OTA] size mismatch: %u != %d\n", total, len);
        LittleFS.remove("/fw_update.bin");
        return false;
    }

    uint8_t digest[32];
    sha.finalize(digest, sizeof(digest));
    char hex[65];
    for (int i = 0; i < 32; i++) snprintf(hex + i * 2, 3, "%02x", digest[i]);
    hex[64] = 0;

    if (String(hex) != expectedHashHex) {
        Serial.printf("[OTA] SHA-256 mismatch: got %s\n", hex);
        LittleFS.remove("/fw_update.bin");
        return false;
    }
    Serial.printf("[OTA] downloaded %u bytes, SHA-256 OK\n", total);
    return true;
}



/**
 * Применение образа через ESP32 OTA (Update). Файл уже проверен
 * (подпись + SHA-256). После успешной установки вызывающий делает ESP.restart().
 */
bool apply_firmware_update(const char *path) {
    File f = LittleFS.open(path, "r");
    if (!f) { Serial.println("[OTA] staging file missing"); return false; }
    if (!Update.begin(f.size())) {
        Update.printError(Serial);
        f.close();
        return false;
    }
    size_t written = Update.writeStream(f);
    if (written != f.size()) {
        Update.printError(Serial);
        f.close();
        return false;
    }
    if (!Update.end()) {
        Update.printError(Serial);
        f.close();
        return false;
    }
    f.close();
    LittleFS.remove(path);
    Serial.println("[OTA] Update.end() OK — образ установлен, перезагрузка...");
    return true;
}

/**
 * Полный цикл проверки обновления (вызывается периодически):
 *   1. GET {ENRG_FIRMWARE_URL_BASE}/latest → метаданные (version, hash, size, signature).
 *   2. Анти-откат: version должна быть строго выше текущей (из NVS).
 *   3. Проверка подписи метаданных ключом основателя.
 *   4. Скачивание образа + проверка SHA-256.
 *   5. Применение (Update) + запись новой версии в NVS + перезагрузка.
 */
bool checkForUpdates() {
    String url = String(ENRG_FIRMWARE_URL_BASE) + "/latest";
    String body = http_get(url);
    if (body.length() == 0) { Serial.println("[OTA] оракул не ответил"); return false; }

    DynamicJsonDocument doc(1024);
    if (deserializeJson(doc, body)) { Serial.println("[OTA] невалидный JSON"); return false; }

    const char *v = doc["version"];
    const char *hash = doc["image_hash"];
    long size = doc["image_size"];
    const char *sig = doc["signature"];
    const char *model = doc["model"];
    if (!v || !hash || size <= 0 || !sig) { Serial.println("[OTA] неполные метаданные"); return false; }

    if (model && strlen(model) > 0 && String(model) != String(ENRG_FW_MODEL)) {
        Serial.printf("[OTA] модель %s != %s — пропуск\n", model, ENRG_FW_MODEL);
        return false;
    }

    // Анти-откат: принимаем только строго более новую версию.
    String current = g_prefs.getString("fw_version", ENRG_FW_VERSION);
    if (compare_versions(String(v), current) <= 0) {
        Serial.printf("[OTA] версия %s <= текущая %s — пропуск (анти-откат)\n", v, current.c_str());
        return false;
    }

    // Подпись метаданных (без скачивания) — отклоняем неподписанные/чужие образы.
    if (!verify_firmware_signature(String(v), String(hash), size, String(sig))) {
        Serial.println("[OTA] невалидная подпись — образ отклонён");
        return false;
    }

    // Скачивание + проверка SHA-256.
    String imgUrl = String(ENRG_FIRMWARE_URL_BASE) + "/latest/image";
    if (!download_firmware(imgUrl, size, String(hash))) {
        Serial.println("[OTA] скачивание/хеш не сошёлся — образ отклонён");
        return false;
    }

    // Применение.
    if (!apply_firmware_update("/fw_update.bin")) {
        Serial.println("[OTA] установка не удалась");
        return false;
    }

    g_prefs.putString("fw_version", String(v)); // новая версия (анти-откат после перезагрузки)
    Serial.printf("[OTA] обновление до %s применено, перезагрузка...\n", v);
    ESP.restart();
    return true;
}


#endif
