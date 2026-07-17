use crate::constants::*;

/// Returns current emission progress [0.0 .. 1.0].
pub fn emission_share(total_supply: u64) -> f64 {
    total_supply as f64 / MAX_SUPPLY as f64
}

/// Returns current asymptotic difficulty coefficient.
pub fn emission_difficulty(total_supply: u64) -> f64 {
    let share = emission_share(total_supply);
    (EMISSION_DIFFICULTY_K as f64).powf(share)
}

/// Returns Wh required for one SRC unit (in SRC_BASIS terms).
pub fn energy_per_src(total_supply: u64) -> u128 {
    (INITIAL_ENERGY_PER_SRC as f64 * emission_difficulty(total_supply)) as u128
}

/// Returns the dynamic difficulty multiplier for a specific device.
///
/// Формула: множитель = 1 + log10(доля_устройства + 1)
/// где доля_устройства = device_energy_30d / network_energy_30d.
///
/// При network_energy_30d == 0 возвращает 1.0.
/// Множитель всегда ≥ 1.0.
pub fn device_difficulty_multiplier(device_energy_30d: u64, network_energy_30d: u128) -> f64 {
    if network_energy_30d == 0 {
        return 1.0;
    }
    let share = device_energy_30d as f64 / network_energy_30d as f64;
    1.0 + (share + 1.0).log10()
}

/// Returns effective energy_per_src for a specific device (base × multiplier).
pub fn effective_energy_per_src(
    total_supply: u64,
    device_energy_30d: u64,
    network_energy_30d: u128,
) -> u128 {
    let base = energy_per_src(total_supply);
    let multiplier = device_difficulty_multiplier(device_energy_30d, network_energy_30d);
    (base as f64 * multiplier) as u128
}

/// Converts verified energy into SRC units (in SRC_BASIS).
pub fn reward_for_energy(energy_wh: u64, energy_per_src: u128) -> u64 {
    if energy_per_src == 0 {
        return 0;
    }
    ((energy_wh as u128 * SRC_BASIS as u128) / energy_per_src) as u64
}

/// Convenience wrapper — uses global difficulty only (original).
pub fn calculate_reward(energy_wh: u64, total_supply: u64) -> u64 {
    reward_for_energy(energy_wh, energy_per_src(total_supply))
}

/// Reward calculation with dynamic difficulty per device.
pub fn calculate_reward_dynamic(
    energy_wh: u64,
    total_supply: u64,
    device_energy_30d: u64,
    network_energy_30d: u128,
) -> u64 {
    let eps = effective_energy_per_src(total_supply, device_energy_30d, network_energy_30d);
    reward_for_energy(energy_wh, eps)
}

/// Updates sliding-window energy counter (u64).
/// Если прошло >= 30 дней — сброс; иначе — накопление.
pub fn update_energy_window(current_energy: u64, last_update: i64, now: i64, new_energy: u64) -> u64 {
    const THIRTY_DAYS: i64 = 30 * 24 * 60 * 60;
    if last_update == 0 || now - last_update >= THIRTY_DAYS {
        new_energy
    } else {
        current_energy.saturating_add(new_energy)
    }
}

/// Updates sliding-window energy counter (u128 — для сети).
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
        assert_eq!(emission_share(0), 0.0);
        assert_eq!(emission_share(500_000_000), 0.5);
        assert_eq!(emission_share(MAX_SUPPLY), 1.0);
    }

    #[test]
    fn difficulty_increases() {
        assert!(energy_per_src(500_000_000) > energy_per_src(0));
        assert!(energy_per_src(900_000_000) > energy_per_src(500_000_000));
    }

    #[test]
    fn zero_energy_no_reward() {
        assert_eq!(calculate_reward(0, 0), 0);
    }

    #[test]
    fn dynamic_multiplier_basics() {
        let m = device_difficulty_multiplier(0, 0);
        assert!((m - 1.0).abs() < 1e-10);

        let m_small = device_difficulty_multiplier(1_000, 1_000_000);
        let m_large = device_difficulty_multiplier(500_000, 1_000_000);
        assert!(m_large > m_small);
        assert!(m_small >= 1.0);
    }

    #[test]
    fn large_device_gets_less_reward() {
        let r_small = calculate_reward_dynamic(10_000_000, 0, 1_000, 1_000_000);
        let r_large = calculate_reward_dynamic(10_000_000, 0, 500_000, 1_000_000);
        assert!(r_large <= r_small);
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
}
