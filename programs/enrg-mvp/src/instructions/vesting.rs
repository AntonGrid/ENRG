use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{
    FOUNDER_ALLOCATION_ATOMIC, FOUNDER_VESTING_CLIFF, FOUNDER_VESTING_RELEASE, FOUNDER_WALLET,
};
use crate::error::ErrorCode;
use crate::state::*;

/// Bootstrap path for FounderVesting.
///
/// The account can be obtained in two ways (backward compatible):
/// 1. **Genesis/pre-seed** (localnet `solana-test-validator --account`,
///    file `tests/genesis/founder-vesting.json`): the account already exists at
///    `findProgramAddress([b"founder-vesting"])` and belongs to the program —
///    `init_if_needed` skips initialization and the fields are overwritten.
/// 2. **On-chain bootstrap** (Devnet/mainnet): the account is absent — `init_if_needed`
///    creates it via the program with the same seed (payer = founder); the handler
///    then fills the fields. No external genesis injection is required.
#[derive(Accounts)]
pub struct InitializeFounderVesting<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + FounderVesting::LEN,
        seeds = [b"founder-vesting"],
        bump,
    )]
    pub vesting: Account<'info, FounderVesting>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimVested<'info> {
    #[account(mut)]
    pub vesting: Account<'info, FounderVesting>,

    /// Source — the same founder ATA where the premine was minted
    /// (owner — FOUNDER_WALLET). Tokens cannot be withdrawn from anywhere else.
    #[account(
        mut,
        constraint = founder_ata.owner == FOUNDER_WALLET
            @ ErrorCode::Unauthorized
    )]
    pub founder_ata: Account<'info, TokenAccount>,

    /// Destination — the founder wallet ATA.
    #[account(mut)]
    pub destination_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn initialize_founder_vesting(
    ctx: Context<InitializeFounderVesting>,
) -> Result<()> {

    // The single founder-vesting beneficiary is hard-coded into the program:
    // only FOUNDER_WALLET can initialize the vesting.
    require!(
        ctx.accounts.authority.key() == FOUNDER_WALLET,
        ErrorCode::Unauthorized
    );

    let vesting = &mut ctx.accounts.vesting;
    let now = Clock::get()?.unix_timestamp;

    vesting.founder = FOUNDER_WALLET;
    vesting.total_amount = FOUNDER_ALLOCATION_ATOMIC; // 2e17 hard-coded
    vesting.start_time = now;
    vesting.cliff = FOUNDER_VESTING_CLIFF;      // 1 year
    vesting.release = FOUNDER_VESTING_RELEASE;  // 3 years
    vesting.withdrawn = 0;
    vesting.last_claim = now;

    Ok(())
}

pub fn claim_vested(
    ctx: Context<ClaimVested>,
) -> Result<()> {

    let vesting = &mut ctx.accounts.vesting;

    require!(
        vesting.founder == ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );

    let now = Clock::get()?.unix_timestamp;

    // Cliff + linear release (pure function from state::vesting).
    let vested = vesting.vested_at(now);

    require!(
        vested >= vesting.withdrawn,
        ErrorCode::ArithmeticOverflow
    );

    let claimable = vested
        .checked_sub(vesting.withdrawn)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    require!(
        claimable > 0,
        ErrorCode::NothingToClaim
    );

    // ACTUAL transfer from founder_ata to destination_ata.
    // authority (Signer = FOUNDER_WALLET) signs the transfer because
    // founder_ata belongs to FOUNDER_WALLET. The source is strictly founder_ata
    // (created and funded only by the premine), the amount is capped by vested —
    // early withdrawal is impossible.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.founder_ata.to_account_info(),
                to: ctx.accounts.destination_ata.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        claimable,
    )?;

    vesting.withdrawn = vested;
    vesting.last_claim = now;

    msg!(
        "Founder transferred {} SRC (atomic), withdrawn_total={}",
        claimable, vested
    );

    Ok(())
}
