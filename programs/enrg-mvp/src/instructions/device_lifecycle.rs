use anchor_lang::prelude::*;

use crate::constants::{ENRG_PROFILE_PROGRAM_ID, INSTRUCTIONS_SYSVAR_ID, MAX_CLOCK_SKEW};
use crate::error::ErrorCode;
use crate::security::lifecycle::{device_claim_message, device_register_message};
use crate::security::verify_ed25519_signature;
use crate::state::*;

// ══════════════════════════════════════════════════════════════
//  REGISTER — UNREGISTERED → REGISTERED (ADR-0005)
// ══════════════════════════════════════════════════════════════
//  Создаёт device record (EnergyProducer PDA):
//    seeds = [b"producer", device_id.key().as_ref()]
//
//  Устройство ДОЛЖНО подписать сообщение
//    b"enrg:device:register" || device_id(32) || register_timestamp(8 LE)
//  — это доказывает владение ключом (ADR-0001 / ADR-0002). Без подписи
//  устройства запись создать нельзя: невозможно зарегистрировать чужой ключ.
#[derive(Accounts)]
pub struct RegisterDevice<'info> {
    /// Оператор: инициирует регистрацию и платит rent.
    #[account(mut)]
    pub operator: Signer<'info>,

    /// PDA device record, жёстко привязан к device_id.
    #[account(
        init,
        payer = operator,
        space = 8 + EnergyProducer::INIT_SPACE,
        seeds = [b"producer", device_id.key().as_ref()],
        bump
    )]
    pub producer: Account<'info, EnergyProducer>,

    /// CHECK: публичный Ed25519-ключ устройства (32 байта).
    /// Используется только для вывода PDA seeds.
    #[account(
        constraint = device_id.key() != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub device_id: UncheckedAccount<'info>,

    /// CHECK: sysvar Instructions — ed25519-precompile-инструкция с подписью
    /// устройства ДОЛЖНА быть в транзакции перед этой инструкцией.
    #[account(
        constraint = instructions.key() == INSTRUCTIONS_SYSVAR_ID @ ErrorCode::InvalidInstructionsAccount
    )]
    pub instructions: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_device(
    ctx: Context<RegisterDevice>,
    device_signature: [u8; 64],
    register_timestamp: i64,
) -> Result<()> {
    let device_id = ctx.accounts.device_id.key();
    require!(device_id != Pubkey::default(), ErrorCode::InvalidParameter);

    let clock = Clock::get()?;
    require!(register_timestamp > 0, ErrorCode::InvalidParameter);
    require!(
        register_timestamp <= clock.unix_timestamp + MAX_CLOCK_SKEW,
        ErrorCode::FutureTimestamp
    );

    // ── Устройство доказывает владение ключом (ADR-0001 / ADR-0002) ──
    let message = device_register_message(&device_id, register_timestamp);
    verify_ed25519_signature(
        &device_signature,
        &device_id.to_bytes(),
        &message,
        &ctx.accounts.instructions.to_account_info(),
    )?;

    let producer = &mut ctx.accounts.producer;
    producer.authority = Pubkey::default();
    producer.device_id = device_id;
    producer.nonce = 0;
    producer.energy_wh = 0;
    producer.timestamp = 0;
    producer.state = DeviceState::Registered;
    producer.claim_nonce = 0;
    producer.claimed_at = 0;

    emit!(DeviceRegistered {
        device_id,
        registered_by: ctx.accounts.operator.key(),
        timestamp: clock.unix_timestamp,
    });
    msg!("Device registered: {}", device_id);
    Ok(())
}

// ══════════════════════════════════════════════════════════════
//  CLAIM — REGISTERED → CLAIMED (ADR-0005)
// ══════════════════════════════════════════════════════════════
//  Привязывает устройство к кошельку (authority).
//
//  Устройство ДОЛЖНО подписать сообщение
//    b"enrg:device:claim" || device_id(32) || owner(32)
//                         || claim_nonce(8 LE) || claim_timestamp(8 LE)
//
//  По ADR-0001 приватный ключ никогда не покидает устройство, поэтому
//  «захват» устройства без его согласия невозможен. Owner вшит в сообщение:
//  перехваченную подпись нельзя «перенаправить» на другой кошелёк.
#[derive(Accounts)]
pub struct ClaimDevice<'info> {
    /// Кошелёк, которому устройство привязывается (новый authority).
    #[account(mut)]
    pub authority: Signer<'info>,

    /// PDA device record. Seeds выведены из stored device_id — подмена
    /// записи или привязка к чужому устройству невозможны.
    #[account(
        mut,
        seeds = [b"producer", producer.device_id.as_ref()],
        bump,
        constraint = producer.device_id != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub producer: Account<'info, EnergyProducer>,

    /// CHECK: sysvar Instructions — ed25519-precompile-инструкция с подписью
    /// устройства ДОЛЖНА быть в транзакции перед этой инструкцией.
    #[account(
        constraint = instructions.key() == INSTRUCTIONS_SYSVAR_ID @ ErrorCode::InvalidInstructionsAccount
    )]
    pub instructions: UncheckedAccount<'info>,
}

pub fn claim_device(
    ctx: Context<ClaimDevice>,
    device_signature: [u8; 64],
    claim_nonce: u64,
    claim_timestamp: i64,
) -> Result<()> {
    let producer = &mut ctx.accounts.producer;

    // Переход только из REGISTERED (ADR-0005).
    require!(producer.state == DeviceState::Registered, ErrorCode::InvalidDeviceState);
    // Устройство не должно быть уже привязано к кошельку.
    require!(producer.authority == Pubkey::default(), ErrorCode::DeviceAlreadyClaimed);
    require!(producer.device_id != Pubkey::default(), ErrorCode::InvalidParameter);

    let clock = Clock::get()?;
    require!(claim_timestamp > 0, ErrorCode::InvalidParameter);
    require!(
        claim_timestamp <= clock.unix_timestamp + MAX_CLOCK_SKEW,
        ErrorCode::FutureTimestamp
    );
    // Anti-replay: claim-nonce строго возрастает (отдельно от proof-nonce).
    require!(claim_nonce > producer.claim_nonce, ErrorCode::InvalidNonce);

    // ── Подпись УСТРОЙСТВА (ADR-0001): ключ не покидает устройство ──
    let owner = ctx.accounts.authority.key();
    let message = device_claim_message(&producer.device_id, &owner, claim_nonce, claim_timestamp);
    verify_ed25519_signature(
        &device_signature,
        &producer.device_id.to_bytes(),
        &message,
        &ctx.accounts.instructions.to_account_info(),
    )?;

    producer.authority = owner;
    producer.state = DeviceState::Claimed;
    producer.claim_nonce = claim_nonce;
    producer.claimed_at = clock.unix_timestamp;

    emit!(DeviceClaimed {
        device_id: producer.device_id,
        owner,
        claim_nonce,
        timestamp: clock.unix_timestamp,
    });
    msg!("Device claimed by {}: {}", owner, producer.device_id);
    Ok(())
}


// ══════════════════════════════════════════════════════════════
//  INIT_ENERGY_PROFILE — создание owner-bound EnergyProfile
// ══════════════════════════════════════════════════════════════
//  Вызывается владельцем (authority) ПОСЛЕ claim. Создаёт EnergyProfile
//  PDA [b"profile", authority] через CPI в enrg-profile. Профиль нужен
//  mint_energy (rated_power + скользящее окно энергии).
#[derive(Accounts)]
pub struct InitEnergyProfile<'info> {
    /// Владелец устройства (authority producer'а).
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"producer", producer.device_id.as_ref()],
        bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub producer: Account<'info, EnergyProducer>,

    /// CHECK: enrg-profile program ID — единственная разрешённая CPI-цель.
    #[account(
        constraint = profile_program.key() == ENRG_PROFILE_PROGRAM_ID @ ErrorCode::InvalidParameter
    )]
    pub profile_program: UncheckedAccount<'info>,

    /// CHECK: EnergyProfile PDA, создаётся через CPI-вызов в enrg-profile.
    #[account(mut)]
    pub profile: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn init_energy_profile(ctx: Context<InitEnergyProfile>) -> Result<()> {
    let authority_key = ctx.accounts.authority.key();
    let profile_seeds = &[b"profile".as_ref(), authority_key.as_ref()];
    let (profile_pda, _bump) = Pubkey::find_program_address(
        profile_seeds,
        &ctx.accounts.profile_program.key(),
    );
    require!(ctx.accounts.profile.key() == profile_pda, ErrorCode::InvalidParameter);

    let cpi_program = ctx.accounts.profile_program.to_account_info();
    let cpi_ctx = CpiContext::new(
        cpi_program,
        crate::enrg_profile::cpi::accounts::InitializeProfile {
            authority: ctx.accounts.authority.to_account_info(),
            profile: ctx.accounts.profile.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        },
    );

    crate::enrg_profile::cpi::initialize_profile(
        cpi_ctx,
        ctx.accounts.producer.device_id,
        0,            // rated_power — заполняется позже через enrg-profile::update_metadata
        String::new(), // device_type
        String::new(), // location
    )?;

    Ok(())
}


// ══════════════════════════════════════════════════════════════
//  Owner-gated transitions (ADR-0005): PROVISIONED / ACTIVE /
//  QUARANTINE / MAINTENANCE / REVOKED / RELEASE.
//  Авторизация — has_one = authority (владелец устройства).
//  Переходы — только через валидный предыдущий state (can_transition_to).
// ══════════════════════════════════════════════════════════════

#[derive(Accounts)]
pub struct ProvisionDevice<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"producer", producer.device_id.as_ref()],
        bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = producer.device_id != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub producer: Account<'info, EnergyProducer>,
}

pub fn provision_device(ctx: Context<ProvisionDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(
        producer.state.can_transition_to(DeviceState::Provisioned),
        ErrorCode::InvalidStateTransition
    );
    producer.state = DeviceState::Provisioned;
    msg!("Device provisioned: {}", producer.device_id);
    Ok(())
}

#[derive(Accounts)]
pub struct ActivateDevice<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"producer", producer.device_id.as_ref()],
        bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = producer.device_id != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub producer: Account<'info, EnergyProducer>,
}

pub fn activate_device(ctx: Context<ActivateDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(
        producer.state.can_transition_to(DeviceState::Active),
        ErrorCode::InvalidStateTransition
    );
    producer.state = DeviceState::Active;
    msg!("Device activated: {}", producer.device_id);
    Ok(())
}

#[derive(Accounts)]
pub struct QuarantineDevice<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"producer", producer.device_id.as_ref()],
        bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = producer.device_id != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub producer: Account<'info, EnergyProducer>,
}

pub fn quarantine_device(ctx: Context<QuarantineDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(
        producer.state.can_transition_to(DeviceState::Quarantine),
        ErrorCode::InvalidStateTransition
    );
    producer.state = DeviceState::Quarantine;
    msg!("Device quarantined: {}", producer.device_id);
    Ok(())
}

#[derive(Accounts)]
pub struct MaintenanceDevice<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"producer", producer.device_id.as_ref()],
        bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = producer.device_id != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub producer: Account<'info, EnergyProducer>,
}

pub fn maintenance_device(ctx: Context<MaintenanceDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(
        producer.state.can_transition_to(DeviceState::Maintenance),
        ErrorCode::InvalidStateTransition
    );
    producer.state = DeviceState::Maintenance;
    msg!("Device moved to maintenance: {}", producer.device_id);
    Ok(())
}

#[derive(Accounts)]
pub struct RevokeDevice<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"producer", producer.device_id.as_ref()],
        bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = producer.device_id != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub producer: Account<'info, EnergyProducer>,
}

pub fn revoke_device(ctx: Context<RevokeDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(
        producer.state.can_transition_to(DeviceState::Revoked),
        ErrorCode::InvalidStateTransition
    );
    producer.state = DeviceState::Revoked;
    msg!("Device revoked: {}", producer.device_id);
    Ok(())
}

#[derive(Accounts)]
pub struct ReleaseFromQuarantine<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"producer", producer.device_id.as_ref()],
        bump,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = producer.device_id != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub producer: Account<'info, EnergyProducer>,
}

pub fn release_from_quarantine(ctx: Context<ReleaseFromQuarantine>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(
        producer.state.can_transition_to(DeviceState::Active),
        ErrorCode::InvalidStateTransition
    );
    producer.state = DeviceState::Active;
    msg!("Device released from quarantine: {}", producer.device_id);
    Ok(())
}

