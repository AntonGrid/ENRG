use anchor_lang::prelude::*;
use crate::state::TokenMint;

/// Initialize SPL Token subsystem.
///
/// Package 2 (Bootstrap).
///
/// This instruction will later:
/// - create TokenMint PDA;
/// - create SRC Mint;
/// - assign Mint Authority PDA;
/// - save token configuration.
///
/// Currently this is only a placeholder.
#[derive(Accounts)]
pub struct InitializeToken<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + TokenMint::LEN,
        seeds = [b"token-mint"],
        bump
    )]
    pub token_mint: Account<'info, TokenMint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_token(
    _ctx: Context<InitializeToken>,
) -> Result<()> {
    Ok(())
}
