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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emission_share_zero_supply() {
        assert_eq!(emission_share(0), 0.0);
    }

    #[test]
    fn emission_share_half_supply() {
        assert_eq!(emission_share(500_000_000), 0.5);
    }

    #[test]
    fn emission_share_full_supply() {
        assert_eq!(emission_share(MAX_SUPPLY), 1.0);
    }

    #[test]
    fn energy_per_src_increases() {
        let e0 = energy_per_src(0);
        let e50 = energy_per_src(500_000_000);
        let e90 = energy_per_src(900_000_000);

        assert!(e50 > e0);
        assert!(e90 > e50);
    }

    #[test]
    fn reward_decreases_as_supply_grows() {
        let r0 = calculate_reward(10_000_000, 0);
        let r50 = calculate_reward(10_000_000, 500_000_000);
        let r90 = calculate_reward(10_000_000, 900_000_000);

        assert!(r0 > r50);
        assert!(r50 > r90);
    }

    #[test]
    fn zero_energy_returns_zero_reward() {
        assert_eq!(
            calculate_reward(0, 0),
            0
        );
    }
}
