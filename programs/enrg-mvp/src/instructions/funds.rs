use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::error::ErrorCode;
use crate::state::*;

/// Protocol fund tags for `withdraw_fund` (single withdrawal pattern).
pub const FUND_BUYBACK: u8 = 0;
pub const FUND_STAKING: u8 = 1;
pub const FUND_DAO: u8 = 2;
pub const FUND_EMERGENCY: u8 = 3;

/// Withdraw already-issued SRC from a protocol fund ATA to a recipient ATA.
///
/// This is a transfer, not a mint: no new tokens are created.
/// Managed by a single pattern for all four funds
/// (buyback / staking / dao / emergency) via the `fund_tag` argument.
///
/// AUTHORIZATION (temporary): until separate governance exists, the governor
/// role is played by Vault.authority (see audit BLOCK 2 — set_authority and
/// the multisig/timelock plan). TODO(audit): replace Vault.authority with a
/// dedicated governor / multisig once governance is in place.
#[derive(Accounts)]
pub struct WithdrawFund<'info> {
    /// Vault PDA — global protocol state (authority check).
    #[account(
        seeds = [b"vault"],
        bump,
        constraint = vault.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub vault: Box<Account<'info, Vault>>,

    /// TokenMint PDA — holds the fund ATA addresses.
    #[account(
        seeds = [b"token-mint"],
        bump = token_mint.bump
    )]
    pub token_mint: Box<Account<'info, TokenMint>>,

    /// Temporary governor — Vault.authority.
    pub authority: Signer<'info>,

    /// ATA of the specific fund (withdrawal source).
    #[account(mut)]
    pub fund_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: the fund PDA — owner of `fund_account`, signs the CPI transfer
    /// via seeds. The tag match is checked in the handler.
    pub fund_authority: UncheckedAccount<'info>,

    /// Recipient ATA (for the same mint).
    #[account(mut)]
    pub destination: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn withdraw_fund(ctx: Context<WithdrawFund>, fund_tag: u8, amount: u64) -> Result<()> {
    // ── Authorization: Vault.authority as temporary governor ──
    require!(
        ctx.accounts.vault.authority == ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );
    require!(amount > 0, ErrorCode::ZeroAmountMint);

    let token_mint = &ctx.accounts.token_mint;

    // ── Determine the seed and the expected ATA by the fund tag ──
    let (seed, expected_fund_account) = match fund_tag {
        FUND_BUYBACK => (b"fund-buyback".as_ref(), token_mint.buyback_account),
        FUND_STAKING => (b"fund-staking".as_ref(), token_mint.staking_account),
        FUND_DAO => (b"fund-dao".as_ref(), token_mint.dao_account),
        FUND_EMERGENCY => (b"fund-emergency".as_ref(), token_mint.emergency_account),
        _ => return Err(ErrorCode::InvalidParameter.into()),
    };

    // ── The fund must be the one recorded in TokenMint for this tag ──
    require!(
        ctx.accounts.fund_account.key() == expected_fund_account,
        ErrorCode::InvalidParameter
    );

    // ── fund_authority must be the fund PDA and the ATA must belong to it ──
    let (fund_pda, fund_bump) = Pubkey::find_program_address(&[seed], ctx.program_id);
    require!(
        ctx.accounts.fund_authority.key() == fund_pda,
        ErrorCode::InvalidParameter
    );
    require!(
        ctx.accounts.fund_account.owner == fund_pda,
        ErrorCode::Unauthorized
    );

    // ── The recipient must be an ATA of the same mint ──
    require!(
        ctx.accounts.destination.mint == ctx.accounts.fund_account.mint,
        ErrorCode::InvalidParameter
    );

    // ── Limit by the fund balance ──
    require!(
        ctx.accounts.fund_account.amount >= amount,
        ErrorCode::InsufficientStake
    );

    // ── CPI transfer: fund (fund PDA) -> recipient ──
    let signer_seeds: &[&[u8]] = &[seed, &[fund_bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.fund_account.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.fund_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
    )?;

    emit!(FundsWithdrawn {
        fund_tag,
        amount,
        to: ctx.accounts.destination.key(),
        by: ctx.accounts.authority.key(),
    });

    msg!(
        "Funds withdrawn: tag={}, amount={}, to={}",
        fund_tag,
        amount,
        ctx.accounts.destination.key()
    );

    Ok(())
}
