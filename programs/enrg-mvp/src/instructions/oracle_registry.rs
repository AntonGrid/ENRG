use anchor_lang::prelude::*;

use crate::constants::EXPECTED_DEPLOYER;
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
        bump,
        constraint = registry.oracle_admin == authority.key() @ ErrorCode::Unauthorized
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
        bump,
        constraint = registry.oracle_admin == authority.key() @ ErrorCode::Unauthorized
    )]
    pub registry: Account<'info, OracleRegistry>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

/// Change oracle_admin. Only the protocol admin (registry.authority) can do it.
/// NOTE: there is no separate timelock/two-step pattern yet — the role changes
/// instantly with an event; the multisig plan is recorded in comments (BLOCK 2).
#[derive(Accounts)]
pub struct SetOracleAdmin<'info> {
    #[account(
        mut,
        seeds = [b"oracle-registry"],
        bump,
        constraint = registry.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub registry: Account<'info, OracleRegistry>,

    pub authority: Signer<'info>,
}

pub fn initialize_oracle_registry(
    ctx: Context<InitializeOracleRegistry>,
) -> Result<()> {
    // H-2: only EXPECTED_DEPLOYER can be the first registry initializer —
    // otherwise an attacker could take the oracle_admin role and add their key
    // to the trusted oracle list (front-running at deploy time).
    require!(
        ctx.accounts.authority.key() == EXPECTED_DEPLOYER,
        ErrorCode::UnauthorizedDeployer
    );

    let registry = &mut ctx.accounts.registry;

    registry.authority = ctx.accounts.authority.key();
    // By default oracle_admin = authority (backward-compatible bootstrap).
    registry.oracle_admin = ctx.accounts.authority.key();
    registry.oracles = Vec::new();

    Ok(())
}

pub fn set_oracle_admin(
    ctx: Context<SetOracleAdmin>,
    new_oracle_admin: Pubkey,
) -> Result<()> {

    require!(
        new_oracle_admin != Pubkey::default(),
        ErrorCode::InvalidParameter
    );

    let registry = &mut ctx.accounts.registry;
    let old_oracle_admin = registry.oracle_admin;
    registry.oracle_admin = new_oracle_admin;

    emit!(OracleAdminChanged {
        old_oracle_admin,
        new_oracle_admin,
        changed_by: ctx.accounts.authority.key(),
    });

    Ok(())
}

pub fn add_oracle(
    ctx: Context<AddOracle>,
    oracle: Pubkey,
) -> Result<()> {

    let registry = &mut ctx.accounts.registry;

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

    let index = registry
        .oracles
        .iter()
        .position(|x| *x == oracle)
        .ok_or(ErrorCode::NotFound)?;

    registry.oracles.remove(index);

    emit!(OracleRemoved { oracle });

    Ok(())
}
