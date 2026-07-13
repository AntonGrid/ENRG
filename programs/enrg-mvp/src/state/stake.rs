use anchor_lang::prelude::*;

#[account]
pub struct StakeInfo {
    /// Owner of the stake.
    pub owner: Pubkey,

    /// Amount currently staked.
    pub staked_amount: u64,

    /// Pending rewards.
    pub pending_rewards: u64,

    /// Stake creation timestamp.
    pub started_at: i64,

    /// Last rewards update.
    pub last_update: i64,
}

impl StakeInfo {
    pub const LEN: usize =
        32 + // owner
        8  + // staked_amount
        8  + // pending_rewards
        8  + // started_at
        8;   // last_update
}
