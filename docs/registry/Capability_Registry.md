# ENRG Capability Registry

## Status

Normative

---

# Overview

This registry defines standardized protocol capabilities supported by ENRG Devices.

Capabilities describe what a Device is able to do.

Capability identifiers SHALL be globally unique within the ENRG Protocol.

---

# Energy Production

| Capability ID | Description |
|--------------|-------------|
| ENERGY_SOLAR | Solar energy production |
| ENERGY_WIND | Wind energy production |
| ENERGY_HYDRO | Hydroelectric energy production |
| ENERGY_GEOTHERMAL | Geothermal energy production |
| ENERGY_BIOMASS | Biomass energy production |
| ENERGY_NUCLEAR | Nuclear energy production |

---

# Energy Storage

| Capability ID | Description |
|--------------|-------------|
| STORAGE_BATTERY | Battery energy storage |
| STORAGE_HYDROGEN | Hydrogen energy storage |
| STORAGE_THERMAL | Thermal energy storage |

---

# Metering

| Capability ID | Description |
|--------------|-------------|
| METER_IMPORT | Imported energy measurement |
| METER_EXPORT | Exported energy measurement |
| METER_BIDIRECTIONAL | Bidirectional metering |

---

# Environmental Sensors

| Capability ID | Description |
|--------------|-------------|
| SENSOR_TEMPERATURE | Temperature sensor |
| SENSOR_HUMIDITY | Humidity sensor |
| SENSOR_PRESSURE | Pressure sensor |
| SENSOR_IRRADIANCE | Solar irradiance sensor |
| SENSOR_WIND_SPEED | Wind speed sensor |

---

# Connectivity

| Capability ID | Description |
|--------------|-------------|
| WIFI | Wi-Fi connectivity |
| ETHERNET | Ethernet connectivity |
| LORA | LoRa connectivity |
| LTE | Cellular LTE connectivity |
| SATELLITE | Satellite connectivity |

---

# Security

| Capability ID | Description |
|--------------|-------------|
| SECURE_ELEMENT | Hardware Secure Element |
| TPM | Trusted Platform Module |
| SECURE_BOOT | Secure Boot |
| REMOTE_ATTESTATION | Remote Attestation |

---

# Firmware

| Capability ID | Description |
|--------------|-------------|
| OTA_UPDATE | Over-the-Air firmware updates |
| VERSION_REPORTING | Firmware version reporting |

---

# Registration Rules

New capabilities SHALL be registered only through Protocol Governance.

Existing Capability IDs SHALL NOT be modified.

Deprecated Capability IDs SHALL remain reserved indefinitely.
