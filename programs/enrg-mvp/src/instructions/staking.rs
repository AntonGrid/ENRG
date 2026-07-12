use anchor_lang::prelude::*;

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
    _ctx: Context<Stake>,
    _amount: u64,
) -> Result<()> {
    Ok(())
}

pub fn unstake(
    _ctx: Context<Unstake>,
    _amount: u64,
) -> Result<()> {
    Ok(())
}

pub fn claim_rewards(
    _ctx: Context<ClaimRewards>,
) -> Result<()> {
    Ok(())
}
