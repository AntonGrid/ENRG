use anchor_lang::prelude::*;

#[account]
pub struct FounderVesting {
    /// Founder wallet.
    pub founder: Pubkey,

    /// Total allocated amount.
    pub total_amount: u64,

    /// Vesting start timestamp.
    pub start_time: i64,

    /// Amount already claimed.
    pub withdrawn: u64,
}

impl FounderVesting {
    pub const LEN: usize =
        32 + // founder
        8 +  // total_amount
        8 +  // start_time
        8;   // withdrawn
}
