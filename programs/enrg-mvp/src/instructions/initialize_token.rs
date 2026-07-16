use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::constants::*;
use crate::state::TokenMint;

/// Initialize SPL Token subsystem.
///
/// Package 2.1
///
/// Creates:
/// - SRC Mint (SPL Token Mint)
/// - Mint Authority PDA (dedicated mint-to signer)
/// - TokenMint PDA (configuration storage)
///
/// Mint Authority PDA has ONLY one responsibility:
/// executing token::mint_to().
/// It does NOT hold tokens, does NOT own Treasury,
/// does NOT own Token Accounts.
#[derive(Accounts)]
pub struct InitializeToken<'info> {
    /// TokenMint PDA — stores all token configuration.
    #[account(
        init,
        payer = authority,
        space = 8 + TokenMint::LEN,
        seeds = [b"token-mint"],
        bump
    )]
    pub token_mint: Account<'info, TokenMint>,

    /// SRC Mint — the protocol token.
    #[account(
        init,
        payer = authority,
        seeds = [b"src-mint"],
        bump,
        mint::decimals = SRC_DECIMALS,
        mint::authority = mint_authority,
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: Mint Authority PDA is used solely as a signer for token::mint_to().
    /// Security is enforced by seed derivation matching TokenMint.mint_authority.
    #[account(
        mut,
        seeds = [b"mint-authority"],
        bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_token(ctx: Context<InitializeToken>) -> Result<()> {
    let token_mint = &mut ctx.accounts.token_mint;

    let mint_bump = ctx.bumps.mint;
    let mint_authority_bump = ctx.bumps.mint_authority;
    let token_mint_bump = ctx.bumps.token_mint;

    // Store all token configuration
    token_mint.mint = ctx.accounts.mint.key();
    token_mint.mint_authority = ctx.accounts.mint_authority.key();
    token_mint.decimals = SRC_DECIMALS;
    token_mint.mint_bump = mint_bump;
    token_mint.mint_authority_bump = mint_authority_bump;
    token_mint.bump = token_mint_bump;

    // Token Accounts (buyback, staking, dao, emergency)
    // are initialized separately in Package 2.2 (InitializeFunds)
    // with Vault PDA as their token::authority.
    token_mint.buyback_account = Pubkey::default();
    token_mint.staking_account = Pubkey::default();
    token_mint.dao_account = Pubkey::default();
    token_mint.emergency_account = Pubkey::default();

    Ok(())
}
