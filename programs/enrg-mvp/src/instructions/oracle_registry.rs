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

/// Rotate the OracleRegistry ROOT authority — the role that can appoint a new
/// `oracle_admin` (and therefore the whole trusted-oracle set).
///
/// WHY THIS INSTRUCTION EXISTS (audit 2026-09-16): the role used to be assigned
/// once in `initialize_oracle_registry` (= `EXPECTED_DEPLOYER`) with **no way to
/// transfer it**. A leaked or compromised root authority could neither be evicted
/// nor replaced, and it can always re-take `oracle_admin` via `set_oracle_admin`
/// — so rotating `oracle_admin` alone is cosmetic. Key rotation is a hard
/// requirement of ADR-0007 and of the mainnet key ceremony.
///
/// Authorization: the CURRENT `registry.authority` must sign (the outgoing key
/// approves its own replacement), so nobody can self-appoint.
///
/// Single-step with an event, consistent with `set_vault_authority` /
/// `set_policy_authority`. A two-step (pending + accept) flow needs an extra
/// account field and therefore an account migration — tracked in
/// MAINNET-CHECKLIST.md.
#[derive(Accounts)]
pub struct SetOracleRegistryAuthority<'info> {
    #[account(
        mut,
        seeds = [b"oracle-registry"],
        bump,
        constraint = registry.authority == authority.key() @ ErrorCode::NotOracleAuthority
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

/// Transfer the OracleRegistry root authority to `new_authority`
/// (see `SetOracleRegistryAuthority` for the rationale).
pub fn set_oracle_registry_authority(
    ctx: Context<SetOracleRegistryAuthority>,
    new_authority: Pubkey,
) -> Result<()> {
    require!(
        new_authority != Pubkey::default(),
        ErrorCode::InvalidParameter
    );

    let registry = &mut ctx.accounts.registry;
    let old_authority = registry.authority;
    registry.authority = new_authority;

    emit!(OracleRegistryAuthorityChanged {
        old_authority,
        new_authority,
        changed_by: ctx.accounts.authority.key(),
    });

    msg!(
        "Oracle registry authority changed: {} -> {}",
        old_authority,
        new_authority
    );

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
