use crate::constants::*;

/// Returns the current emission share scaled to [0.0, 1.0].
pub fn emission_share(
    total_supply: u64,
) -> f64 {
    total_supply as f64 / MAX_SUPPLY as f64
}

/// Returns the amount of energy (Wh) required
/// to mint one SRC at the current emission stage.
///
/// Formula:
///
/// Energy = INITIAL_ENERGY_PER_SRC × k^S
///
/// where:
/// S = total_supply / MAX_SUPPLY
pub fn energy_per_src(
    total_supply: u64,
) -> u128 {
    let share = emission_share(total_supply);

    let difficulty =
        (EMISSION_DIFFICULTY_K as f64).powf(share);

    (INITIAL_ENERGY_PER_SRC as f64 * difficulty)
        as u128
}

/// Calculates how many SRC should be minted
/// for a verified amount of energy.
pub fn calculate_reward(
    energy_wh: u64,
    total_supply: u64,
) -> u64 {
    let required =
        energy_per_src(total_supply);

    if required == 0 {
        return 0;
    }

    ((energy_wh as u128 * SRC_BASIS as u128)
        / required) as u64
}
