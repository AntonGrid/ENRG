use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::ErrorCode;
use crate::math::calculate_reward_dynamic;
use crate::security::verify_ed25519_signature;
use crate::security::validation::verify_nonce;
use crate::state::*;

/// Mint SRC tokens based on verified Oracle report.
///
/// Verifies the device Ed25519 signature before minting.
/// Device metadata (max_power_w) and sliding energy window
/// are managed by enrg-profile via CPI — this instruction
/// calls profile::record_production() after minting.
pub fn mint_energy(ctx: Context<MintEnergy>, report: OracleReport) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    msg!("DEBUG mint_energy STARTED");
    let vault = &mut ctx.accounts.vault;

    // ── Device State check (ADR-0005) ──
    require!(
        producer.state.can_mint(),
        ErrorCode::InvalidDeviceState
    );

    // ── Ed25519 signature verification (MVP: формат зафиксирован, проверка заглушена) ──
    let message = report.message_to_sign()?;

    verify_ed25519_signature(
        &report.device_signature,
        &report.device_id.to_bytes(),
        &message,
        &ctx.accounts.instructions.to_account_info(),
    )?;

    // ── Proof validation: time (логируем) & nonce ──
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    msg!(
        "DEBUG PROOF now={} verified_at={} (timestamp check TEMPORARILY DISABLED ON-CHAIN)",
        now,
        report.verified_at,
    );

    // Nonce validation (near-prod: строгий рост).
    msg!(
        "DEBUG NONCE report={} producer={}",
        report.nonce,
        producer.nonce
    );
    verify_nonce(producer, report.nonce)?;

    // ── Energy validation ──
    // max_power_w читается из EnergyProfile PDA (enrg-profile).
    // Используем захардкоженный лимит как fallback, пока Profile не развёрнут.
    // TODO: заменить на CPI-чтение profile.metadata.rated_power после интеграции enrg-profile.
    let max_energy: u64 = 1_000_000_000; // временный лимит ~1 GWh за репорт

    require!(report.energy_wh <= max_energy, ErrorCode::ExcessiveEnergy);

    // ── Update network sliding window (глобальная метрика Core) ──
    let now_ts = clock.unix_timestamp;

    vault.network_energy_30d = crate::math::update_energy_window_u128(
        vault.network_energy_30d,
        vault.network_energy_updated_at,
        now_ts,
        report.energy_wh as u128,
    );
    vault.network_energy_updated_at = now_ts;

    // ── CPI: record_production в enrg-profile ──
    // Обновляет device_energy_30d и метаданные устройства.
    // Пока закомментировано — будет включено после создания enrg-profile.
    //
    // let profile_ctx = CpiContext::new(
    //     ctx.accounts.profile_program.to_account_info(),
    //     profile::cpi::accounts::RecordProduction {
    //         producer: ctx.accounts.producer.to_account_info(),
    //         profile: ctx.accounts.profile.to_account_info(),
    //         authority: ctx.accounts.authority.to_account_info(),
    //     },
    // );
    // profile::cpi::record_production(profile_ctx, report.energy_wh, now_ts)?;

    // ── Update producer state ──
    producer.nonce = report.nonce;
    producer.timestamp = report.verified_at;
    producer.energy_wh = producer
        .energy_wh
        .checked_add(report.energy_wh)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // ── Calculate reward with dynamic difficulty ──
    // device_energy_30d пока читаем из отчёта (заглушка).
    // TODO: читать из EnergyProfile PDA после интеграции enrg-profile.
    let device_energy_30d: u64 = 0; // временно

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

    // Никаких "пустых" минтов: отчёты, дающие 0 SRC, отклоняем.
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

    let token_program = ctx.accounts.token_program.key();

    // Mint to producer (user)
    token::mint_to(
        CpiContext::new(
            token_program,
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        user_amount,
    )?;

    // Mint to buyback
    token::mint_to(
        CpiContext::new(
            token_program,
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.buyback_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        buyback_amount,
    )?;

    // Mint to staking
    token::mint_to(
        CpiContext::new(
            token_program,
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.staking_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        staking_amount,
    )?;

    // Mint to DAO
    token::mint_to(
        CpiContext::new(
            token_program,
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.dao_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        dao_amount,
    )?;

    // Mint to emergency
    token::mint_to(
        CpiContext::new(
            token_program,
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
        .and_then(|v| v.checked_div(MAX_SUPPLY as u128))
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
        bump = token_mint.mint_bump
    )]
    pub mint: Box<Account<'info, Mint>>,

    /// CHECK: Mint Authority PDA is a dedicated signer for token::mint_to().
    #[account(
        seeds = [b"mint-authority"],
        bump = token_mint.mint_authority_bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub user_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub buyback_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub staking_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub dao_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub emergency_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: Sysvar instructions — используется для проверки Ed25519-подписи.
    pub instructions: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,

    // ── CPI: enrg-profile (будет добавлен после создания программы) ──
    // /// CHECK: enrg-profile program ID.
    // pub profile_program: UncheckedAccount<'info>,
    // #[account(
    //     mut,
    //     seeds = [b"profile", producer.key().as_ref()],
    //     bump,
    //     seeds::program = profile_program.key()
    // )]
    // pub profile: Account<'info, energy_profile::state::EnergyProfile>,
}
