# ENRG — Аппаратная подпись устройства: SE050 и документированный компромисс

**Дата:** 2026-08-17
**Связанные ADR:** ADR-0001 (ключ никогда не покидает устройство), ADR-0007 (§4 — Secure Element), ADR-0004 (манифест), ADR-0008 (OTA)
**Файлы:** `src/esp32_proof_sender_v3.ino`, `platformio.ini`

---

## 1. Текущее состояние (документированный компромисс)

| Аспект | Реализация | Оценка ADR-0001/0007 |
|---|---|---|
| Генерация ключа | На устройстве при первой загрузке (seed из CSPRNG) | ✅ |
| Хранилище seed | **NVS** (flash, tier `basic`) **или** Data-Zone слот **ATECC608A** (`ENRG_USE_ATECC608=1`, tier `hardware-aided`) | ⚠️ Частично |
| Подпись Ed25519 | **В CPU** (rweather Crypto `Ed25519::sign`) | ⚠️ Частично |
| Аппаратная подпись Ed25519 | **NXP SE050** (tier `conforming`) — добавлен путь `ENRG_USE_SE050=1` (env `esp32dev-se050`), требует чипа и библиотеки `se050` | ✅ Полное (при наличии чипа) |

> **ATECC608A не поддерживает Ed25519** — чип используется как защищённый
> Data-Zone slot для seed (секрет не лежит в открытом NVS), но сама подпись
> выполняется в CPU. Это **документированный компромисс** MVP.

**Trust tiers (ADR-0007):** `basic` = key in NVS/flash (dev/education, NOT for
production); `hardware-aided` = seed in a Secure Element slot, CPU signing
(ATECC608A — key material appears in RAM); `conforming` = key inside the Secure
Element with on-chip Ed25519 signing (SE050). Mainnet requires `conforming`;
`hardware-aided` only with a documented risk assessment and a governance
decision.

### Остаточные риски компромисса (NVS / CPU-подпись)

1. **Физический доступ к устройству** — NVS читается через JTAG / dump flash
   (при отсутствии flash-encryption и отключённом JTAG). Митигация:
   - включить **flash-encryption** (eFuse `FLASH_CRYPT_CNT`), что делает
     содержимое NVS нечитаемым без ключа шифрования;
   - включить **secure boot v2** (eFuse `SECURE_BOOT_EN`), блокируя замену
     прошивки без валидной подписи;
   - **запретить JTAG** (eFuse `DIS_USB_JTAG`, `DIS_TDI/TDO/TMS/TCK`);
   - на время жизненного цикла: seed в ATECC608A (а не NVS).
2. **Подпись в CPU** — приватный ключ загружается в RAM на время подписи;
   риск для ОС-компрометации ниже для однозадачной прошивки, но полностью
   не исключён. Митигация — SE050.

---

## 2. NXP SE050 — полная аппаратная подпись (ADR-0001)

**SE050 поддерживает Ed25519 нативно.** Приватный ключ генерируется и
подписывает ВНУТРИ чипа (Common Criteria EAL6+); секрет не появляется ни в
NVS, ни в RAM, ни на шине I2C (при использовании SCP03).

### Что добавлено в код

- **Конфиг:** `ENRG_USE_SE050`, `ENRG_SE050_KEY_ID` (0x00000011),
  `ENRG_SE050_I2C_ADDR` (0x48).
- **Функции** (за `#if ENRG_USE_SE050`, не влияют на базовую сборку):
  - `se050_open()` — I2C-подключение + сессия + key store (SSS API);
  - `se050_load_or_create_key()` — загрузка существующего Ed25519-ключа из
    чипа или генерация нового ПРЯМО В SE050; публичный ключ получается из
    чипа (device_id стабилен между загрузками);
  - `se050_sign()` — аппаратная Ed25519-подпись;
  - `identity_init_se050()` — точка входа в `setup()`.
- **`setup()`:** приоритет SE050 → ATECC608A → NVS; при недоступности SE050 —
  автоматический fallback.
- **`send_proof()`:** если SE050 готов — аппаратная подпись, иначе CPU.
- **PlatformIO env `esp32dev-se050`** (`lib_deps = se050`, `-D ENRG_USE_SE050=1`).

> ⚠️ **Статус кода:** reference implementation. Путь требует платы с SE050
> и библиотеки `se050`; не входит в базовую сборку (`esp32dev`). При bring-up
> сверьте имена SSS-функций с версией библиотеки (SSS API стабилен, но
> возможны различия мажорных версий).

### Bring-up (чек-лист)

```bash
cd firmware/esp32_proof_sender
# 1. Подключите SE050 к I2C (SDA=21, SCL=22 по умолчанию) + VCC/GND.
# 2. Убедитесь, что PlatformIO скачал библиотеку se050:
pio pkg install se050   # при необходимости
# 3. Соберите SE050-окружение:
pio run -e esp32dev-se050
# 4. Прошейте и проверьте Serial: "[KEY] хранилище: NXP SE050 ..."
```

### Проверка после bring-up

- `device_id` должен быть **стабилен** между перезагрузками (публичный ключ
  из SE050), но **отличаться** от seed в NVS/ATECC (новый ключ устройства).
- Подпись proof'а верифицируется on-chain (`mint_energy` Ed25519-precompile)
  и оракулом (`policy.verifyDeviceSignature`).
- Приватный ключ НЕ печатается в Serial и не появляется в NVS
  (проверьте: `g_prefs.getBytesLength("privkey") == 0`).

---

## 3. Рекомендации для мейннета (в дополнение к SE050)

1. **eFuse-конфигурация при производстве:**
   - `SECURE_BOOT_EN=1` + подпись bootloader/app ключом secure-boot;
   - `FLASH_CRYPT_EN=1` (flash-encryption);
   - `DIS_USB_JTAG=1`, отключить JTAG-выводы;
   - `VDD_SPI_BYPASS=0`.
   Порядок прожига eFuse задокументирован в Espressif Secure Boot v2.
2. **SE050 + SCP03**: настроить Applet-конфигурацию SE050 (policy/auth key)
   для защищённого I2C-канала; отключить дефолтные тестовые ключи.
3. **Холодный firmware-signing ключ** (ADR-0008) — отдельный ключ от founder
   (см. P0-блокер №4).
4. **Root-of-trust**: manufacturer CA / root-key registry для аттестации
   SE050 (сертификат X.509 чипа + verify на оракуле) — ADR-0007 §6.

---

## 4. Связанные документы

- `docs/architecture/adr/ADR-0001-key-never-leaves-device.md`
- `docs/architecture/adr/ADR-0007-Security-Key-Management.md`
- `firmware/esp32_proof_sender/README.md` (общая документация прошивки)
