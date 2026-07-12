use anchor_lang::prelude::*;

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
    _ctx: Context<InitializeFounderVesting>,
    _total_amount: u64,
) -> Result<()> {
    Ok(())
}

pub fn claim_vested(
    _ctx: Context<ClaimVested>,
) -> Result<()> {
    Ok(())
}
