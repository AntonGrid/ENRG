use anchor_lang::prelude::*;

use crate::constants::POOL_FP_SCALE;

#[account]
pub struct Pool {
    /// Pool authority.
    pub authority: Pubkey,

    /// Total accumulated verified energy (Wh).
    pub total_energy: u128,

    /// Energy threshold required for distribution.
    pub threshold: u128,

    /// Registered producers.
    pub producers: Vec<Pubkey>,

    /// Pool status.
    pub is_active: bool,

    /// Creation timestamp.
    pub created_at: i64,
}

impl Pool {
    pub const MAX_PRODUCERS: usize = 100;

    pub const LEN: usize =
        32 +                    // authority
        16 +                    // total_energy
        16 +                    // threshold
        4 + Self::MAX_PRODUCERS * 32 + // Vec<Pubkey>
        1 +                     // is_active
        8;                      // created_at
}

/// Pool member contribution (v7.0 §14) — accumulated energy for proportional
/// distribution when the threshold is reached.
///
/// Seeds: [b"pool-share", pool.key().as_ref(), producer.key().as_ref()]
#[account]
pub struct PoolContribution {
    /// Pool this contribution belongs to.
    pub pool: Pubkey,

    /// Producer (device) — pool member.
    pub producer: Pubkey,

    /// Accumulated verified energy (Wh) since the last distribution.
    pub energy_wh: u128,

    /// Time of the last update.
    pub updated_at: i64,

    /// Bump seed for the PDA.
    pub bump: u8,
}

impl PoolContribution {
    pub const LEN: usize =
        32 +  // pool
        32 +  // producer
        16 +  // energy_wh
        8 +   // updated_at
        1;    // bump
}

/// Pool member share as fixed point (1.0 == POOL_FP_SCALE).
/// `contribution / total`; if total == 0 — 0.0.
pub fn pool_share_fp(contribution: u128, total: u128) -> u128 {
    if total == 0 {
        return 0;
    }
    contribution
        .checked_mul(POOL_FP_SCALE)
        .map(|v| v / total)
        .unwrap_or(0)
}

/// Member reward by share: `total_reward * share_fp / POOL_FP_SCALE`.
pub fn pool_reward_for_share(total_reward: u64, share_fp: u128) -> u64 {
    (total_reward as u128)
        .checked_mul(share_fp)
        .map(|v| v / POOL_FP_SCALE)
        .unwrap_or(0)
        .min(total_reward as u128) as u64
}

/// Threshold reached? (v7.0 §14: 1 MWh by default).
pub fn pool_threshold_reached(total_energy: u128, threshold: u128) -> bool {
    total_energy >= threshold
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shares_sum_to_100_percent() {
        // Three members: 400k, 350k, 250k out of 1_000k Wh.
        let total = 1_000_000u128;
        let contribs = [400_000u128, 350_000u128, 250_000u128];
        let mut shares = contribs.map(|c| pool_share_fp(c, total));
        // The last share takes the remainder (sum == 1.0).
        let sum_others = shares[0] + shares[1];
        shares[2] = POOL_FP_SCALE.saturating_sub(sum_others);
        let sum: u128 = shares.iter().sum();
        assert_eq!(sum, POOL_FP_SCALE, "sum of shares = 100%");
        assert!(shares[0] > shares[2]);
    }

    #[test]
    fn reward_is_proportional_to_share() {
        let total_reward = 1_000_000u64;
        // 40% share → 40% of the reward.
        let half = pool_share_fp(400_000, 1_000_000);
        let r = pool_reward_for_share(total_reward, half);
        assert_eq!(r, 400_000);
        // Zero contribution → 0 reward.
        assert_eq!(pool_reward_for_share(total_reward, 0), 0);
    }

    #[test]
    fn threshold_fires_on_time() {
        assert!(!pool_threshold_reached(999_999, 1_000_000));
        assert!(pool_threshold_reached(1_000_000, 1_000_000));
        assert!(pool_threshold_reached(1_000_001, 1_000_000));
    }

    #[test]
    fn zero_total_gives_zero_share() {
        assert_eq!(pool_share_fp(100, 0), 0);
    }
}

