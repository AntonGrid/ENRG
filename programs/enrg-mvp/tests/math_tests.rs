//! Math unit tests for the enrg-mvp crate.
//!
//! Moved from the Axis-core repository (where these tests were orphaned) into
//! the crate they actually test, and adapted to the current fixed-point API
//! (u128, scale 1e18 — see `src/math.rs`).

use enrg_mvp::constants::{EMISSION_DIFFICULTY_K, INITIAL_ENERGY_PER_SRC, MAX_SUPPLY_ATOMIC};
use enrg_mvp::math::*;

#[test]
fn emission_share_zero_supply() {
    assert_eq!(emission_share(0), 0);
}

#[test]
fn emission_share_half_supply() {
    assert_eq!(emission_share(MAX_SUPPLY_ATOMIC / 2), FP_SCALE / 2);
}

#[test]
fn emission_share_full_supply() {
    assert_eq!(emission_share(MAX_SUPPLY_ATOMIC), FP_SCALE);
}

#[test]
fn initial_energy_per_src_is_one_mwh() {
    assert_eq!(energy_per_src(0), INITIAL_ENERGY_PER_SRC as u128);
}

#[test]
fn energy_per_src_increases_with_supply() {
    let e0 = energy_per_src(0);
    let e50 = energy_per_src(MAX_SUPPLY_ATOMIC / 2);
    let e90 = energy_per_src(MAX_SUPPLY_ATOMIC * 9 / 10);
    assert!(e50 > e0);
    assert!(e90 > e50);
}

#[test]
fn emission_formula_is_1mwh_times_10_to_s() {
    // E(S) = 1 MWh × 10^S, S ∈ [0, 1], k = 10.
    assert_eq!(INITIAL_ENERGY_PER_SRC, 1_000_000);
    assert_eq!(EMISSION_DIFFICULTY_K, 10);

    // At full supply: 1 MWh × 10^1 = 10_000_000 Wh (fixed-point floor, ±1).
    let e_max = energy_per_src(MAX_SUPPLY_ATOMIC);
    assert!((9_999_999..=10_000_000).contains(&e_max), "e_max={e_max}");
    // At half supply: 1 MWh × 10^0.5 ≈ 3_162_277 Wh (floor).
    assert_eq!(energy_per_src(MAX_SUPPLY_ATOMIC / 2), 3_162_277);
}

#[test]
fn reward_decreases_as_supply_grows() {
    let reward0 = calculate_reward(10_000_000, 0);
    let reward50 = calculate_reward(10_000_000, MAX_SUPPLY_ATOMIC / 2);
    let reward90 = calculate_reward(10_000_000, MAX_SUPPLY_ATOMIC * 9 / 10);
    assert!(reward0 > reward50);
    assert!(reward50 > reward90);
}

#[test]
fn zero_energy_produces_zero_reward() {
    assert_eq!(calculate_reward(0, 0), 0);
}
