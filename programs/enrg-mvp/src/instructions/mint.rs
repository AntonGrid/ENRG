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
    proof: Proof,
) -> Result<()> {

    let producer = &mut ctx.accounts.producer;
    let vault = &mut ctx.accounts.vault;

    require!(
        producer.authority == ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );

    verify_nonce(
        producer,
        proof.nonce,
    )?;

    verify_timestamp(
        proof.timestamp,
    )?;

    verify_energy(
        producer,
        proof.energy_wh,
    )?;

    let reward = math::calculate_reward(
        proof.energy_wh,
        vault.total_supply,
    );

    let emission =
        token::calculate_distribution(reward)?;

    producer.nonce = proof.nonce;
    producer.timestamp = proof.timestamp;

    producer.energy_wh = producer
        .energy_wh
        .checked_add(proof.energy_wh)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    producer.signature = proof.signature;

    vault.total_energy_wh = vault
        .total_energy_wh
        .checked_add(proof.energy_wh as u128)
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
        "Accepted proof {} ({} Wh)",
        proof.nonce,
        proof.energy_wh
    );

    msg!(
        "Reward: {}",
        emission.reward
    );

    msg!(
        "Producer: {}",
        emission.producer
    );

    msg!(
        "Buyback: {}",
        emission.buyback
    );

    msg!(
        "Staking: {}",
        emission.staking
    );

    msg!(
        "DAO: {}",
        emission.dao
    );

    msg!(
        "Emergency: {}",
        emission.emergency
    );

    msg!(
        "Total supply: {}",
        vault.total_supply
    );

    Ok(())
}

pub fn buyback_and_burn(
    _ctx: Context<BuybackBurn>,
    _amount: u64,
) -> Result<()> {
    Ok(())
}
