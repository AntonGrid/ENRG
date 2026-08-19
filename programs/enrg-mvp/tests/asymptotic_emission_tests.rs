//! Asymptotic emission behavior tests for the enrg-mvp crate.
//!
//! Moved from the Axis-core repository (where these tests were orphaned) and
//! rewritten against the current fixed-point math API (`src/math.rs`).
//!
//! NOTE: the original file sketched a `solana-program-test` harness. That
//! harness is NOT wired as a dev-dependency in this crate, so the tests below
//! target the pure math API. Full on-chain integration is exercised through
//! `anchor test` (see the TypeScript tests in `ENRG/tests`).

use enrg_mvp::constants::MAX_SUPPLY_ATOMIC;
use enrg_mvp::math::*;

#[test]
fn emission_difficulty_is_asymptotic() {
    // Difficulty = 10^S grows monotonically from 1.0 to ~10.0 (fixed point).
    assert_eq!(emission_difficulty(0), FP_SCALE);

    let d50 = emission_difficulty(MAX_SUPPLY_ATOMIC / 2);
    assert!(d50 > FP_SCALE && d50 < 10 * FP_SCALE);

    let d_max = emission_difficulty(MAX_SUPPLY_ATOMIC);
    assert!(d_max > 9 * FP_SCALE && d_max <= 10 * FP_SCALE, "d_max={d_max}");
}

#[test]
fn energy_required_grows_monotonically() {
    // Same checkpoints as the original tests: 0%, 25%, 50%, 75%, 90% supply.
    let e0 = energy_per_src(0);
    let e25 = energy_per_src(MAX_SUPPLY_ATOMIC / 4);
    let e50 = energy_per_src(MAX_SUPPLY_ATOMIC / 2);
    let e75 = energy_per_src(MAX_SUPPLY_ATOMIC * 3 / 4);
    let e90 = energy_per_src(MAX_SUPPLY_ATOMIC * 9 / 10);

    assert!(e25 > e0);
    assert!(e50 > e25);
    assert!(e75 > e50);
    assert!(e90 > e75);

    // Known reference values (floor of 1_000_000 × 10^S Wh).
    assert_eq!(e25, 1_778_279);
    assert_eq!(e50, 3_162_277);
    assert_eq!(e90, 7_943_282);
}

#[test]
fn dynamic_difficulty_prefers_small_devices() {
    let network: u128 = 1_000_000;

    let m_small = device_difficulty_multiplier(1_000, network);
    let m_large = device_difficulty_multiplier(500_000, network);
    assert!(m_large > m_small);
    assert!(m_small >= FP_SCALE);

    let r_small = calculate_reward_dynamic(10_000_000, 0, 1_000, network);
    let r_large = calculate_reward_dynamic(10_000_000, 0, 500_000, network);
    assert!(r_small >= r_large);
    assert!(r_small > 0);
}

#[test]
fn zero_network_energy_keeps_multiplier_at_one() {
    assert_eq!(device_difficulty_multiplier(1_000, 0), FP_SCALE);
}

#[test]
fn overflow_is_safe_at_extreme_supply() {
    // share clamps to [0,1]; no overflow even at 99.9%+ of supply.
    let d = emission_difficulty(MAX_SUPPLY_ATOMIC);
    assert!(d <= 10 * FP_SCALE);
}
