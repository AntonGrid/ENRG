use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub stake_info: Account<'info, StakeInfo>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub stake_info: Account<'info, StakeInfo>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut)]
    pub stake_info: Account<'info, StakeInfo>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn stake(
    ctx: Context<Stake>,
    amount: u64,
) -> Result<()> {

    let stake = &mut ctx.accounts.stake_info;

    require!(
        stake.owner == ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );

    let now = Clock::get()?.unix_timestamp;

    if stake.started_at == 0 {
        stake.started_at = now;
    }

    stake.last_update = now;

    stake.staked_amount = stake
        .staked_amount
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    Ok(())
}

pub fn unstake(
    ctx: Context<Unstake>,
    amount: u64,
) -> Result<()> {

    let stake = &mut ctx.accounts.stake_info;

    require!(
        stake.owner == ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );

    require!(
        stake.staked_amount >= amount,
        ErrorCode::InsufficientStake
    );

    stake.last_update = Clock::get()?.unix_timestamp;

    stake.staked_amount = stake
        .staked_amount
        .checked_sub(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    Ok(())
}

pub fn claim_rewards(
    ctx: Context<ClaimRewards>,
) -> Result<()> {

    let stake = &mut ctx.accounts.stake_info;

    require!(
        stake.owner == ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );

    require!(
        stake.pending_rewards > 0,
        ErrorCode::NothingToClaim
    );

    stake.pending_rewards = 0;
    stake.last_update = Clock::get()?.unix_timestamp;

    Ok(())
}
