use crate::constants::*;

// ══════════════════════════════════════════════════════════════
//  FIXED-POINT (u128, scale 1e18)
//
//  Audit BLOCK 5: removed f64 precision loss from the emission formulas.
//  All shares/multipliers are computed in integers with fixed point:
//    1.0 == FP_SCALE (1e18). Numeric behavior is preserved.
// ══════════════════════════════════════════════════════════════

/// Fixed-point scale: 1.0 == FP_SCALE (1e18).
pub const FP_SCALE: u128 = 1_000_000_000_000_000_000; // 1e18

/// ln(10) in fixed point (floor(ln(10) * 1e18)).
const LN10_FP: u128 = 2_302_585_092_994_045_684;

/// ln(2) in fixed point (floor(ln(2) * 1e18)).
const LN2_FP: u128 = 693_147_180_559_945_309;

/// Fixed-point multiplication: (a * b) / FP_SCALE, checked.
pub(crate) fn fp_mul(a: u128, b: u128) -> u128 {
    a.checked_mul(b)
        .map(|v| v / FP_SCALE)
        .unwrap_or(0)
}

/// exp(x) in fixed point (Taylor series). x_fp ∈ [0, ~2.31e18].
fn exp_fp(x_fp: u128) -> u128 {
    // e^x = 1 + x + x^2/2! + x^3/3! + ...
    let mut term = FP_SCALE;
    let mut sum = FP_SCALE;
    let mut k: u128 = 1;
    loop {
        term = fp_mul(term, x_fp);
        term = term.checked_div(k).unwrap_or(0);
        if term == 0 || k > 64 {
            break;
        }
        sum = sum.checked_add(term).unwrap_or(u128::MAX);
        k = k.checked_add(1).unwrap_or(u128::MAX);
    }
    sum
}

/// ln(1 + u) in fixed point for u_fp ∈ [0, FP_SCALE].
///
/// For u < 1/2 — alternating series u - u^2/2 + u^3/3 - ...
/// For u >= 1/2 — reduction: ln(1+u) = ln(2) + ln(1 - v), v = (1-u)/2 <= 1/4
/// (the series converges quickly).
fn ln_1p_fp(u_fp: u128) -> u128 {
    if u_fp < FP_SCALE / 2 {
        let mut term = u_fp;
        let mut result = u_fp;
        let mut k: u128 = 2;
        let mut subtract = false;
        loop {
            term = fp_mul(term, u_fp);
            let t = term.checked_div(k).unwrap_or(0);
            if t == 0 || k > 200 {
                break;
            }
            if subtract {
                result = result.saturating_sub(t);
            } else {
                result = result.checked_add(t).unwrap_or(u128::MAX);
            }
            subtract = !subtract;
            k = k.checked_add(1).unwrap_or(u128::MAX);
        }
        result
    } else {
        let v = (FP_SCALE - u_fp) / 2; // ∈ (0, 1/4]
        // ln(1 - v) = -(v + v^2/2 + v^3/3 + ...)
        let mut term = v;
        let mut series = v;
        let mut k: u128 = 2;
        loop {
            term = fp_mul(term, v);
            let t = term.checked_div(k).unwrap_or(0);
            if t == 0 || k > 200 {
                break;
            }
            series = series.checked_add(t).unwrap_or(u128::MAX);
            k = k.checked_add(1).unwrap_or(u128::MAX);
        }
        LN2_FP.saturating_sub(series)
    }
}

/// log10(1 + u) in fixed point for u_fp ∈ [0, FP_SCALE].
fn log10_1p_fp(u_fp: u128) -> u128 {
    let ln = ln_1p_fp(u_fp);
    ln.checked_mul(FP_SCALE)
        .map(|v| v / LN10_FP)
        .unwrap_or(0)
}

/// Emission share [0.0 .. 1.0] as a fixed point (1.0 == FP_SCALE).
///
/// Supply is measured in ATOMIC units (1 SRC == 10^9 atomics).
/// Progress = 1.0 when the whole 1_000_000_000 SRC (== 10^18 atomics) is mined.
pub fn emission_share(total_supply_atomic: u64) -> u128 {
    (total_supply_atomic as u128)
        .checked_mul(FP_SCALE)
        .map(|v| v.checked_div(MAX_SUPPLY_ATOMIC as u128).unwrap_or(0))
        .unwrap_or(0)
}

/// Asymptotic difficulty coefficient 10^share as a fixed point
/// (share ∈ [0,1]; result ∈ [FP_SCALE, 10*FP_SCALE]).
pub fn emission_difficulty(total_supply_atomic: u64) -> u128 {
    let share = emission_share(total_supply_atomic);
    let x = fp_mul(share, LN10_FP);
    exp_fp(x)
}

/// Wh per one SRC unit (in SRC_BASIS terms).
pub fn energy_per_src(total_supply_atomic: u64) -> u128 {
    let difficulty = emission_difficulty(total_supply_atomic);
    (INITIAL_ENERGY_PER_SRC as u128)
        .checked_mul(difficulty)
        .map(|v| v / FP_SCALE)
        .unwrap_or(0)
}

/// Dynamic difficulty multiplier for a specific device:
/// 1 + log10(1 + share), where share = device_energy_30d / network_energy_30d.
///
/// Fixed point; returns 1.0 (FP_SCALE) when network_energy_30d == 0.
/// The share is clamped to [0, 1]: a device is part of the network, so its
/// 30-day energy cannot exceed the network energy. Multiplier is always >= 1.0.
pub fn device_difficulty_multiplier(device_energy_30d: u64, network_energy_30d: u128) -> u128 {
    if network_energy_30d == 0 {
        return FP_SCALE;
    }
    let device = device_energy_30d as u128;
    let u_fp = if device >= network_energy_30d {
        FP_SCALE
    } else {
        device
            .checked_mul(FP_SCALE)
            .map(|v| v / network_energy_30d)
            .unwrap_or(FP_SCALE)
    };
    FP_SCALE
        .checked_add(log10_1p_fp(u_fp))
        .unwrap_or(u128::MAX)
}

/// Effective energy per SRC for a specific device (base × multiplier).
pub fn effective_energy_per_src(
    total_supply_atomic: u64,
    device_energy_30d: u64,
    network_energy_30d: u128,
) -> u128 {
    let base = energy_per_src(total_supply_atomic);
    let multiplier = device_difficulty_multiplier(device_energy_30d, network_energy_30d);
    base.checked_mul(multiplier)
        .map(|v| v / FP_SCALE)
        .unwrap_or(0)
}

/// Converts confirmed energy into SRC units (in SRC_BASIS terms).
pub fn reward_for_energy(energy_wh: u64, energy_per_src: u128) -> u64 {
    if energy_per_src == 0 {
        return 0;
    }
    ((energy_wh as u128 * SRC_BASIS as u128) / energy_per_src) as u64
}

/// Convenience wrapper — global difficulty (original).
pub fn calculate_reward(energy_wh: u64, total_supply_atomic: u64) -> u64 {
    reward_for_energy(energy_wh, energy_per_src(total_supply_atomic))
}

/// Reward calculation with per-device dynamic difficulty.
pub fn calculate_reward_dynamic(
    energy_wh: u64,
    total_supply_atomic: u64,
    device_energy_30d: u64,
    network_energy_30d: u128,
) -> u64 {
    let eps = effective_energy_per_src(total_supply_atomic, device_energy_30d, network_energy_30d);
    reward_for_energy(energy_wh, eps)
}

/// Updates sliding-window energy counter (u64).
/// If >= 30 days have passed — reset; otherwise — accumulate.
pub fn update_energy_window(current_energy: u64, last_update: i64, now: i64, new_energy: u64) -> u64 {
    const THIRTY_DAYS: i64 = 30 * 24 * 60 * 60;
    if last_update == 0 || now - last_update >= THIRTY_DAYS {
        new_energy
    } else {
        current_energy.saturating_add(new_energy)
    }
}

/// Updates sliding-window energy counter (u128 — for the network).
pub fn update_energy_window_u128(current_energy: u128, last_update: i64, now: i64, new_energy: u128) -> u128 {
    const THIRTY_DAYS: i64 = 30 * 24 * 60 * 60;
    if last_update == 0 || now - last_update >= THIRTY_DAYS {
        new_energy
    } else {
        current_energy.saturating_add(new_energy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_math_works() {
        // supply measured in ATOMICS: half cap == 0.5e18
        assert_eq!(emission_share(0), 0);
        assert_eq!(emission_share(MAX_SUPPLY_ATOMIC / 2), FP_SCALE / 2);
        assert_eq!(emission_share(MAX_SUPPLY_ATOMIC), FP_SCALE);
    }

    #[test]
    fn difficulty_increases() {
        assert!(energy_per_src(MAX_SUPPLY_ATOMIC / 2) > energy_per_src(0));
        assert!(energy_per_src(MAX_SUPPLY_ATOMIC * 9 / 10) > energy_per_src(MAX_SUPPLY_ATOMIC / 2));
    }

    #[test]
    fn zero_energy_no_reward() {
        assert_eq!(calculate_reward(0, 0), 0);
    }

    #[test]
    fn dynamic_multiplier_basics() {
        let m = device_difficulty_multiplier(0, 0);
        assert_eq!(m, FP_SCALE);

        let m_small = device_difficulty_multiplier(1_000, 1_000_000);
        let m_large = device_difficulty_multiplier(500_000, 1_000_000);
        assert!(m_large > m_small);
        assert!(m_small >= FP_SCALE);
    }

    #[test]
    fn large_device_gets_less_reward() {
        let r_small = calculate_reward_dynamic(10_000_000, 0, 1_000, 1_000_000);
        let r_large = calculate_reward_dynamic(10_000_000, 0, 500_000, 1_000_000);
        assert!(r_large <= r_small);
    }

    #[test]
    fn numeric_behavior_matches_f64_reference() {
        // 10^0.25 ≈ 1.7782794100389228 → floor(1_778_279.41) = 1_778_279
        let e25 = energy_per_src(MAX_SUPPLY_ATOMIC / 4);
        assert_eq!(e25, 1_778_279);

        // 10^0.5 ≈ 3.1622776601683795 → floor(3_162_277.66) = 3_162_277
        let e50 = energy_per_src(MAX_SUPPLY_ATOMIC / 2);
        assert_eq!(e50, 3_162_277);

        // 10^0.9 ≈ 7.9432823472428150 → floor(7_943_282.35) = 7_943_282
        let e90 = energy_per_src(MAX_SUPPLY_ATOMIC * 9 / 10);
        assert_eq!(e90, 7_943_282);

        // reward for 10 kWh at 0 supply: 10_000_000 * 1000 / 1_000_000 = 10_000
        assert_eq!(calculate_reward(10_000_000, 0), 10_000);

        // multiplier at share=0.001: 1 + log10(1.001) ≈ 1.0004340775
        let m = device_difficulty_multiplier(1_000, 1_000_000);
        let log10_fp = m - FP_SCALE;
        assert!(log10_fp >= 434_000_000_000_000); // >= 0.000434
        assert!(log10_fp <= 435_000_000_000_000); // <= 0.000435

        // multiplier at share=0.5: 1 + log10(1.5) ≈ 1.1760912591
        let m_half = device_difficulty_multiplier(500_000, 1_000_000);
        let log10_fp_half = m_half - FP_SCALE;
        assert!(log10_fp_half >= 176_090_000_000_000_000);
        assert!(log10_fp_half <= 176_092_000_000_000_000);
    }

    #[test]
    fn window_resets_after_30_days() {
        let now = 1_000_000;
        let old = now - 31 * 24 * 60 * 60;
        assert_eq!(update_energy_window(1000, old, now, 500), 500);
    }

    #[test]
    fn window_accumulates_within_30_days() {
        let now = 1_000_000;
        let old = now - 5 * 24 * 60 * 60;
        assert_eq!(update_energy_window(1000, old, now, 500), 1500);
    }

    #[test]
    fn window_starts_fresh() {
        assert_eq!(update_energy_window(0, 0, 1_000_000, 500), 500);
    }

    /// v7.0 §17: E(S) = 1 MWh × k^S, k = 10.
    /// At the start (S=0): 1_000_000 Wh (1 MWh); at full supply (S=1): 10_000_000 Wh.
    #[test]
    fn emission_formula_is_1mwh_times_10_to_s() {
        assert_eq!(INITIAL_ENERGY_PER_SRC, 1_000_000); // 1 MWh
        assert_eq!(EMISSION_DIFFICULTY_K, 10);

        // E(0) = 1 MWh × 10^0 = 1_000_000 Wh
        assert_eq!(energy_per_src(0), 1_000_000);
        // E(MAX) = 1 MWh × 10^1 = 10_000_000 Wh.
        // The fixed-point floor of the Taylor series gives 9_999_999 — tolerance ±1.
        let e_max = energy_per_src(MAX_SUPPLY_ATOMIC);
        assert!(e_max >= 9_999_999 && e_max <= 10_000_000, "e_max={e_max}");
        // E(MAX/2) = 1 MWh × 10^0.5 ≈ 3_162_277 Wh (floor)
        assert_eq!(energy_per_src(MAX_SUPPLY_ATOMIC / 2), 3_162_277);
        // Monotonicity: difficulty grows with supply.
        assert!(energy_per_src(MAX_SUPPLY_ATOMIC / 4) > energy_per_src(0));
        assert!(energy_per_src(MAX_SUPPLY_ATOMIC) > energy_per_src(MAX_SUPPLY_ATOMIC / 2));
    }
}
