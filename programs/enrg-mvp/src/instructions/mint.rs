use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::ErrorCode;
use crate::math::calculate_reward_dynamic;
use crate::security::verify_ed25519_signature;
use crate::security::validation::{verify_nonce, verify_timestamp};
use crate::state::*;

/// Mint SRC tokens based on verified Oracle report.
///
/// Verifies the device Ed25519 signature before minting.
/// Device metadata (max_power_w) and sliding energy window
/// are managed by enrg-profile via CPI — this instruction
/// calls profile::record_production() after minting.
///
/// NOTE (ADR-0003 conformance): Axis spec separates the Verifier
/// (cryptography + data transfer) from the Policy Engine (decisions on
/// Proof admissibility, quarantine, minting). In this Solana MVP the
/// verifier and policy checks are co-located on-chain: whitelist of
/// trusted oracles (OracleRegistry), device state gating (can_mint),
/// energy limits, timestamp freshness and supply cap are all enforced
/// here. This is a documented simplification acceptable for MVP;
/// a separate off-chain Policy Engine (or on-chain PolicyRegistry
/// governed per ADR-0009) can be introduced later without changing
/// the trust pipeline.
pub fn mint_energy(ctx: Context<MintEnergy>, report: OracleReport) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    let vault = &mut ctx.accounts.vault;

    // ── Clock: используется для freshness и tier-окна ──
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // ── Device State check (ADR-0005) + tier-лимит месяца (v7.0 §15) ──
    producer.roll_month(now);
    require!(
        producer.can_mint(now),
        ErrorCode::InvalidDeviceState
    );

    // ══ C-0: оракул должен быть доверенным (OracleRegistry) ══
    require!(
        ctx.accounts.oracle_registry.contains(&report.oracle),
        ErrorCode::UntrustedOracle
    );

    // ══ C-1: отчёт должен принадлежать именно этому устройству ══
    require!(
        producer.device_id == report.device_id,
        ErrorCode::DeviceMismatch
    );

    // ══ C-2: signer обязан быть владельцем producer'а (authority) ══
    require!(
        producer.authority == ctx.accounts.authority.key(),
        ErrorCode::NotProducerOwner
    );

    // ── Ed25519 signature verification (device) ──
    // Устройство подписывает (device_id, nonce, device_timestamp, energy_wh).
    let device_message = report.device_message_to_sign()?;

    verify_ed25519_signature(
        &report.device_signature,
        &report.device_id.to_bytes(),
        &device_message,
        &ctx.accounts.instructions.to_account_info(),
    )?;

    // ── Oracle signature verification (authenticity of the report) ──
    // Оракул подписывает (device_id, nonce, device_timestamp, verified_at, energy_wh).
    // Без этой подписи любой вызывающий мог бы выдать себя за доверенного
    // оракула, просто указав его pubkey в поле report.oracle.
    let oracle_message = report.oracle_message_to_sign()?;

    verify_ed25519_signature(
        &report.oracle_signature,
        &report.oracle.to_bytes(),
        &oracle_message,
        &ctx.accounts.instructions.to_account_info(),
    )?;

    // ── Proof validation: timestamp & nonce ──
    verify_timestamp(now, report.verified_at)?;
    verify_nonce(producer, report.nonce)?;

    // ── Tier increment check (v7.0 §15): отчёт не должен выходить за лимит месяца ──
    if let Some(limit) = producer.tier.monthly_limit_wh() {
        require!(
            producer.month_energy_wh.checked_add(report.energy_wh).map_or(false, |v| v <= limit),
            ErrorCode::TierLimitExceeded
        );
    }

    // ── Energy validation ──
    let max_energy = ctx.accounts.profile.rated_power;
    require!(report.energy_wh <= max_energy, ErrorCode::ExcessiveEnergy);

    // ── Update network sliding window ──
    let now_ts = clock.unix_timestamp;
    vault.network_energy_30d = crate::math::update_energy_window_u128(
        vault.network_energy_30d,
        vault.network_energy_updated_at,
        now_ts,
        report.energy_wh as u128,
    );
    vault.network_energy_updated_at = now_ts;

    // ── CPI: record_production в enrg-profile ──
    let profile_ctx = CpiContext::new(
        ctx.accounts.profile_program.to_account_info(),
        crate::enrg_profile::cpi::accounts::RecordProduction {
            authority: ctx.accounts.authority.to_account_info(),
            profile: ctx.accounts.profile.to_account_info(),
        },
    );
    crate::enrg_profile::cpi::record_production(profile_ctx, report.energy_wh, now_ts)?;

    // ── Update producer state ──
    producer.nonce = report.nonce;
    producer.timestamp = report.verified_at;
    producer.energy_wh = producer
        .energy_wh
        .checked_add(report.energy_wh)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    producer.month_energy_wh = producer
        .month_energy_wh
        .checked_add(report.energy_wh)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // ── Calculate reward with dynamic difficulty ──
    let device_energy_30d = ctx.accounts.profile.device_energy_30d as u64;
    let reward = calculate_reward_dynamic(
        report.energy_wh,
        vault.total_supply,
        device_energy_30d,
        vault.network_energy_30d,
    );
    msg!(
        "DEBUG reward={} energy_wh={} total_supply={} device_30d={} network_30d={}",
        reward,
        report.energy_wh,
        vault.total_supply,
        device_energy_30d,
        vault.network_energy_30d,
    );

    // Никаких "пустых" минтов
    require!(reward > 0, ErrorCode::ZeroAmountMint);

    // ── Check supply cap ──
    let new_supply = vault
        .total_supply
        .checked_add(reward)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(new_supply <= vault.max_supply, ErrorCode::ArithmeticOverflow);

    // ── Calculate distributions ──
    let user_amount = reward
        .checked_mul(85)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let fee = reward
        .checked_sub(user_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let buyback_amount = fee
        .checked_mul(BUYBACK_PERCENT)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let staking_amount = fee
        .checked_mul(STAKING_PERCENT)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let dao_amount = fee
        .checked_mul(DAO_PERCENT)
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

    // ── Mint tokens via Mint Authority PDA ──
    let mint_authority_seeds = &[
        b"mint-authority".as_ref(),
        &[ctx.accounts.token_mint.mint_authority_bump],
    ];
    let signer_seeds = &[&mint_authority_seeds[..]];
    let token_program = ctx.accounts.token_program.to_account_info();

    token::mint_to(
        CpiContext::new(
            token_program.clone(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        user_amount,
    )?;

    token::mint_to(
        CpiContext::new(
            token_program.clone(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.buyback_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        buyback_amount,
    )?;

    token::mint_to(
        CpiContext::new(
            token_program.clone(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.staking_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        staking_amount,
    )?;

    token::mint_to(
        CpiContext::new(
            token_program.clone(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.dao_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        dao_amount,
    )?;

    token::mint_to(
        CpiContext::new(
            token_program.clone(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.emergency_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        emergency_amount,
    )?;

    // ── Update vault state ──
    vault.total_supply = new_supply;
    vault.total_energy_wh = vault
        .total_energy_wh
        .checked_add(report.energy_wh as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    vault.total_proofs = vault
        .total_proofs
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // ── Emit events ──
    emit!(ProofAccepted {
        producer: producer.key(),
        oracle: report.oracle,
        device_id: report.device_id,
        nonce: report.nonce,
        energy_wh: report.energy_wh,
    });

    emit!(RewardDistributed {
        producer: producer.key(),
        reward,
        buyback: buyback_amount,
        staking: staking_amount,
        dao: dao_amount,
        emergency: emergency_amount,
    });

    let energy_per_token = crate::math::energy_per_src(vault.total_supply);
    let supply_fraction = (vault.total_supply as u128)
        .checked_mul(1_000_000_000_000_000_000u128)
        .and_then(|v| v.checked_div(MAX_SUPPLY_ATOMIC as u128))
        .unwrap_or(0);

    emit!(EmissionDifficultyChanged {
        current_supply: vault.total_supply,
        supply_fraction,
        energy_per_token,
    });

    msg!(
        "Minted {} SRC (user: {}, buyback: {}, staking: {}, dao: {}, emergency: {})",
        reward,
        user_amount,
        buyback_amount,
        staking_amount,
        dao_amount,
        emergency_amount
    );

    // ── ERS (v7.0 §16): обновляем репутацию, если аккаунт передан ──
    if let Some(reputation) = &mut ctx.accounts.reputation {
        crate::instructions::reputation::update_reputation_after_mint(
            reputation,
            report.energy_wh,
            now,
        )?;
        emit!(ReputationUpdated {
            reputation: reputation.key(),
            score: reputation.score,
            total_energy_wh: reputation.total_energy_wh,
        });
    }

    Ok(())
}

#[derive(Accounts)]
pub struct MintEnergy<'info> {
    #[account(mut)]
    pub producer: Account<'info, EnergyProducer>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        seeds = [b"token-mint"],
        bump = token_mint.bump
    )]
    pub token_mint: Box<Account<'info, TokenMint>>,

    #[account(
        mut,
        seeds = [b"src-mint"],
        bump = token_mint.mint_bump,
        constraint = mint.key() == token_mint.mint @ ErrorCode::InvalidParameter
    )]
    pub mint: Box<Account<'info, Mint>>,

    /// CHECK: Mint Authority PDA is a dedicated signer for token::mint_to().
    #[account(
        seeds = [b"mint-authority"],
        bump = token_mint.mint_authority_bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// C-2: user token account должен принадлежать authority (владельцу producer'а).
    #[account(
        mut,
        constraint = user_token_account.owner == authority.key() @ ErrorCode::UnauthorizedTokenAccountOwner,
    )]
    pub user_token_account: Box<Account<'info, TokenAccount>>,

    /// Протокольный buyback-фонд — жёстко привязан к конфигурации TokenMint.
    #[account(
        mut,
        constraint = buyback_account.key() == token_mint.buyback_account @ ErrorCode::InvalidParameter
    )]
    pub buyback_account: Box<Account<'info, TokenAccount>>,

    /// Протокольный staking-фонд — жёстко привязан к конфигурации TokenMint.
    #[account(
        mut,
        constraint = staking_account.key() == token_mint.staking_account @ ErrorCode::InvalidParameter
    )]
    pub staking_account: Box<Account<'info, TokenAccount>>,

    /// Протокольный DAO-фонд — жёстко привязан к конфигурации TokenMint.
    #[account(
        mut,
        constraint = dao_account.key() == token_mint.dao_account @ ErrorCode::InvalidParameter
    )]
    pub dao_account: Box<Account<'info, TokenAccount>>,

    /// Протокольный emergency-фонд — жёстко привязан к конфигурации TokenMint.
    #[account(
        mut,
        constraint = emergency_account.key() == token_mint.emergency_account @ ErrorCode::InvalidParameter
    )]
    pub emergency_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: Sysvar instructions — используется для проверки Ed25519-подписи.
    #[account(
        constraint = instructions.key() == crate::constants::INSTRUCTIONS_SYSVAR_ID @ ErrorCode::InvalidInstructionsAccount
    )]
    pub instructions: UncheckedAccount<'info>,

    /// Trusted Oracle Registry (whitelist of oracles, ADR-0003 / ADR-0006).
    #[account(
        seeds = [b"oracle-registry"],
        bump
    )]
    pub oracle_registry: Account<'info, OracleRegistry>,

    pub token_program: Program<'info, Token>,

    // ── CPI: enrg-profile ──
    /// CHECK: on-chain enrg-profile program (единственная разрешённая CPI-цель).
    #[account(
        constraint = profile_program.key() == crate::constants::ENRG_PROFILE_PROGRAM_ID @ ErrorCode::InvalidParameter
    )]
    pub profile_program: UncheckedAccount<'info>,

    /// Authority of the EnergyProfile (producer's owner).
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"profile", authority.key().as_ref()],
        bump,
        seeds::program = profile_program.key()
    )]
    pub profile: Account<'info, crate::enrg_profile::accounts::EnergyProfile>,

    /// ERS (v7.0 §16) — опционально: если передан, обновляется после минта.
    #[account(
        mut,
        seeds = [b"reputation", authority.key().as_ref()],
        bump = reputation.bump
    )]
    pub reputation: Option<Account<'info, Reputation>>,
}
