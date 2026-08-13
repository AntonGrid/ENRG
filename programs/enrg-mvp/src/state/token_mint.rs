use anchor_lang::prelude::*;

/// SPL Token configuration.
///
/// Stores the protocol mint configuration and
/// all protocol-owned token accounts.
#[account]
pub struct TokenMint {
    /// SRC Mint.
    pub mint: Pubkey,

    /// PDA allowed to mint SRC.
    pub mint_authority: Pubkey,

    /// Buyback fund ATA.
    pub buyback_account: Pubkey,

    /// Staking rewards ATA.
    pub staking_account: Pubkey,

    /// DAO treasury ATA.
    pub dao_account: Pubkey,

    /// Emergency reserve ATA.
    pub emergency_account: Pubkey,

    /// Founder ATA — куда минтятся founder-токены при launch (премайн).
    pub founder_account: Pubkey,

    /// Одноразовый флаг: 1 после founder-премайна (повторный запрещён).
    pub founder_minted: u8,

    /// Token decimals.
    pub decimals: u8,

    /// SRC Mint PDA bump.
    pub mint_bump: u8,

    /// Mint Authority PDA bump.
    pub mint_authority_bump: u8,

    /// Buyback Authority PDA bump.
    pub buyback_authority_bump: u8,

    /// TokenMint PDA bump.
    pub bump: u8,
}

impl TokenMint {
    pub const LEN: usize =
        32 + // mint
        32 + // mint_authority
        32 + // buyback_account
        32 + // staking_account
        32 + // dao_account
        32 + // emergency_account
        32 + // founder_account
        1  + // founder_minted
        1  + // decimals
        1  + // mint_bump
        1  + // mint_authority_bump
        1  + // buyback_authority_bump
        1;   // bump
}

/// Возвращает true, если founder-премайн ещё не производился.
/// (Вынесено для юнит-теста одноразовости.)
pub fn founder_premine_not_minted(founder_minted: u8) -> bool {
    founder_minted == 0
}
