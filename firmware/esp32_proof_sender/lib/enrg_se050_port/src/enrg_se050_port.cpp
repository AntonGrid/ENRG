/**
 * ESP32 / Arduino host port for the NXP Plug & Trust middleware (SE050).
 * ===========================================================================
 *
 * The vendored middleware (lib/se05x — BSD-3-Clause, see its VERSION file)
 * contains the T=1-over-I2C protocol, the APDU layer and the SSS API, but the
 * three things a *new host platform* must supply are missing for bare-metal
 * Arduino, and PlatformIO would otherwise try to compile the Linux/Raspberry Pi
 * variants. This file supplies them, and nothing else:
 *
 *   1. I2C platform layer — the four `phPalEse_i2c_*` functions declared in
 *      hostlib/hostLib/libCommon/smCom/T1oI2C/phNxpEsePal_i2c.h, which the
 *      protocol stack calls (phNxpEse_Api.c). On Linux these are implemented in
 *      phNxpEsePal_i2c.c on top of axI2C* in platform/linux/i2c_a7.c; both are
 *      excluded by scripts/vendor-se050.sh. Behaviour mirrors the Linux port:
 *      a plain bus write/read of the frame the caller already built (the T=1
 *      length byte is part of that frame — phNxpEse_WriteFrame passes it through
 *      untouched), with the same retry/back-off constants.
 *   2. Timers — sm_sleep/sm_usleep/sm_initSleep from platform/inc/sm_timer.h.
 *      The generic implementation busy-waits on `clock()`, which on the ESP32
 *      would spin a core; here they yield to the RTOS.
 *   3. Reset hooks — ax_reset.h + se05x_ic_reset(). The Raspberry Pi build drives
 *      a GPIO through sysfs; here a GPIO is used only if one is configured.
 *
 * ⚠️ Bring-up status: this port has never spoken to silicon — no board with an
 * SE050 has been connected yet (docs/STATE.md). It compiles and links; the I2C
 * framing assumption above is the first thing to verify with a logic analyser
 * when hardware arrives.
 *
 * Wiring (defaults, override with build_flags):
 *   SDA = GPIO21, SCL = GPIO22, 100 kHz. SE050 address 0x48 (7-bit).
 */

/* PlatformIO compiles every library under lib/ for EVERY environment, so this
 * file is also compiled for the NVS/ATECC tiers — where the NXP headers are not
 * on the include path and the port is not wanted. It must therefore contribute
 * nothing unless the SE050 tier is selected. */
#if !defined(ENRG_USE_SE050) || !ENRG_USE_SE050

#else /* ENRG_USE_SE050 */

#include <Arduino.h>
#include <Wire.h>

#include <stdint.h>
#include <string.h>

extern "C" {
#include "phEseStatus.h"     /* ESESTATUS_* — phNxpEsePal_i2c.h itself pulls only phEseTypes.h */
#include "phNxpEsePal_i2c.h" /* phPalEse_Config_t, ESESTATUS, MAX_RETRY_COUNT */
#include "sm_timer.h"
#include "ax_reset.h"
#include "se05x_reset_apis.h"
}

#ifndef ENRG_SE050_SDA
#define ENRG_SE050_SDA 21
#endif
#ifndef ENRG_SE050_SCL
#define ENRG_SE050_SCL 22
#endif
/* T=1 over I2C is specified at 100 kHz. 400 kHz works on short, well-terminated
 * wiring (needs ~4.7k pull-ups); it is a bring-up knob, not a default. */
#ifndef ENRG_SE050_I2C_HZ
#define ENRG_SE050_I2C_HZ 100000UL
#endif
/* -1 = no reset line wired (the common breakout); the middleware's reset path is
 * then limited to the I2C "com reset" that smComT1oI2C implements itself. */
#ifndef ENRG_SE050_RESET_GPIO
#define ENRG_SE050_RESET_GPIO -1
#endif
/* SE050/SE051 reset is active high — the same value fsl_sss_ftr.h records. */
#ifndef ENRG_SE050_RESET_LOGIC
#define ENRG_SE050_RESET_LOGIC 1
#endif
#ifndef ENRG_SE050_PORT_DEBUG
#define ENRG_SE050_PORT_DEBUG 0
#endif

#if ENRG_SE050_PORT_DEBUG
#define PORT_LOG(...) Serial.printf(__VA_ARGS__)
#else
#define PORT_LOG(...) ((void)0)
#endif

static bool g_bus_up = false;
static uint8_t g_dev_addr7 = (uint8_t)(SMCOM_I2C_ADDRESS >> 1);

/* ── 1. I2C platform layer ─────────────────────────────────────────────────── */

static void port_bus_begin(void) {
    if (!g_bus_up) {
        Wire.begin(ENRG_SE050_SDA, ENRG_SE050_SCL, ENRG_SE050_I2C_HZ);
        g_bus_up = true;
        PORT_LOG("[SE050-port] I2C up: SDA=%d SCL=%d %lu Hz\n", ENRG_SE050_SDA,
                 ENRG_SE050_SCL, (unsigned long)ENRG_SE050_I2C_HZ);
    }
}

/** Write `len` bytes and return the number accepted, or -1 on a bus error. */
static int port_i2c_write(uint8_t addr7, const uint8_t *buf, int len) {
    port_bus_begin();
    Wire.beginTransmission(addr7);
    if (Wire.write(buf, (size_t)len) != (size_t)len) {
        return -1;
    }
    uint8_t err = Wire.endTransmission(true /* stop */);
    if (err != 0) {
        PORT_LOG("[SE050-port] write to 0x%02X failed: i2c err %u\n", addr7, err);
        return -1;
    }
    return len;
}

/** Read up to `len` bytes; returns how many arrived, or -1 on a bus error. */
static int port_i2c_read(uint8_t addr7, uint8_t *buf, int len) {
    port_bus_begin();
    int requested = (int)Wire.requestFrom((int)addr7, len, (int)true /* stop */);
    if (requested <= 0) {
        PORT_LOG("[SE050-port] read from 0x%02X returned %d\n", addr7, requested);
        return -1;
    }
    int got = 0;
    while (Wire.available() > 0 && got < len) {
        buf[got++] = (uint8_t)Wire.read();
    }
    return got;
}

ESESTATUS phPalEse_i2c_open_and_configure(pphPalEse_Config_t pConfig) {
    if (pConfig == NULL) {
        return ESESTATUS_INVALID_PARAMETER;
    }
    /* The middleware passes the address from the connect string. It is the
     * 8-bit form (0x90 = 0x48 << 1); Wire wants 7 bits. */
    if (pConfig->DeviceAddress != 0) {
        g_dev_addr7 = (uint8_t)(((uint8_t)pConfig->DeviceAddress) >> 1);
    }
    port_bus_begin();
    /* The bus is a singleton on this target, so the handle is just a token that
     * has to be non-NULL — which is all the protocol stack expects. */
    pConfig->pDevHandle = (void *)&g_bus_up;
    PORT_LOG("[SE050-port] open: addr=0x%02X\n", g_dev_addr7);
    return ESESTATUS_SUCCESS;
}

void phPalEse_i2c_close(void *pDevHandle) {
    (void)pDevHandle;
    /* Wire has no per-device handle and the bus may be shared with other
     * peripherals, so closing means "forget the handle", not "shut the bus". */
    PORT_LOG("[SE050-port] close\n");
}

int phPalEse_i2c_write(void *pDevHandle, uint8_t *pBuffer, int nNbBytesToWrite) {
    (void)pDevHandle;
    if (pBuffer == NULL || nNbBytesToWrite <= 0) {
        return -1;
    }
    for (int attempt = 0; attempt <= MAX_RETRY_COUNT; attempt++) {
        int wrote = port_i2c_write(g_dev_addr7, pBuffer, nNbBytesToWrite);
        if (wrote == nNbBytesToWrite) {
            return wrote;
        }
        /* Retried with the wake-up delay the Linux port uses — a retry is what
         * brings a sleepy SE05x out of standby. */
        delay(WAKE_UP_DELAY_MS);
    }
    return -1;
}

int phPalEse_i2c_read(void *pDevHandle, uint8_t *pBuffer, int nNbBytesToRead) {
    (void)pDevHandle;
    if (pBuffer == NULL || nNbBytesToRead <= 0) {
        return -1;
    }
    for (int attempt = 0; attempt <= MAX_RETRY_COUNT; attempt++) {
        int got = port_i2c_read(g_dev_addr7, pBuffer, nNbBytesToRead);
        if (got == nNbBytesToRead) {
            return got;
        }
        delay(WAKE_UP_DELAY_MS);
    }
    return -1;
}

/* ── 2. Timers ─────────────────────────────────────────────────────────────── */

extern "C" uint32_t sm_initSleep(void) {
    return 0;
}

extern "C" void sm_sleep(uint32_t msec) {
    if (msec > 0) {
        delay(msec);
    }
}

extern "C" void sm_usleep(uint32_t microsec) {
    if (microsec > 0) {
        delayMicroseconds(microsec);
    }
}

/* ── 4. Public surface (see enrg_se050_port.h) ─────────────────────────────── */

extern "C" void enrg_se050_port_init(void) {
    port_bus_begin();
}

extern "C" int enrg_se050_port_sda(void) {
    return ENRG_SE050_SDA;
}

extern "C" int enrg_se050_port_scl(void) {
    return ENRG_SE050_SCL;
}

/* ── 3. Reset hooks ────────────────────────────────────────────────────────── */

extern "C" void axReset_HostConfigure(void) {
#if ENRG_SE050_RESET_GPIO >= 0
    pinMode(ENRG_SE050_RESET_GPIO, OUTPUT);
    digitalWrite(ENRG_SE050_RESET_GPIO,
                 ENRG_SE050_RESET_LOGIC ? LOW : HIGH); /* idle level */
#endif
}

extern "C" void axReset_HostUnconfigure(void) {
}

extern "C" void axReset_ResetPulseDUT(int reset_logic) {
#if ENRG_SE050_RESET_GPIO >= 0
    int active = ENRG_SE050_RESET_LOGIC ? HIGH : LOW;
    int idle = (active == HIGH) ? LOW : HIGH;
    if (reset_logic == 0) {
        /* Caller asked for the opposite polarity (SE052 boards). */
        int tmp = active;
        active = idle;
        idle = tmp;
    }
    digitalWrite(ENRG_SE050_RESET_GPIO, active);
    delay(10);
    digitalWrite(ENRG_SE050_RESET_GPIO, idle);
    delay(10);
#else
    (void)reset_logic;
    PORT_LOG("[SE050-port] reset pulse requested, no RESET GPIO configured\n");
#endif
}

extern "C" void axReset_PowerDown(int reset_logic) {
    (void)reset_logic;
}

extern "C" void axReset_PowerUp(int reset_logic) {
    (void)reset_logic;
}

/**
 * Called by the middleware before it talks to the chip. With a reset line wired
 * this pulses it; without one it deliberately does nothing — the protocol-level
 * reset (`smComT1oI2C_ComReset`, part of the vendored code) still runs, which is
 * what the SE050 breakout boards rely on.
 */
extern "C" void se05x_ic_reset(uint32_t applet_version) {
    (void)applet_version;
#if ENRG_SE050_RESET_GPIO >= 0
    axReset_HostConfigure();
    axReset_ResetPulseDUT(ENRG_SE050_RESET_LOGIC);
#endif
}

#endif /* ENRG_USE_SE050 */
