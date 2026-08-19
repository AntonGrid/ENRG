#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  ENRG — flash the ESP32 firmware (PlatformIO)
#
#  What it does:
#    1. Finds a working PlatformIO (`.venv/bin/pio` > `platformio` > `pio`).
#    2. Checks that the ESP32 is attached to the host (serial port).
#    3. Shows a warning (for `esp32dev-ota` — eFuse burn is irreversible!)
#       and asks for confirmation before flashing.
#    4. Flashes the firmware (`pio run -e <env> -t upload`).
#    5. Opens the port monitor by default (`pio device monitor`).
#
#  Usage:
#    ./upload-firmware.sh                # default env: esp32dev-ota
#    ./upload-firmware.sh esp32dev       # another env
#    TARGET_ENV=esp32dev ./upload-firmware.sh
#    PIO=/path/to/pio ./upload-firmware.sh   # explicit pio path
#    ./upload-firmware.sh --no-monitor   # no port monitor after flashing
#
#  ⚠️ IMPORTANT (ADR-0008): the `esp32dev-ota` env uses dual-bank A/B and
#  hardware anti-rollback (CONFIG_BOOTLOADER_EFUSE_SECURE_VERSION).
#  The first successful boot of a new image burns secure_version into the eFuse —
#  this is IRREVERSIBLE. Do not mix envs on the same board.
# ════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Script / workspace location ───────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Walk up to the workspace root (firmware/esp32_proof_sender → ENRG → workspace).
PROJECT_DIR="$SCRIPT_DIR"
WORKSPACE_ROOT="$(cd "$PROJECT_DIR/../../.." && pwd)"

# ── Parameters ────────────────────────────────────────────────────
TARGET_ENV="${TARGET_ENV:-${1:-esp32dev-ota}}"
MONITOR_BAUD="${MONITOR_BAUD:-115200}"          # matches platformio.ini
MONITOR="1"                                      # open the monitor by default
for arg in "$@"; do
    case "$arg" in
        --no-monitor) MONITOR="0" ;;
        -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    esac
done

# ── Finding a working PlatformIO ──────────────────────────────────
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
    echo "❌ PlatformIO not found. Install PlatformIO Core or set PIO=/path/to/pio." >&2
    echo "   (in this workspace: /home/enrg/Axis-workspace/.venv/bin/pio)" >&2
    exit 1
}
echo "ℹ️  PlatformIO: $("$PIO" --version)"

# ── Checking the ESP32 is attached ────────────────────────────────
detect_port() {
    local port
    port="$("$PIO" device list 2>/dev/null | grep -oE '/dev/(ttyUSB[0-9]+|ttyACM[0-9]+|cu\.[A-Za-z0-9._-]+)' | head -n1 || true)"
    if [ -z "$port" ]; then
        # fallback: scan /dev directly
        port="$(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | head -n1 || true)"
    fi
    echo "$port"
}

echo ""
echo "🔍 Checking the ESP32 connection ..."
PORT="$(detect_port)"
if [ -z "$PORT" ]; then
    echo "❌ ESP32 NOT detected. Make sure the device is connected via USB." >&2
    echo ""
    echo "   What to check:" >&2
    echo "     1. USB cable (not charge-only — a data cable is required)." >&2
    echo "     2. The USB-UART driver (CH340/CP210x) is installed." >&2
    echo "     3. Port list: \"$PIO\" device list" >&2
    echo "     4. Port permissions (dialout group): sudo usermod -aG dialout \$USER" >&2
    echo ""
    exit 1
fi
echo "✅ ESP32 found on port: $PORT"

# ── Warning for esp32dev-ota (eFuse / dual-bank A/B) ───────────────
if [ "$TARGET_ENV" = "esp32dev-ota" ]; then
    echo ""
    echo "⚠️  ⚠️  ⚠️  WARNING (ADR-0008) ⚠️  ⚠️  ⚠️"
    echo "   env 'esp32dev-ota': dual-bank A/B + hardware anti-rollback."
    echo "   The first successful image boot BURNS secure_version into the eFuse."
    echo "   This is IRREVERSIBLE and permanently binds the board to this image line."
    echo ""
fi

# ── Confirmation ──────────────────────────────────────────────────
echo ""
echo "📦 Firmware:   $PROJECT_DIR"
echo "   Target env: $TARGET_ENV"
echo "   Binary:      .pio/build/$TARGET_ENV/firmware.bin"
echo "   Port:       $PORT"
echo ""
read -r -p "Start flashing the firmware? [y/N] " ans
case "${ans:-N}" in
    y|Y|yes|YES) ;;
    *) echo "⏹  Cancelled."; exit 0 ;;
esac

# ── Flashing ──────────────────────────────────────────────────────
echo ""
echo "🚀 Flashing the firmware (env=$TARGET_ENV) ..."
cd "$PROJECT_DIR"
"$PIO" run -e "$TARGET_ENV" -t upload --upload-port "$PORT"
echo "✅ Firmware flashed."

# ── Logs after flashing ───────────────────────────────────────────
if [ "$MONITOR" = "1" ]; then
    echo ""
    read -r -p "Start the port monitor to check logs? [Y/n] " mon
    case "${mon:-Y}" in
        y|Y|yes|YES|"") 
            echo ""
            echo "📟 Port monitor $PORT (baud=$MONITOR_BAUD). Exit: Ctrl+]"
            echo "────────────────────────────────────────────"
            "$PIO" device monitor --port "$PORT" --baud "$MONITOR_BAUD" || true
            ;;
        *) 
            echo ""
            echo "ℹ️  You can view the logs manually:"
            echo "   \"$PIO\" device monitor --port $PORT --baud $MONITOR_BAUD"
            ;;
    esac
else
    echo ""
    echo "ℹ️  You can view the logs manually:"
    echo "   \"$PIO\" device monitor --port $PORT --baud $MONITOR_BAUD"
fi

echo ""
echo "🎉 Done."
