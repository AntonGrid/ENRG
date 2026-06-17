#include <WiFi.h>
#include <HTTPClient.h>
#include <PZEM004Tv30.h>
#include <Wire.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_GFX.h>
#include <ArduinoNRF-Crypto.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* oracleUrl = "http://YOUR_ORACLE_IP:3000/api/v1/proof/submit";

#define RX2 16
#define TX2 17
PZEM004Tv30 pzem(Serial2, RX2, TX2);

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_ADDR 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

static const uint8_t private_key[32] = {
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
    0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
    0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20
};

static const uint8_t public_key[32] = {
    0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0c, 0xb7,
    0xd3, 0x13, 0x33, 0xc1, 0x94, 0x37, 0x1f, 0xab,
    0x5b, 0xc3, 0xf6, 0xc9, 0xd1, 0xb4, 0x3e, 0x8f,
    0x9a, 0xdf, 0x0b, 0x6e, 0x3c, 0xc7, 0x21, 0x3f
};

unsigned long nonce = 0;
const char* device_id = "device-001";

String signPacketReal(const String &message) {
    uint8_t signature[64];
    Ed25519::sign(signature, private_key, public_key, (const uint8_t*)message.c_str(), message.length());
    return base64::encode(signature, sizeof(signature));
}

void sendProof(const String &payload) {
    if (WiFi.status() == WL_CONNECTED) {
        HTTPClient http;
        http.begin(oracleUrl);
        http.addHeader("Content-Type", "application/json");
        int httpCode = http.POST(payload);
        if (httpCode > 0) {
            String resp = http.getString();
            Serial.printf("Sent proof, code=%d resp=%s\n", httpCode, resp.c_str());
        } else {
            Serial.printf("Error sending proof: %s\n", http.errorToString(httpCode).c_str());
        }
        http.end();
    } else {
        Serial.println("WiFi not connected");
    }
}

void setup() {
    Serial.begin(115200);
    Serial2.begin(9600);
    Wire.begin(21, 22);

    if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
        Serial.println("SSD1306 not found!");
    }
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("Starting...");
    display.display();

    WiFi.begin(ssid, password);
    display.print("WiFi...");
    display.display();
    Serial.print("Connecting WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\nWiFi connected");
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println("WiFi OK");
    display.println("Ready");
    display.display();
}

void loop() {
    float voltage = pzem.voltage();
    float current = pzem.current();
    float power = pzem.power();
    float energy = pzem.energy();

    if (isnan(voltage) || isnan(current) || isnan(power) || isnan(energy)) {
        Serial.println("Sensor error");
        delay(5000);
        return;
    }

    unsigned long timestamp = millis() / 1000ULL;
    unsigned long long energyWh = (unsigned long long)(energy * 1000.0);
    nonce++;

    display.clearDisplay();
    display.setCursor(0, 0);
    display.printf("V:%.0f C:%.2f\n", voltage, current);
    display.printf("P:%.0f E:%.3f\n", power, energy);
    display.printf("N:%lu\n", nonce);
    display.display();

    String message = String(device_id) + "|" + String(timestamp) + "|" + String((unsigned long)energyWh) + "|" + String(nonce);

    String signature_b64 = signPacketReal(message);
    if (signature_b64.length() == 0) {
        delay(5000);
        return;
    }

    String json = "{";
    json += "\"device_id\":\"" + String(device_id) + "\",";
    json += "\"timestamp\":" + String(timestamp) + ",";
    json += "\"energyWh\":" + String((unsigned long)energyWh) + ",";
    json += "\"nonce\":" + String(nonce) + ",";
    json += "\"signature\":\"" + signature_b64 + "\"";
    json += "}";

    Serial.println("Sending proof: ");
    Serial.println(json);
    sendProof(json);

    delay(5000);
}
