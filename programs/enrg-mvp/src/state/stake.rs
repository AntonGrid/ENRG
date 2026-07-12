use anchor_lang::prelude::*;

#[account]
pub struct StakeInfo {
    /// Owner of the stake.
    pub owner: Pubkey,

    /// Amount currently staked.
    pub staked_amount: u64,
}

impl StakeInfo {
    pub const LEN: usize =
        32 + // owner
        8;   // staked_amount
}
