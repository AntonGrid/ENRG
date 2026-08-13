use anchor_lang::prelude::*;

#[account]
pub struct FounderVesting {
    /// Founder wallet.
    pub founder: Pubkey,

    /// Total allocated amount (atomic).
    pub total_amount: u64,

    /// Vesting start timestamp.
    pub start_time: i64,

    /// Cliff duration (seconds) — 0 vested until start_time + cliff.
    pub cliff: i64,

    /// Release duration (seconds) — linear after cliff.
    pub release: i64,

    /// Amount already claimed.
    pub withdrawn: u64,

    /// Last claim timestamp.
    pub last_claim: i64,
}

impl FounderVesting {
    pub const LEN: usize =
        32 + // founder
        8  + // total_amount
        8  + // start_time
        8  + // cliff
        8  + // release
        8  + // withdrawn
        8;   // last_claim

    /// Сумма, доступная для claim на момент `now` (cliff + линейный release).
    pub fn vested_at(&self, now: i64) -> u64 {
        vested_at(self.total_amount, self.start_time, self.cliff, self.release, now)
    }
}

/// Чистая функция расчёта вестинга (вынесена для юнит-тестов).
///
/// Правила (фиксированная экономическая модель):
/// - до `start_time + cliff` — 0 (полностью заблокировано);
/// - затем линейно в течение `release` (в среднем 1/36 в месяц при
///   release = 3 года);
/// - после `start_time + cliff + release` — вся сумма разблокирована.
pub fn vested_at(total_amount: u64, start_time: i64, cliff: i64, release: i64, now: i64) -> u64 {
    if release <= 0 {
        return 0;
    }
    let since_start = now.saturating_sub(start_time);
    if since_start < cliff {
        return 0;
    }
    let elapsed_release = (since_start - cliff).min(release);
    ((total_amount as u128) * (elapsed_release as u128) / (release as u128)) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{
        FOUNDER_ALLOCATION_ATOMIC, FOUNDER_VESTING_CLIFF, FOUNDER_VESTING_RELEASE,
        MAX_SUPPLY_ATOMIC,
    };

    const START: i64 = 1_000_000_000;

    #[test]
    fn cliff_blocks_everything() {
        // 1. elapsed < cliff → 0 (полностью заблокировано, ни одной монеты).
        let at = START + FOUNDER_VESTING_CLIFF - 1;
        assert_eq!(
            vested_at(
                FOUNDER_ALLOCATION_ATOMIC,
                START,
                FOUNDER_VESTING_CLIFF,
                FOUNDER_VESTING_RELEASE,
                at
            ),
            0
        );
        // В самом начале (now == start_time) — тоже 0.
        assert_eq!(
            vested_at(
                FOUNDER_ALLOCATION_ATOMIC,
                START,
                FOUNDER_VESTING_CLIFF,
                FOUNDER_VESTING_RELEASE,
                START
            ),
            0
        );
    }

    #[test]
    fn cliff_boundary_is_exclusive() {
        // 2. elapsed == cliff → ещё 0 (граница выключена).
        let at = START + FOUNDER_VESTING_CLIFF;
        assert_eq!(
            vested_at(
                FOUNDER_ALLOCATION_ATOMIC,
                START,
                FOUNDER_VESTING_CLIFF,
                FOUNDER_VESTING_RELEASE,
                at
            ),
            0
        );
    }

    #[test]
    fn half_release_vests_half() {
        // 3. elapsed == cliff + release/2 → vested == total/2.
        let at = START + FOUNDER_VESTING_CLIFF + FOUNDER_VESTING_RELEASE / 2;
        assert_eq!(
            vested_at(
                FOUNDER_ALLOCATION_ATOMIC,
                START,
                FOUNDER_VESTING_CLIFF,
                FOUNDER_VESTING_RELEASE,
                at
            ),
            FOUNDER_ALLOCATION_ATOMIC / 2
        );
    }

    #[test]
    fn full_cycle_unlocks_everything() {
        // 4. elapsed == cliff + release → всё разблокировано; дальше не растёт.
        let at = START + FOUNDER_VESTING_CLIFF + FOUNDER_VESTING_RELEASE;
        assert_eq!(
            vested_at(
                FOUNDER_ALLOCATION_ATOMIC,
                START,
                FOUNDER_VESTING_CLIFF,
                FOUNDER_VESTING_RELEASE,
                at
            ),
            FOUNDER_ALLOCATION_ATOMIC
        );
        let after = at + 1;
        assert_eq!(
            vested_at(
                FOUNDER_ALLOCATION_ATOMIC,
                START,
                FOUNDER_VESTING_CLIFF,
                FOUNDER_VESTING_RELEASE,
                after
            ),
            FOUNDER_ALLOCATION_ATOMIC
        );
    }

    #[test]
    fn one_month_vests_about_1_36() {
        // 5. elapsed == cliff + 1 месяц (30 суток) → ≈ 1/36 от суммы.
        let month_secs = 30 * 24 * 60 * 60; // 2_592_000
        let at = START + FOUNDER_VESTING_CLIFF + month_secs;
        let vested = vested_at(
            FOUNDER_ALLOCATION_ATOMIC,
            START,
            FOUNDER_VESTING_CLIFF,
            FOUNDER_VESTING_RELEASE,
            at,
        );
        // Точное floor-значение линейного расчёта.
        let month_exact = ((FOUNDER_ALLOCATION_ATOMIC as u128 * month_secs as u128)
            / FOUNDER_VESTING_RELEASE as u128) as u64;
        assert_eq!(vested, month_exact, "округление — floor, без потерь");
        assert!(vested > 0);

        // «1/36 в месяц» — приближение: разница не более 2%.
        let one_36 = FOUNDER_ALLOCATION_ATOMIC / 36;
        let diff = vested.abs_diff(one_36);
        assert!(diff <= FOUNDER_ALLOCATION_ATOMIC / 50, "diff={} (допуск 2%)", diff);
    }

    #[test]
    fn premine_fits_supply_cap() {
        // 6. total_supply + 2e17 <= MAX_SUPPLY_ATOMIC (на генезисе total=0).
        assert_eq!(FOUNDER_ALLOCATION_ATOMIC, 200_000_000_000_000_000); // 20% от 1e18
        let genesis_supply = 0u64;
        let new_supply = genesis_supply
            .checked_add(FOUNDER_ALLOCATION_ATOMIC)
            .expect("premine add must not overflow");
        assert!(new_supply <= MAX_SUPPLY_ATOMIC);
    }

    #[test]
    fn supply_after_premine_stays_within_cap() {
        // 9. Эмиссия после премайна (total=2e17) не зашкаливает MAX_SUPPLY_ATOMIC.
        let after_premine = FOUNDER_ALLOCATION_ATOMIC;
        let remaining = MAX_SUPPLY_ATOMIC
            .checked_sub(after_premine)
            .expect("remaining supply must be positive");
        assert!(remaining > 0);
        assert_eq!(after_premine + remaining, MAX_SUPPLY_ATOMIC);
    }

    #[test]
    fn emission_math_sane_after_premine() {
        // 4.2: energy_per_src(2e17) > 0, reward без деления на ноль/переполнения.
        let eps = crate::math::energy_per_src(FOUNDER_ALLOCATION_ATOMIC);
        assert!(eps > 0);
        let reward = crate::math::calculate_reward(1_000_000, FOUNDER_ALLOCATION_ATOMIC);
        assert!(reward > 0);
    }

    #[test]
    fn discriminator_and_len_lock_genesis_layout() {
        // Генезис-аккаунт (tests/genesis/founder-vesting.json) хранит данные
        // 88 байт = 8 (дискриминатор) + 80 (LEN). Любое изменение структуры
        // FounderVesting или имени аккаунта сломает локальную генезис-инъекцию
        // и bootstrap-путь — тест фиксирует layout.
        use anchor_lang::Discriminator;
        assert_eq!(
            FounderVesting::DISCRIMINATOR,
            [0x5e, 0x95, 0x78, 0x1f, 0x24, 0x17, 0x0e, 0xa4],
            "FounderVesting дискриминатор должен совпадать с genesis-файлом"
        );
        assert_eq!(FounderVesting::DISCRIMINATOR.len(), 8);
        assert_eq!(FounderVesting::LEN, 80);
        assert_eq!(8 + FounderVesting::LEN, 88);
    }

    #[test]
    fn claim_transfer_moves_claimable_only() {
        // 8. Симуляция двух claim'ов: founder ATA уменьшается ровно на claimable,
        // destination ATA увеличивается на claimable; суммарно всё разблокировано.
        let total = FOUNDER_ALLOCATION_ATOMIC;
        let mut founder_balance = total; // после премайна
        let mut dest_balance = 0u64;
        let mut withdrawn = 0u64;

        let at1 = START + FOUNDER_VESTING_CLIFF + FOUNDER_VESTING_RELEASE / 2;
        let vested1 = vested_at(total, START, FOUNDER_VESTING_CLIFF, FOUNDER_VESTING_RELEASE, at1);
        let claimable1 = vested1 - withdrawn;
        assert!(claimable1 > 0);
        founder_balance -= claimable1;
        dest_balance += claimable1;
        withdrawn = vested1;
        assert_eq!(founder_balance, total - vested1);
        assert_eq!(dest_balance, vested1);

        let at2 = START + FOUNDER_VESTING_CLIFF + FOUNDER_VESTING_RELEASE;
        let vested2 = vested_at(total, START, FOUNDER_VESTING_CLIFF, FOUNDER_VESTING_RELEASE, at2);
        let claimable2 = vested2 - withdrawn;
        assert!(claimable2 > 0);
        founder_balance -= claimable2;
        dest_balance += claimable2;
        withdrawn = vested2;

        assert_eq!(founder_balance, 0);
        assert_eq!(dest_balance, total);
        assert_eq!(withdrawn, total);
    }
}

