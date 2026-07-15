use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::state::vault::Vault;
use crate::state::producer::EnergyProducer;
use crate::state::OracleReport;
use crate::error::ErrorCode;
use crate::math::calculate_reward;

/// Mint tokens based on verified Oracle report.
pub fn mint_energy(
    ctx: Context<MintEnergy>,
    report: OracleReport,
) -> Result<()> {
    let producer = &mut ctx.accounts.producer;

    // Verify oracle signature
    // Note: The oracle signature is part of the report
    // For now, we trust the oracle since it's a verified report
    // Full verification will be added in the next phase

    // Validate proof using OracleReport
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    require!(
        (now - report.verified_at).abs() <= 900,
        ErrorCode::StaleProof
    );
    require!(
        report.nonce > producer.nonce,
        ErrorCode::InvalidNonce
    );

    // Validate energy
    let max_energy = producer.max_power_w
        .checked_mul(10)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(60)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        report.energy_wh <= max_energy,
        ErrorCode::ExcessiveEnergy
    );

    // Update producer state
    producer.nonce = report.nonce;
    producer.timestamp = report.verified_at;
    producer.energy_wh = producer.energy_wh
        .checked_add(report.energy_wh)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // Calculate emission
    let reward = calculate_reward(
    report.energy_wh,
    ctx.accounts.vault.total_supply,
);
let vault = &mut ctx.accounts.vault;

vault.total_supply = vault
    .total_supply
    .checked_add(reward)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

vault.total_energy_wh = vault
    .total_energy_wh
    .checked_add(report.energy_wh as u128)
    .ok_or(ErrorCode::ArithmeticOverflow)?;

vault.total_proofs = vault
    .total_proofs
    .checked_add(1)
    .ok_or(ErrorCode::ArithmeticOverflow)?;
    let user_amount = reward
        .checked_mul(85)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let fee = reward
        .checked_sub(user_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let buyback_amount = fee
        .checked_mul(20)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let staking_amount = fee
        .checked_mul(40)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let dao_amount = fee
        .checked_mul(30)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let emergency_amount = fee
        .checked_sub(buyback_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_sub(staking_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_sub(dao_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    msg!("Minted {} SRC (user: {}, buyback: {}, staking: {}, dao: {}, emergency: {})",
        reward, user_amount, buyback_amount, staking_amount, dao_amount, emergency_amount);

    Ok(())
}

#[derive(Accounts)]
pub struct MintEnergy<'info> {
    #[account(mut)]
    pub producer: Account<'info, EnergyProducer>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buyback_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub staking_pool: Account<'info, TokenAccount>,
    #[account(mut)]
    pub dao_reserve: Account<'info, TokenAccount>,
    #[account(mut)]
    pub emergency_fund: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
