use anchor_lang::prelude::*;

use crate::constants::{ERS_MAX_SCORE, ERS_PREMIUM_THRESHOLD};

/// Energy Reputation Score (v7.0 §16).
///
/// Reputation PDA for a producer (owner). Takes into account:
/// - uptime without failures,
/// - volume of verified energy,
/// - absence of generation profile anomalies (penalties via `report_anomaly`).
///
/// A high ERS provides an advantage in pool reward distribution
/// (share weighting, see pool.rs) and access to premium features of
/// ENRG Market (v7.0 §16, §30) — `ers_premium_eligible`.
///
/// Seeds: [b"reputation", authority.key().as_ref()]
#[account]
#[derive(InitSpace)]
pub struct Reputation {
    /// Device owner (authority) whose score is tracked.
    pub authority: Pubkey,

    /// Current ERS score (0..=ERS_MAX_SCORE).
    pub score: u32,

    /// Time of the last update.
    pub updated_at: i64,

    /// Total verified energy (Wh) — contribution to the score.
    pub total_energy_wh: u64,

    /// First appearance (unix ts) — basis for uptime calculation.
    pub first_seen: i64,

    /// Number of recorded profile anomalies (v7.0 §27).
    pub anomaly_count: u32,

    /// Approximate network percentile (0..=100; on-chain approximation).
    pub percentile: u8,

    /// Bump seed for the PDA.
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

/// Base "reputation" score for absence of anomalies (starting reliability).
pub const ERS_BASE_SCORE: u32 = 200;

/// 1 ERS point per 2 MWh of verified energy (cap 500 points).
const ERS_ENERGY_WH_PER_POINT: u64 = 2_000_000;
const ERS_ENERGY_POINTS_CAP: u32 = 500;

/// 1 ERS point per day of uptime (cap 300 points).
const ERS_UPTIME_POINTS_CAP: u32 = 300;

/// Recompute the ERS score from actual metrics (pure function, v7.0 §16):
///
/// ```text
/// score = min(ERS_MAX_SCORE,
///             ERS_BASE_SCORE + min(500, total_energy_wh / 2_000_000)
///                           + min(300, uptime_secs / 86400))
/// ```
///
/// Monotonic in energy and uptime; capped at ERS_MAX_SCORE (1000).
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

/// Penalty for a profile anomaly (v7.0 §27): severity 1..=10,
/// 5% reduction per level (severity 10 = −50%).
pub fn apply_anomaly_penalty(score: u32, severity: u8) -> u32 {
    let sev = severity.clamp(1, 10) as u32;
    let cut_percent = (5u32).saturating_mul(sev).min(50);
    score.saturating_sub(score.saturating_mul(cut_percent) / 100)
}

/// Premium access to ENRG Market (v7.0 §16, §30): score >= threshold.
pub fn ers_premium_eligible(score: u32) -> bool {
    score >= ERS_PREMIUM_THRESHOLD
}

/// ERS bonus for pool distribution (v7.0 §16): 0%..=20% in fixed
/// point. Grows linearly from 0 at score=0 to +20% at ERS_MAX_SCORE.
pub fn ers_pool_bonus_fp(score: u32) -> u128 {
    let score = score.min(ERS_MAX_SCORE) as u128;
    // (score / ERS_MAX_SCORE) * 20%  = score * (FP/5) / ERS_MAX_SCORE
    (score.saturating_mul(crate::math::FP_SCALE / 5)) / (ERS_MAX_SCORE as u128)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_score_and_growth() {
        assert_eq!(compute_ers_score(0, 0), ERS_BASE_SCORE);
        // 2 MWh → +1 point.
        assert_eq!(compute_ers_score(2_000_000, 0), ERS_BASE_SCORE + 1);
        // 30 days of uptime → +30 points.
        assert_eq!(compute_ers_score(0, 30 * 86_400), ERS_BASE_SCORE + 30);
        // Caps: energy and uptime cannot inflate the score above ERS_MAX_SCORE.
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
        // Cannot go negative.
        assert_eq!(apply_anomaly_penalty(10, 10), 5);
    }

    #[test]
    fn premium_access_threshold() {
        assert!(ers_premium_eligible(ERS_PREMIUM_THRESHOLD));
        assert!(ers_premium_eligible(900));
        assert!(!ers_premium_eligible(ERS_PREMIUM_THRESHOLD - 1));
    }
}
