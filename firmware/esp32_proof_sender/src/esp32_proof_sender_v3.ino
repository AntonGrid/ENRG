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
 *      (seed не лежит в открытом NVS). Полная аппаратная подпись Ed25519
 *      требует чипа с поддержкой ed25519 (например, NXP SE050) — TODO.
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

// HTTPS-эндпоинт оракула (обязательно https://, см. ENRG_CA_CERT).
// Используется по умолчанию (обратная совместимость). Если получен валидный
// Device Manifest (ADR-0004), реальный URL берётся из manifest.oracle_url.
#ifndef ENRG_ORACLE_URL
#define ENRG_ORACLE_URL "https://oracle.example.com/api/v1/proof/submit"
#endif

// ── Device Manifest (ADR-0004) ──
// База URL эндпоинта манифестов: к ней добавляется "/<device_id>".
#ifndef ENRG_MANIFEST_URL_BASE
#define ENRG_MANIFEST_URL_BASE "https://oracle.example.com/api/v1/manifest"
#endif

// Публичный ключ ОРАКУЛА (основателя, Ed25519, 32 байта) — вшивается в прошивку.
// Манифесты подписываются этим ключом на стороне оракула (FOUNDER_KEY);
// устройство проверяет подпись ДО использования манифеста.
// ЗАПОЛНИТЕ реальным ключом перед прошивкой (32 hex-байта, без "0x").
#ifndef ENRG_FOUNDER_PUBKEY_HEX
#define ENRG_FOUNDER_PUBKEY_HEX "0000000000000000000000000000000000000000000000000000000000000000"
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
#include <Crypto.h>
#include <Ed25519.h>

#if ENRG_USE_PZEM
#include <PZEM004Tv30.h>
#endif

#if ENRG_USE_ATECC608
#include <cryptoauthlib.h>
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
//  HTTPS-ОТПРАВКА PROOF (проверка сертификата; mTLS опционально)
// ════════════════════════════════════════════════════════════════

// ── Глобальное состояние манифеста (ADR-0004) ──
// URL для отправки proof'ов: по умолчанию ENRG_ORACLE_URL (обратная
// совместимость); при валидном манифесте заменяется на manifest.oracle_url.
static String g_proof_url = ENRG_ORACLE_URL;
// Номинальная мощность устройства из манифеста (Вт); 0 — не задана.
static uint64_t g_rated_power = 0;
// true — манифест получен и подпись проверена.
static bool g_manifest_valid = false;

int send_proof_https(const String &body) {
    WiFiClientSecure client;
    client.setCACert(ENRG_CA_CERT); // обязательная проверка корневого CA
#if ENRG_MTLS
    client.setCertificate(ENRG_CLIENT_CERT);
    client.setPrivateKey(ENRG_CLIENT_PRIVKEY);
#endif

    HTTPClient http;
    if (!http.begin(client, g_proof_url)) {
        Serial.println("[HTTP] begin failed (недоступен https)");
        return -1;
    }
    http.addHeader("Content-Type", "application/json");
    int code = http.POST(body);
    if (code > 0) {
        Serial.printf("[HTTP] proof sent, code=%d, resp=%s\n", code,
                      http.getString().c_str());
    } else {
        Serial.printf("[HTTP] send failed: %s\n", http.errorToString(code).c_str());
    }
    http.end();
    return code;
}

/**
 * Простой HTTPS GET (для получения Device Manifest, ADR-0004).
 * Возвращает тело ответа (пустая строка при ошибке).
 */
String http_get(const String &url) {
    WiFiClientSecure client;
    client.setCACert(ENRG_CA_CERT); // обязательная проверка корневого CA
#if ENRG_MTLS
    client.setCertificate(ENRG_CLIENT_CERT);
    client.setPrivateKey(ENRG_CLIENT_PRIVKEY);
#endif

    HTTPClient http;
    if (!http.begin(client, url)) {
        Serial.println("[HTTP] GET begin failed");
        return "";
    }
    int code = http.GET();
    String body = "";
    if (code == 200) {
        body = http.getString();
    } else {
        Serial.printf("[HTTP] GET %s -> %d\n", url.c_str(), code);
    }
    http.end();
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
    Ed25519::sign(signature, privateKey, publicKey, msg, sizeof(msg));

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
    send_proof_https(body);
}

// ════════════════════════════════════════════════════════════════
//  SETUP / LOOP
// ════════════════════════════════════════════════════════════════

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n[BOOT] ENRG Proof Sender v3 (secure)");

    // H-3: генерация ключа при первой загрузке / загрузка из NVS/ATECC608.
    if (!identity_init_v3(g_privateKey, g_publicKey)) {
        Serial.println("[FATAL] key init failed");
        while (true) { delay(1000); }
    }
    if (g_key_in_secure_element) {
        Serial.println("[KEY] хранилище: ATECC608A (Secure Element)");
    } else {
        Serial.println("[KEY] хранилище: NVS (не Secure Element) — см. ENRG_USE_ATECC608");
    }
    Serial.printf("[KEY] device_id = %s\n", device_id_from_pubkey(g_publicKey).c_str());

#if ENRG_USE_PZEM
    g_pzem_ok = true;
#endif

    if (!connect_wifi(30000)) {
        Serial.println("[WARN] WiFi не подключён — жду в loop");
    }

    // ADR-0004: получаем и проверяем подписанный манифест при старте.
    // device_id = "0x" + hex публичного ключа (как при регистрации в оракуле).
    String deviceId = device_id_from_pubkey(g_publicKey);
    init_manifest(deviceId);

    ntp_sync();
    g_lastReportMs = millis();
}

void loop() {
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
#endif
