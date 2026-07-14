use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::instructions::token;
use crate::math;
use crate::security::{
    verify_energy,
    verify_nonce,
    verify_timestamp,
};
use crate::state::*;

#[derive(Accounts)]
pub struct MintEnergy<'info> {
    #[account(mut)]
    pub producer: Account<'info, EnergyProducer>,

    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(
        seeds = [b"oracle-registry"],
        bump
    )]
    pub oracle_registry: Account<'info, OracleRegistry>,

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
    ctx: Context<MintEnergy>,
    report: OracleReport,
) -> Result<()> {

    let producer = &mut ctx.accounts.producer;
    let vault = &mut ctx.accounts.vault;
    let registry = &ctx.accounts.oracle_registry;

    require!(
        registry.contains(&report.oracle),
        ErrorCode::Unauthorized
    );

    require!(
        producer.authority == ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );

    verify_nonce(
        producer,
        report.nonce,
    )?;

    verify_timestamp(
        report.device_timestamp,
    )?;

    verify_energy(
        producer,
        report.energy_wh,
    )?;

    let reward = math::calculate_reward(
        report.energy_wh,
        vault.total_supply,
    );

    let emission =
        token::calculate_distribution(reward)?;

    producer.nonce = report.nonce;
    producer.timestamp = report.device_timestamp;

    producer.energy_wh = producer
        .energy_wh
        .checked_add(report.energy_wh)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    producer.signature = report.device_signature;

    vault.total_energy_wh = vault
        .total_energy_wh
        .checked_add(report.energy_wh as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    vault.total_proofs = vault
        .total_proofs
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    vault.total_supply = vault
        .total_supply
        .checked_add(emission.reward)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    msg!(
        "Accepted report {} ({} Wh)",
        report.nonce,
        report.energy_wh
    );

    msg!("Oracle: {}", report.oracle);
    msg!("Device: {}", report.device_id);
    msg!("Reward: {}", emission.reward);
    msg!("Producer: {}", emission.producer);
    msg!("Buyback: {}", emission.buyback);
    msg!("Staking: {}", emission.staking);
    msg!("DAO: {}", emission.dao);
    msg!("Emergency: {}", emission.emergency);
    msg!("Total supply: {}", vault.total_supply);

    Ok(())
}

pub fn buyback_and_burn(
    _ctx: Context<BuybackBurn>,
    _amount: u64,
) -> Result<()> {
    Ok(())
}
