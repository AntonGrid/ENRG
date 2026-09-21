# `lib/` — our own code only

| Directory | What it is |
|---|---|
| `enrg_se050_port/` | **Our** ESP32/Arduino host port for the NXP Plug & Trust middleware: the I2C platform layer (`phPalEse_i2c_*`, T=1 over I2C), the timers (`sm_sleep`/`sm_usleep`) and the reset hooks. ~250 lines, no third-party code. |

The vendored NXP middleware is **not** here: PlatformIO compiles every library
under `lib/` for *every* environment, so a third-party tree here breaks the
`esp32dev` / `esp32dev-ota` builds, which have no SSS include paths or defines.
It lives in [`../vendor/se05x/`](../vendor/README.md) (gitignored) and is added
per-environment via `lib_extra_dirs` in the `esp32dev-se050` env.

Build the SE050 tier:

```bash
scripts/vendor-se050.sh          # once; needs network
pio run -e esp32dev-se050
```

Measured 2026-09-21: `SUCCESS`, 20 s, 93.6% of the 1.3 MB app slot. Note that a
single-slot image at 93.6% leaves no room for dual-bank OTA — combining the SE050
tier with `esp32dev-ota` needs a custom partition table (a 4 MB+ flash part).
