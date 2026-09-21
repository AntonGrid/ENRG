/**
 * ENRG ESP32 host port for the NXP Plug & Trust middleware — public header.
 *
 * Including this header from the firmware is not decoration: it is what makes
 * PlatformIO's library dependency finder compile lib/enrg_se050_port. The
 * middleware calls phPalEse_i2c_* / sm_sleep declared in *its* headers, so
 * without this include the port is invisible to the linker and the tier fails
 * with "undefined reference to phPalEse_i2c_write".
 *
 * The implementations live in enrg_se050_port.cpp — see its header comment for
 * what the port supplies (I2C PAL, timers, reset hooks) and what is still
 * unverified (no SE050 board has been connected yet).
 */
#ifndef ENRG_SE050_PORT_H
#define ENRG_SE050_PORT_H

#ifdef __cplusplus
extern "C" {
#endif

/** Bring the I2C bus up explicitly (optional: the PAL does it lazily too). */
void enrg_se050_port_init(void);

/** SDA/SCL actually in use, for logging during bring-up. */
int enrg_se050_port_sda(void);
int enrg_se050_port_scl(void);

#ifdef __cplusplus
}
#endif

#endif /* ENRG_SE050_PORT_H */
