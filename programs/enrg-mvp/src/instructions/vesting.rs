use anchor_lang::prelude::*;

use crate::constants::{FOUNDER_VESTING_CLIFF, FOUNDER_VESTING_RELEASE, FOUNDER_WALLET};
use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeFounderVesting<'info> {
    #[account(mut)]
    pub vesting: Account<'info, FounderVesting>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimVested<'info> {
    #[account(mut)]
    pub vesting: Account<'info, FounderVesting>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn initialize_founder_vesting(
    ctx: Context<InitializeFounderVesting>,
    total_amount: u64,
) -> Result<()> {

    // Единый бенефициар founder-вестинга зашит в программу:
    // инициализировать вестинг может только FOUNDER_WALLET.
    require!(
        ctx.accounts.authority.key() == FOUNDER_WALLET,
        ErrorCode::Unauthorized
    );

    let vesting = &mut ctx.accounts.vesting;

    let now = Clock::get()?.unix_timestamp;

    vesting.founder = FOUNDER_WALLET;
    vesting.total_amount = total_amount;
    vesting.start_time = now;
    vesting.cliff = FOUNDER_VESTING_CLIFF;
    vesting.release = FOUNDER_VESTING_RELEASE;
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

    vesting.withdrawn = vested;
    vesting.last_claim = now;

    msg!(
        "Founder claimed {} vested SRC",
        claimable
    );

    Ok(())
}
