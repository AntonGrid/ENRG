#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("8JEw3eD7NgboNYcQQwoSsTG7UF8RrQpRnJzouDr6XQ8a");

#[program]
pub mod enrg_mvp {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        instructions::initialize::initialize_vault(ctx)
    }

    pub fn initialize_funds(ctx: Context<InitializeFunds>) -> Result<()> {
        instructions::initialize::initialize_funds(ctx)
    }

    pub fn create_producer(
        ctx: Context<CreateProducer>,
        device_id: Pubkey,
        max_power_w: u64,
    ) -> Result<()> {
        instructions::producer::create_producer(
            ctx,
            device_id,
            max_power_w,
        )
    }

    pub fn mint_energy(
        ctx: Context<MintEnergy>,
        proof: state::Proof,
    ) -> Result<()> {
        instructions::mint::mint_energy(ctx, proof)
    }

    pub fn create_pool(
        ctx: Context<CreatePool>,
        threshold: u64,
    ) -> Result<()> {
        instructions::pool::create_pool(ctx, threshold)
    }

    pub fn join_pool(
        ctx: Context<JoinPool>,
    ) -> Result<()> {
        instructions::pool::join_pool(ctx)
    }

    pub fn stake(
        ctx: Context<Stake>,
        amount: u64,
    ) -> Result<()> {
        instructions::staking::stake(ctx, amount)
    }

    pub fn unstake(
        ctx: Context<Unstake>,
        amount: u64,
    ) -> Result<()> {
        instructions::staking::unstake(ctx, amount)
    }

    pub fn claim_rewards(
        ctx: Context<ClaimRewards>,
    ) -> Result<()> {
        instructions::staking::claim_rewards(ctx)
    }

    pub fn buyback_and_burn(
        ctx: Context<BuybackBurn>,
        amount: u64,
    ) -> Result<()> {
        instructions::mint::buyback_and_burn(ctx, amount)
    }

    pub fn initialize_founder_vesting(
        ctx: Context<InitializeFounderVesting>,
        total_amount: u64,
    ) -> Result<()> {
        instructions::vesting::initialize_founder_vesting(
            ctx,
            total_amount,
        )
    }

    pub fn claim_vested(
        ctx: Context<ClaimVested>,
    ) -> Result<()> {
        instructions::vesting::claim_vested(ctx)
    }
}
