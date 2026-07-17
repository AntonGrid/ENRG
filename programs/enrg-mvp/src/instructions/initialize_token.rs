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
/// - Fund-buyback PDA (dedicated authority for buyback Account)
/// - TokenMint PDA (configuration storage)
///
/// Mint Authority PDA has ONLY one responsibility:
/// executing token::mint_to().
/// Fund-buyback PDA has ONLY one responsibility:
/// signing burn() from the buyback account.
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
    #[account(
        mut,
        seeds = [b"mint-authority"],
        bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// CHECK: Fund-buyback PDA signs for burning tokens from buyback_account.
    /// Seeds: ["fund-buyback"]. Bump stored in TokenMint.buyback_authority_bump.
    #[account(
        mut,
        seeds = [b"fund-buyback"],
        bump,
    )]
    pub buyback_authority: UncheckedAccount<'info>,

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
    let buyback_authority_bump = ctx.bumps.buyback_authority;
    let token_mint_bump = ctx.bumps.token_mint;

    // Store all token configuration
    token_mint.mint = ctx.accounts.mint.key();
    token_mint.mint_authority = ctx.accounts.mint_authority.key();
    token_mint.decimals = SRC_DECIMALS;
    token_mint.mint_bump = mint_bump;
    token_mint.mint_authority_bump = mint_authority_bump;
    token_mint.buyback_authority_bump = buyback_authority_bump;
    token_mint.bump = token_mint_bump;

    // Token Accounts (buyback, staking, dao, emergency)
    // are initialized separately in Package 2.2 (InitializeFunds)
    // with their respective fund PDAs as token::authority.
    token_mint.buyback_account = Pubkey::default();
    token_mint.staking_account = Pubkey::default();
    token_mint.dao_account = Pubkey::default();
    token_mint.emergency_account = Pubkey::default();

    Ok(())
}
