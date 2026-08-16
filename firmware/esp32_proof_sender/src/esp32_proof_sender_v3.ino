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
#ifndef ENRG_ORACLE_URL
#define ENRG_ORACLE_URL "https://oracle.example.com/api/v1/proof/submit"
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
#include <Crypto.h>
#include <Ed25519.h>

#if ENRG_USE_PZEM
#include <PZEM004Tv30.h>
#endif

#if ENRG_USE_ATECC608
#include <cryptoauthlib.h>
#endif

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
        out += (i + 1 < len) ? BASE64_CHARS[(b >> 6) & 0x3F] : '=';
        out += (i + 2 < len) ? BASE64_CHARS[b & 0x3F] : '=';
    }
    return out;
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

int send_proof_https(const String &body) {
    WiFiClientSecure client;
    client.setCACert(ENRG_CA_CERT); // обязательная проверка корневого CA
#if ENRG_MTLS
    client.setCertificate(ENRG_CLIENT_CERT);
    client.setPrivateKey(ENRG_CLIENT_PRIVKEY);
#endif

    HTTPClient http;
    if (!http.begin(client, ENRG_ORACLE_URL)) {
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

// ════════════════════════════════════════════════════════════════
//  PROOF
// ════════════════════════════════════════════════════════════════

void send_proof(const uint8_t privateKey[32], const uint8_t publicKey[32]) {
    if (!time_is_synced()) {
        Serial.println("[NTP] время ещё не синхронизировано — proof пропущен");
        return;
    }

    uint64_t energyWh = read_energy_wh();
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

static uint8_t g_privateKey[32];
static uint8_t g_publicKey[32];
static unsigned long g_lastReportMs = 0;

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
    ntp_sync();
    g_lastReportMs = millis();
}

void loop() {
    unsigned long now = millis();
    if (now - g_lastReportMs >= ENRG_REPORT_INTERVAL_MS) {
        g_lastReportMs = now;
        send_proof(g_privateKey, g_publicKey);
    }
    delay(10);
}
#endif
