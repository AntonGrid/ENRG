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
- **PlatformIO env `esp32dev-se050`** (`-D ENRG_USE_SE050=1`).
- **PlatformIO env `esp32dev-mainnet`** (`ENRG_MAINNET=1` + `ENRG_USE_SE050=1` +
  `ENRG_MANIFEST_REQUIRED=1` + anti-rollback) — единственная сборка, разрешённая
  для продакшена.

> ⚠️ **Статус кода (измерено 2026-09-21).** Tier **собирается**:
> `pio run -e esp32dev-se050` → `SUCCESS` (20 с, flash 93.6%), `-e esp32dev-mainnet`
> наследует те же флаги. Но по пути нашлись две ошибки в прежних утверждениях —
> обе исправлены:
>
> 1. **Middleware NXP не «закрытый».** Пакет `NXP/plug-and-trust` на GitHub —
>    **BSD-3-Clause** (`LICENSE.txt`: «Copyright 2018-2020,2024 NXP», текст
>    BSD 3-Clause), то есть вендоринг разрешён с сохранением уведомления.
>    Прежняя формулировка «закрытый по лицензии, поэтому не вендорится» была
>    неверна: blocker был не юридический, а в том, что вендоринг не сделали.
> 2. **Прошивка вызывала функции, которых в API NXP нет.** `sss_se05x_connect`,
>    `sss_open_session`, `sss_key_store_init`, `sss_crypto_object_create/get_handle`,
>    `sss_asymmetric_get_pub_key`, `sss_asymmetric_sign`,
>    `kSSS_KeyPart_Pair_Ed25519`, `kSSS_CipherType_EC_ED25519`,
>    `kAlgorithm_SSS_Ed25519` — таких символов нет ни в mini-package, ни в API.
>    Именно поэтому tier не мог собраться ни в какой конфигурации. Теперь код
>    использует реальный API: `sss_se05x_session_open` →
>    `sss_se05x_key_store_context_init` → `sss_se05x_key_object_init` →
>    `sss_se05x_key_object_{allocate_handle,get_handle}` →
>    `sss_se05x_key_store_generate_key`/`_get_key` →
>    `sss_se05x_asymmetric_context_init` → `sss_se05x_asymmetric_sign`, с
>    Ed25519 = `kSSS_CipherType_EC_TWISTED_ED` + `kAlgorithm_SSS_SHA512` (внутри
>    чип выбирает `kSE05x_EDSignatureAlgo_ED25519PURE_SHA_512`).
>
> **Что по-прежнему не проверено:** ни одна плата с SE050 не подключалась, ни один
> proof не подписан на чипе. Сборка ≠ bring-up. Кроме платы нужен включённый в
> апплет EDDSA (`AppletConfig_EDDSA`, кривая `RESERVED_ID_ECC_ED_25519`) — это
> заводская/OTP-настройка, и первое, что стоит проверить на железе.

### Vendoring: middleware + наш порт

Middleware **не коммитится**, а скачивается скриптом в `vendor/se05x/`
(gitignored) — третьесторонний код на 105 файлов не должен жить в каждом диффе:

```bash
cd firmware/esp32_proof_sender
scripts/vendor-se050.sh          # пиннутый ref + sha256 tarball'а → vendor/se05x/VERSION
pio run -e esp32dev-se050
```

Скрипт проверяет, что upstream всё ещё BSD-3-Clause, и отказывается продолжать,
если лицензия изменилась. Раскладка:

```
firmware/esp32_proof_sender/
├── vendor/se05x/            # NXP Plug & Trust mini package (BSD-3-Clause,
│                            # gitignored): sss/, hostlib/, fsl_sss_ftr.h
└── lib/enrg_se050_port/     # НАШ порт (коммитится): I2C PAL phPalEse_i2c_*,
                             # sm_sleep/sm_usleep, reset-хуки — ~250 строк
```

Почему middleware не в `lib/`: PlatformIO компилирует **все** библиотеки из `lib/`
для **каждого** env — дерево в `lib/` ломает `esp32dev`/`esp32dev-ota`, где нет ни
SSS-include-путей, ни define'ов. Поэтому `vendor/` подключается только в SE050-тир
через `lib_extra_dirs`. По той же причине наш порт обёрнут в
`#if ENRG_USE_SE050` — иначе он компилируется и для dev-тиров.

### Bring-up (чек-лист)

```bash
cd firmware/esp32_proof_sender
# 1. Middleware (один раз, нужен доступ в сеть) и сборка тира:
scripts/vendor-se050.sh
pio run -e esp32dev-se050              # измерено 2026-09-21: SUCCESS, flash 93.6%
# 2. Подключите SE050 к I2C (SDA=21, SCL=22 по умолчанию) + VCC/GND.
#    Есть линия reset — задайте -D ENRG_SE050_RESET_GPIO=<пин>; иначе порт
#    полагается на протокольный ComReset.
# 3. Если чип не отвечает: логический анализатор на SDA/SCL. Порт отдаёт кадр
#    на шину как есть (length byte уже внутри кадра) — см. комментарий в
#    lib/enrg_se050_port/src/enrg_se050_port.cpp, это первое место для проверки.
# 4. Прошейте и смотрите Serial: "[KEY] хранилище: NXP SE050 ...", "[SE050] ..."
pio run -e esp32dev-se050 -t upload -t monitor
# 5. Отправьте ОДИН proof этим устройством и приложите к задаче строку Serial
#    + device_id + tx подписи/минта (это и есть «железный bring-up log»).
```

Проверьте на шаге 4, что EDDSA включён в апплете: без `AppletConfig_EDDSA`
генерация Ed25519-ключа вернёт ошибку SSS, и это настройка уровня OTP — программно
её из прошивки не обойти.

Только после шага 5 в `README.md`/`docs/STATE.md` можно писать, что устройство
подписывает proof'ы внутри SE050. Корректная формулировка до этого — «tier
собирается (2026-09-21), чип не поднимался»: сборка и работа на кремнии — разные
утверждения, и здесь проверено только первое.

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
