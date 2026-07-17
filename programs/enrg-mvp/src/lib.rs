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

declare_id!("8JEw3eD7NgboNYcQQwoSsTG7UF8RrQpRnJzouDr6XQ8a");

#[program]
pub mod enrg_mvp {
    use super::*;

    // ═══════════════════════════════════════════
    //  PHASE 1 — Protocol Initialization
    // ═══════════════════════════════════════════

    /// Initialize SRC Mint + TokenMint PDA + MintAuthority PDA.
    pub fn initialize_token(
        ctx: Context<InitializeToken>,
    ) -> Result<()> {
        instructions::initialize_token::initialize_token(ctx)
    }

    /// Initialize global Vault PDA (protocol economics).
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
    ) -> Result<()> {
        instructions::initialize::initialize_vault(ctx)
    }

    /// Initialize TokenMint fund addresses (buyback, staking, DAO, emergency).
    pub fn initialize_funds(
        ctx: Context<InitializeFunds>,
    ) -> Result<()> {
        instructions::initialize::initialize_funds(ctx)
    }

    /// Initialize Config PDA (active oracle + mint binding).
    pub fn init_config(
        ctx: Context<InitConfig>,
        oracle: Pubkey,
        mint: Pubkey,
    ) -> Result<()> {
        instructions::init_config::init_config(ctx, oracle, mint)
    }

    /// Initialize Oracle Registry PDA.
    pub fn initialize_oracle_registry(
        ctx: Context<InitializeOracleRegistry>,
    ) -> Result<()> {
        instructions::oracle_registry::initialize_oracle_registry(ctx)
    }

    // ═══════════════════════════════════════════
    //  PHASE 2 — Oracle Management
    // ═══════════════════════════════════════════

    /// Add a trusted Oracle to the Registry.
    pub fn add_oracle(
        ctx: Context<AddOracle>,
        oracle: Pubkey,
    ) -> Result<()> {
        instructions::oracle_registry::add_oracle(ctx, oracle)
    }

    /// Remove a trusted Oracle from the Registry.
    pub fn remove_oracle(
        ctx: Context<RemoveOracle>,
        oracle: Pubkey,
    ) -> Result<()> {
        instructions::oracle_registry::remove_oracle(ctx, oracle)
    }

    // ═══════════════════════════════════════════
    //  PHASE 3 — Producer Management
    // ═══════════════════════════════════════════

    /// Register a new energy producer (physical device).
    pub fn create_producer(
        ctx: Context<CreateProducer>,
        device_id: Pubkey,
        max_power_w: u64,
    ) -> Result<()> {
        instructions::producer::create_producer(ctx, device_id, max_power_w)
    }

    // ═══════════════════════════════════════════
    //  PHASE 4 — Energy Minting
    // ═══════════════════════════════════════════

    /// Submit a verified proof and mint SRC tokens.
    pub fn mint_energy(
        ctx: Context<MintEnergy>,
        report: state::OracleReport,
    ) -> Result<()> {
        instructions::mint::mint_energy(ctx, report)
    }

    // ═══════════════════════════════════════════
    //  PHASE 5 — Pool Management
    // ═══════════════════════════════════════════

    /// Create a new energy pool.
    pub fn create_pool(
        ctx: Context<CreatePool>,
        threshold: u64,
    ) -> Result<()> {
        instructions::pool::create_pool(ctx, threshold)
    }

    /// Join an existing energy pool.
    pub fn join_pool(
        ctx: Context<JoinPool>,
    ) -> Result<()> {
        instructions::pool::join_pool(ctx)
    }

    // ═══════════════════════════════════════════
    //  PHASE 6 — Staking & Rewards
    // ═══════════════════════════════════════════

    /// Stake SRC tokens.
    pub fn stake(
        ctx: Context<Stake>,
        amount: u64,
    ) -> Result<()> {
        instructions::staking::stake(ctx, amount)
    }

    /// Unstake SRC tokens.
    pub fn unstake(
        ctx: Context<Unstake>,
        amount: u64,
    ) -> Result<()> {
        instructions::staking::unstake(ctx, amount)
    }

    /// Claim staking rewards.
    pub fn claim_rewards(
        ctx: Context<ClaimRewards>,
    ) -> Result<()> {
        instructions::staking::claim_rewards(ctx)
    }

    // ═══════════════════════════════════════════
    //  PHASE 7 — Founder Vesting
    // ═══════════════════════════════════════════

    /// Initialize founder vesting schedule.
    pub fn initialize_founder_vesting(
        ctx: Context<InitializeFounderVesting>,
        total_amount: u64,
    ) -> Result<()> {
        instructions::vesting::initialize_founder_vesting(ctx, total_amount)
    }

    /// Claim vested SRC tokens.
    pub fn claim_vested(
        ctx: Context<ClaimVested>,
    ) -> Result<()> {
        instructions::vesting::claim_vested(ctx)
    }

    // ═══════════════════════════════════════════
    //  PHASE 8 — Token Economics
    // ═══════════════════════════════════════════

    /// Buyback and burn SRC tokens from the buyback fund.
    pub fn buyback_and_burn(
        ctx: Context<BuybackAndBurn>,
        amount: u64,
    ) -> Result<()> {
        instructions::buyback::buyback_and_burn(ctx, amount)
    }

    // ═══════════════════════════════════════════
    //  FUTURE — Device Lifecycle (Package 3+)
    // ═══════════════════════════════════════════

    // /// Register a physical device in the Device Registry.
    // pub fn register_device(ctx: Context<RegisterDevice>, ...) -> Result<()> { ... }
    //
    // /// Revoke a device from the registry.
    // pub fn revoke_device(ctx: Context<RevokeDevice>, ...) -> Result<()> { ... }
    //
    // /// Update device firmware manifest.
    // pub fn update_manifest(ctx: Context<UpdateManifest>, ...) -> Result<()> { ... }
}
