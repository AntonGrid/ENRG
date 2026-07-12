use anchor_lang::prelude::*;

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
