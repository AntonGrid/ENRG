use anchor_lang::prelude::*;

use crate::constants::{ERS_MAX_SCORE, ERS_PREMIUM_THRESHOLD};

/// Energy Reputation Score (v7.0 §16).
///
/// Репутационный PDA на производителя (владельца). Учитывает:
/// - длительность безотказной работы (uptime),
/// - объём верифицированной энергии,
/// - отсутствие аномалий профиля генерации (штрафы через `report_anomaly`).
///
/// Высокий ERS даёт преимущество при распределении наград в пуле
/// (взвешивание долей, см. pool.rs) и доступ к премиальным функциям
/// ENRG Market (v7.0 §16, §30) — `ers_premium_eligible`.
///
/// Seeds: [b"reputation", authority.key().as_ref()]
#[account]
#[derive(InitSpace)]
pub struct Reputation {
    /// Владелец устройства (authority), чей score учитывается.
    pub authority: Pubkey,

    /// Текущий балл ERS (0..=ERS_MAX_SCORE).
    pub score: u32,

    /// Время последнего обновления.
    pub updated_at: i64,

    /// Суммарная верифицированная энергия (Wh) — вклад в score.
    pub total_energy_wh: u64,

    /// Первое появление (unix ts) — основа расчёта uptime.
    pub first_seen: i64,

    /// Количество зафиксированных аномалий профиля (v7.0 §27).
    pub anomaly_count: u32,

    /// Приближённый процентиль сети (0..=100; on-chain аппроксимация).
    pub percentile: u8,

    /// Bump seed для PDA.
    pub bump: u8,
}

impl Default for Reputation {
    fn default() -> Self {
        Self {
            authority: Pubkey::default(),
            score: 0,
            updated_at: 0,
            total_energy_wh: 0,
            first_seen: 0,
            anomaly_count: 0,
            percentile: 0,
            bump: 0,
        }
    }
}

/// Базовый «репутационный» балл за отсутствие аномалий (стартовая надёжность).
pub const ERS_BASE_SCORE: u32 = 200;

/// 1 балл ERS за каждые 2 МВт·ч верифицированной энергии (кап 500 баллов).
const ERS_ENERGY_WH_PER_POINT: u64 = 2_000_000;
const ERS_ENERGY_POINTS_CAP: u32 = 500;

/// 1 балл ERS за каждый день uptime (кап 300 баллов).
const ERS_UPTIME_POINTS_CAP: u32 = 300;

/// Пересчёт балла ERS по фактическим метрикам (чистая функция, v7.0 §16):
///
/// ```text
/// score = min(ERS_MAX_SCORE,
///             ERS_BASE_SCORE + min(500, total_energy_wh / 2_000_000)
///                           + min(300, uptime_secs / 86400))
/// ```
///
/// Монотонна по энергии и uptime; кап ERS_MAX_SCORE (1000).
pub fn compute_ers_score(total_energy_wh: u64, uptime_secs: i64) -> u32 {
    let uptime_days = (uptime_secs.max(0) as u64) / 86_400;
    let energy_pts = (total_energy_wh / ERS_ENERGY_WH_PER_POINT)
        .min(ERS_ENERGY_POINTS_CAP as u64) as u32;
    let uptime_pts = uptime_days.min(ERS_UPTIME_POINTS_CAP as u64) as u32;
    ERS_BASE_SCORE
        .saturating_add(energy_pts)
        .saturating_add(uptime_pts)
        .min(ERS_MAX_SCORE)
}

/// Штраф за аномалию профиля (v7.0 §27): severity 1..=10,
/// снижение на 5% за уровень (severity 10 = −50%).
pub fn apply_anomaly_penalty(score: u32, severity: u8) -> u32 {
    let sev = severity.clamp(1, 10) as u32;
    let cut_percent = (5u32).saturating_mul(sev).min(50);
    score.saturating_sub(score.saturating_mul(cut_percent) / 100)
}

/// Премиум-доступ к ENRG Market (v7.0 §16, §30): score >= порога.
pub fn ers_premium_eligible(score: u32) -> bool {
    score >= ERS_PREMIUM_THRESHOLD
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_score_and_growth() {
        assert_eq!(compute_ers_score(0, 0), ERS_BASE_SCORE);
        // 2 МВт·ч → +1 балл.
        assert_eq!(compute_ers_score(2_000_000, 0), ERS_BASE_SCORE + 1);
        // 30 дней uptime → +30 баллов.
        assert_eq!(compute_ers_score(0, 30 * 86_400), ERS_BASE_SCORE + 30);
        // Капы: энергия и uptime не раздувают score выше ERS_MAX_SCORE.
        assert_eq!(
            compute_ers_score(u64::MAX, i64::MAX),
            ERS_MAX_SCORE,
            "score capped at 1000"
        );
    }

    #[test]
    fn anomaly_penalizes_score() {
        let score = 800;
        let after = apply_anomaly_penalty(score, 1);
        assert_eq!(after, 760, "severity 1 → −5%");
        let hard = apply_anomaly_penalty(score, 10);
        assert_eq!(hard, 400, "severity 10 → −50%");
        // Не может уйти в минус.
        assert_eq!(apply_anomaly_penalty(10, 10), 5);
    }

    #[test]
    fn premium_access_threshold() {
        assert!(ers_premium_eligible(ERS_PREMIUM_THRESHOLD));
        assert!(ers_premium_eligible(900));
        assert!(!ers_premium_eligible(ERS_PREMIUM_THRESHOLD - 1));
    }
}
