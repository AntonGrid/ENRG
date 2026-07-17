#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod adapters;
pub mod constants;
pub mod error;
pub mod instructions;
pub mod math;
pub mod security;
pub mod state;

use instructions::*;

declare_id!("6MNBcnmuYZLzs2womcMua3MRDBVh4ZcK958D5gNR8oTm");

#[program]
pub mod enrg_mvp {
    use super::*;

    // ═══════════════════════════════════════════
    //  PHASE 1 — Protocol Initialization
    // ═══════════════════════════════════════════

    pub fn initialize_token(
        ctx: Context<InitializeToken>,
    ) -> Result<()> {
        instructions::initialize_token::initialize_token(ctx)
    }

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
    ) -> Result<()> {
        instructions::initialize::initialize_vault(ctx)
    }

    pub fn initialize_funds(
        ctx: Context<InitializeFunds>,
    ) -> Result<()> {
        instructions::initialize::initialize_funds(ctx)
    }

    pub fn init_config(
        ctx: Context<InitConfig>,
        oracle: Pubkey,
        mint: Pubkey,
    ) -> Result<()> {
        instructions::init_config::init_config(ctx, oracle, mint)
    }

    pub fn initialize_oracle_registry(
        ctx: Context<InitializeOracleRegistry>,
    ) -> Result<()> {
        instructions::oracle_registry::initialize_oracle_registry(ctx)
    }

    // ═══════════════════════════════════════════
    //  PHASE 2 — Oracle Management
    // ═══════════════════════════════════════════

    pub fn add_oracle(
        ctx: Context<AddOracle>,
        oracle: Pubkey,
    ) -> Result<()> {
        instructions::oracle_registry::add_oracle(ctx, oracle)
    }

    pub fn remove_oracle(
        ctx: Context<RemoveOracle>,
        oracle: Pubkey,
    ) -> Result<()> {
        instructions::oracle_registry::remove_oracle(ctx, oracle)
    }

    // ═══════════════════════════════════════════
    //  PHASE 3 — Producer Management
    // ═══════════════════════════════════════════

    pub fn create_producer(
        ctx: Context<CreateProducer>,
        device_id: Pubkey,
    ) -> Result<()> {
        instructions::producer::create_producer(ctx, device_id)
    }

    // ═══════════════════════════════════════════
    //  PHASE 4 — Energy Minting
    // ═══════════════════════════════════════════

    pub fn mint_energy(
        ctx: Context<MintEnergy>,
        report: state::OracleReport,
    ) -> Result<()> {
        instructions::mint::mint_energy(ctx, report)
    }

    // ═══════════════════════════════════════════
    //  PHASE 5 — Pool Management
    // ═══════════════════════════════════════════

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

    // ═══════════════════════════════════════════
    //  PHASE 6 — Staking & Rewards
    // ═══════════════════════════════════════════

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

    // ═══════════════════════════════════════════
    //  PHASE 7 — Founder Vesting
    // ═══════════════════════════════════════════

    pub fn initialize_founder_vesting(
        ctx: Context<InitializeFounderVesting>,
        total_amount: u64,
    ) -> Result<()> {
        instructions::vesting::initialize_founder_vesting(ctx, total_amount)
    }

    pub fn claim_vested(
        ctx: Context<ClaimVested>,
    ) -> Result<()> {
        instructions::vesting::claim_vested(ctx)
    }

    // ═══════════════════════════════════════════
    //  PHASE 8 — Token Economics
    // ═══════════════════════════════════════════

    pub fn buyback_and_burn(
        ctx: Context<BuybackAndBurn>,
        amount: u64,
    ) -> Result<()> {
        instructions::buyback::buyback_and_burn(ctx, amount)
    }

    // ═══════════════════════════════════════════
    //  PHASE 9 — Device Lifecycle (ADR-0005)
    // ═══════════════════════════════════════════

    pub fn register_device(
        ctx: Context<RegisterDevice>,
    ) -> Result<()> {
        instructions::device_lifecycle::register_device(ctx)
    }

    pub fn claim_device(
        ctx: Context<ClaimDevice>,
    ) -> Result<()> {
        instructions::device_lifecycle::claim_device(ctx)
    }

    pub fn provision_device(
        ctx: Context<ProvisionDevice>,
    ) -> Result<()> {
        instructions::device_lifecycle::provision_device(ctx)
    }

    pub fn activate_device(
        ctx: Context<ActivateDevice>,
    ) -> Result<()> {
        instructions::device_lifecycle::activate_device(ctx)
    }

    pub fn quarantine_device(
        ctx: Context<QuarantineDevice>,
    ) -> Result<()> {
        instructions::device_lifecycle::quarantine_device(ctx)
    }

    pub fn release_from_quarantine(
        ctx: Context<ReleaseFromQuarantine>,
    ) -> Result<()> {
        instructions::device_lifecycle::release_from_quarantine(ctx)
    }

    pub fn revoke_device(
        ctx: Context<RevokeDevice>,
    ) -> Result<()> {
        instructions::device_lifecycle::revoke_device(ctx)
    }
}
