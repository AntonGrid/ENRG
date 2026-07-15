use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeOracleRegistry<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + OracleRegistry::LEN,
        seeds = [b"oracle-registry"],
        bump
    )]
    pub registry: Account<'info, OracleRegistry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddOracle<'info> {
    #[account(
        mut,
        seeds = [b"oracle-registry"],
        bump
    )]
    pub registry: Account<'info, OracleRegistry>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RemoveOracle<'info> {
    #[account(
        mut,
        seeds = [b"oracle-registry"],
        bump
    )]
    pub registry: Account<'info, OracleRegistry>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn initialize_oracle_registry(
    ctx: Context<InitializeOracleRegistry>,
) -> Result<()> {

    let registry = &mut ctx.accounts.registry;

    registry.authority = ctx.accounts.authority.key();
    registry.oracles = Vec::new();

    Ok(())
}

pub fn add_oracle(
    ctx: Context<AddOracle>,
    oracle: Pubkey,
) -> Result<()> {

    let registry = &mut ctx.accounts.registry;

    require!(
        registry.authority == ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );

    require!(
        !registry.oracles.contains(&oracle),
        ErrorCode::AlreadyExists
    );

    require!(
        registry.oracles.len() < OracleRegistry::MAX_ORACLES,
        ErrorCode::InvalidParameter
    );

    registry.oracles.push(oracle);

    emit!(OracleAdded { oracle });

    Ok(())
}

pub fn remove_oracle(
    ctx: Context<RemoveOracle>,
    oracle: Pubkey,
) -> Result<()> {

    let registry = &mut ctx.accounts.registry;

    require!(
        registry.authority == ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );

    let index = registry
        .oracles
        .iter()
        .position(|x| *x == oracle)
        .ok_or(ErrorCode::NotFound)?;

    registry.oracles.remove(index);

    emit!(OracleRemoved { oracle });

    Ok(())
}
