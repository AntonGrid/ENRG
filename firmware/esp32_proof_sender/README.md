# ENRG Protocol — ESP32 Proof Sender

Arduino sketch for ESP32 that reads energy data from a PZEM-004T sensor, signs it with Ed25519, and sends it to the oracle server.

## Requirements
- ESP32 DevKit V1
- PZEM-004T sensor
- SSD1306 OLED display (optional)
- Arduino libraries: PZEM004Tv30, Adafruit SSD1306, Adafruit GFX, Crypto (Ed25519), base64 (built-in)

## Setup
1. Replace `ssid`, `password`, and `oracleUrl` with your values in the sketch
2. Upload to ESP32 using Arduino IDE
3. Open Serial Monitor (115200 baud) to see logs

## Key Management
- Uses Ed25519 key pair generated on first boot
- Public key is printed to Serial Monitor
- Register this public key in the oracle's `devices.json`

## Operation
- Reads power (W) and energy (Wh) from PZEM-004T every 5 seconds
- Signs `device_id|timestamp|energyWh|nonce` with Ed25519
- Sends proof to oracle endpoint
- OLED displays voltage, current, power, energy, and nonce
