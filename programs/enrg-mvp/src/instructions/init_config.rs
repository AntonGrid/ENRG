use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::Config;

/// Initialize Config PDA (active oracle + mint binding).
///
/// Stores the working pair (oracle + mint) that the protocol
/// uses at any given time. Can only be called once.
#[derive(Accounts)]
pub struct InitConfig<'info> {
    /// Config PDA — stores active oracle and mint.
    #[account(
        init,
        payer = authority,
        space = 8 + Config::LEN,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    /// Protocol authority.
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn init_config(
    ctx: Context<InitConfig>,
    oracle: Pubkey,
    mint: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    require!(
        oracle != Pubkey::default(),
        ErrorCode::InvalidParameter
    );
    require!(
        mint != Pubkey::default(),
        ErrorCode::InvalidParameter
    );

    config.authority = ctx.accounts.authority.key();
    config.oracle = oracle;
    config.mint = mint;
    config.bump = ctx.bumps.config;

    msg!("Config initialized: oracle={}, mint={}", oracle, mint);

    emit!(ConfigInitialized {
        authority: ctx.accounts.authority.key(),
        oracle,
        mint,
    });

    Ok(())
}

/// Event emitted when Config is initialized.
#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub oracle: Pubkey,
    pub mint: Pubkey,
}
