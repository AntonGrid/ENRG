# `vendor/` — third-party code, fetched not committed

`se05x/` is the **NXP Plug & Trust middleware "mini package"** (BSD-3-Clause,
`LICENSE.txt` inside), vendored by [`../scripts/vendor-se050.sh`](../scripts/vendor-se050.sh).
It is gitignored: ~105 files of third-party C, fetched at a pinned upstream ref
and byte-verified, instead of living in every diff of this repository.

```bash
scripts/vendor-se050.sh        # default pinned ref, see the script header
pio run -e esp32dev-se050
```

The script records what it fetched — upstream ref, fetch time, tarball sha256,
license — in `se05x/VERSION`; it refuses to continue if upstream's `LICENSE.txt`
stops being BSD-3-Clause. It also excludes what cannot compile on a bare-metal
target (Linux/Raspberry Pi ports, host-crypto backends, SCP03, examples) and
generates the `sss.h` umbrella and a `library.json` that the packaging lacks.

Why not `lib/`: PlatformIO compiles every library under `lib/` for **every**
environment, so a tree here breaks `esp32dev` / `esp32dev-ota` (they would be
compiled without the SSS include paths and defines). `vendor/` is only added to
the environment that needs it, via `lib_extra_dirs` in `platformio.ini`.

The ESP32 side of the port (I2C PAL, timers, reset) is our code and lives in
[`../lib/enrg_se050_port/`](../lib/README.md).
