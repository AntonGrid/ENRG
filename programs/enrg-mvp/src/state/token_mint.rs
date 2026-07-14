use anchor_lang::prelude::*;

/// SPL Token Mint configuration.
///
/// This account stores the protocol mint and
/// mint authority configuration.
#[account]
pub struct TokenMint {
    /// SPL Mint account.
    pub mint: Pubkey,

    /// PDA authorized to mint SRC tokens.
    pub mint_authority: Pubkey,

    /// Token decimals.
    pub decimals: u8,

    /// PDA bump.
    pub bump: u8,
}

impl TokenMint {
    pub const LEN: usize =
        32 + // mint
        32 + // mint_authority
        1 +  // decimals
        1;   // bump
}
