use crate::constants::*;

/// Returns current emission progress [0.0 .. 1.0].
pub fn emission_share(
    total_supply: u64,
) -> f64 {
    total_supply as f64 / MAX_SUPPLY as f64
}

/// Returns current asymptotic difficulty coefficient.
pub fn emission_difficulty(
    total_supply: u64,
) -> f64 {
    let share = emission_share(total_supply);

    (EMISSION_DIFFICULTY_K as f64).powf(share)
}

/// Returns Wh required for one SRC.
pub fn energy_per_src(
    total_supply: u64,
) -> u128 {
    (INITIAL_ENERGY_PER_SRC as f64
        * emission_difficulty(total_supply))
        as u128
}

/// Converts verified energy into SRC.
pub fn reward_for_energy(
    energy_wh: u64,
    energy_per_src: u128,
) -> u64 {

    if energy_per_src == 0 {
        return 0;
    }

    ((energy_wh as u128
        * SRC_BASIS as u128)
        / energy_per_src) as u64
}

/// Convenience wrapper.
pub fn calculate_reward(
    energy_wh: u64,
    total_supply: u64,
) -> u64 {

    reward_for_energy(
        energy_wh,
        energy_per_src(total_supply),
    )
}
