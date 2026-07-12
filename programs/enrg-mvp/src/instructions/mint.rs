use anchor_lang::prelude::*;

use crate::state::*;

#[derive(Accounts)]
pub struct MintEnergy<'info> {
    #[account(mut)]
    pub producer: Account<'info, EnergyProducer>,

    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct BuybackBurn<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn mint_energy(
    _ctx: Context<MintEnergy>,
    _proof: Proof,
) -> Result<()> {
    Ok(())
}

pub fn buyback_and_burn(
    _ctx: Context<BuybackBurn>,
    _amount: u64,
) -> Result<()> {
    Ok(())
}
