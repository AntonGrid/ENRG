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
