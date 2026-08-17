#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  ENRG — загрузка прошивки на ESP32 (PlatformIO)
#
#  Что делает:
#    1. Определяет рабочую PlatformIO (`.venv/bin/pio` > `platformio` > `pio`).
#    2. Проверяет, что ESP32 подключён к хосту (последовательный порт).
#    3. Показывает предупреждение (для `esp32dev-ota` — прожиг eFuse необратим!)
#       и запрашивает подтверждение перед загрузкой.
#    4. Загружает прошивку (`pio run -e <env> -t upload`).
#    5. По умолчанию открывает монитор порта (`pio device monitor`).
#
#  Использование:
#    ./upload-firmware.sh                # env по умолчанию: esp32dev-ota
#    ./upload-firmware.sh esp32dev       # другой env
#    TARGET_ENV=esp32dev ./upload-firmware.sh
#    PIO=/path/to/pio ./upload-firmware.sh   # явный путь к pio
#    ./upload-firmware.sh --no-monitor   # без монитора порта после загрузки
#
#  ⚠️ ВАЖНО (ADR-0008): env `esp32dev-ota` использует dual-bank A/B и
#  аппаратный anti-rollback (CONFIG_BOOTLOADER_EFUSE_SECURE_VERSION).
#  Первый успешный boot нового образа прожигает secure_version в eFuse —
#  это НЕОБРАТИМО. Не смешивайте env'ы на одной плате.
# ════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Расположение скрипта / workspace ─────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Поднимаемся до workspace root (firmware/esp32_proof_sender → ENRG → workspace).
PROJECT_DIR="$SCRIPT_DIR"
WORKSPACE_ROOT="$(cd "$PROJECT_DIR/../../.." && pwd)"

# ── Параметры ─────────────────────────────────────────────────────
TARGET_ENV="${TARGET_ENV:-${1:-esp32dev-ota}}"
MONITOR_BAUD="${MONITOR_BAUD:-115200}"          # совпадает с platformio.ini
MONITOR="1"                                      # по умолчанию открываем монитор
for arg in "$@"; do
    case "$arg" in
        --no-monitor) MONITOR="0" ;;
        -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    esac
done

# ── Поиск рабочей PlatformIO ──────────────────────────────────────
resolve_pio() {
    local candidates=()
    [ -n "${PIO:-}" ] && candidates+=("$PIO")
    candidates+=("$WORKSPACE_ROOT/.venv/bin/pio")
    candidates+=("$WORKSPACE_ROOT/.venv/bin/platformio")
    candidates+=("$(command -v platformio 2>/dev/null || true)")
    candidates+=("$(command -v pio 2>/dev/null || true)")
    local c
    for c in "${candidates[@]}"; do
        [ -n "$c" ] || continue
        if "$c" --version >/dev/null 2>&1; then
            echo "$c"
            return 0
        fi
    done
    return 1
}

PIO="$(resolve_pio)" || {
    echo "❌ PlatformIO не найден. Установите PlatformIO Core или задайте PIO=/path/to/pio." >&2
    echo "   (в этом workspace: /home/enrg/Axis-workspace/.venv/bin/pio)" >&2
    exit 1
}
echo "ℹ️  PlatformIO: $("$PIO" --version)"

# ── Проверка, что ESP32 подключён ─────────────────────────────────
detect_port() {
    local port
    port="$("$PIO" device list 2>/dev/null | grep -oE '/dev/(ttyUSB[0-9]+|ttyACM[0-9]+|cu\.[A-Za-z0-9._-]+)' | head -n1 || true)"
    if [ -z "$port" ]; then
        # fallback: прямое сканирование /dev
        port="$(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | head -n1 || true)"
    fi
    echo "$port"
}

echo ""
echo "🔍 Проверка подключения ESP32 ..."
PORT="$(detect_port)"
if [ -z "$PORT" ]; then
    echo "❌ ESP32 НЕ обнаружен. Убедитесь, что устройство подключено по USB." >&2
    echo ""
    echo "   Что проверить:" >&2
    echo "     1. Кабель USB (не только зарядный — нужен data-кабель)." >&2
    echo "     2. Драйвер USB-UART (CH340/CP210x) установлен." >&2
    echo "     3. Список портов: \"$PIO\" device list" >&2
    echo "     4. Права на порт (группа dialout): sudo usermod -aG dialout \$USER" >&2
    echo ""
    exit 1
fi
echo "✅ ESP32 найден на порту: $PORT"

# ── Предупреждение для esp32dev-ota (eFuse / dual-bank A/B) ───────
if [ "$TARGET_ENV" = "esp32dev-ota" ]; then
    echo ""
    echo "⚠️  ⚠️  ⚠️  ВНИМАНИЕ (ADR-0008) ⚠️  ⚠️  ⚠️"
    echo "   env 'esp32dev-ota': dual-bank A/B + аппаратный anti-rollback."
    echo "   Первый успешный boot образа ПРОЖИГАЕТ secure_version в eFuse."
    echo "   Это НЕОБРАТИМО и навсегда привяжет плату к этой линейке образов."
    echo ""
fi

# ── Подтверждение ─────────────────────────────────────────────────
echo ""
echo "📦 Прошивка:   $PROJECT_DIR"
echo "   Target env: $TARGET_ENV"
echo "   Бинарник:   .pio/build/$TARGET_ENV/firmware.bin"
echo "   Порт:       $PORT"
echo ""
read -r -p "Начать загрузку прошивки? [y/N] " ans
case "${ans:-N}" in
    y|Y|yes|YES) ;;
    *) echo "⏹  Отменено."; exit 0 ;;
esac

# ── Загрузка ──────────────────────────────────────────────────────
echo ""
echo "🚀 Загружаю прошивку (env=$TARGET_ENV) ..."
cd "$PROJECT_DIR"
"$PIO" run -e "$TARGET_ENV" -t upload --upload-port "$PORT"
echo "✅ Прошивка загружена."

# ── Логи после загрузки ───────────────────────────────────────────
if [ "$MONITOR" = "1" ]; then
    echo ""
    read -r -p "Запустить монитор порта для проверки логов? [Y/n] " mon
    case "${mon:-Y}" in
        y|Y|yes|YES|"") 
            echo ""
            echo "📟 Монитор порта $PORT (baud=$MONITOR_BAUD). Выход: Ctrl+]"
            echo "────────────────────────────────────────────"
            "$PIO" device monitor --port "$PORT" --baud "$MONITOR_BAUD" || true
            ;;
        *) 
            echo ""
            echo "ℹ️  Логи можно посмотреть вручную:"
            echo "   \"$PIO\" device monitor --port $PORT --baud $MONITOR_BAUD"
            ;;
    esac
else
    echo ""
    echo "ℹ️  Логи можно посмотреть вручную:"
    echo "   \"$PIO\" device monitor --port $PORT --baud $MONITOR_BAUD"
fi

echo ""
echo "🎉 Готово."
