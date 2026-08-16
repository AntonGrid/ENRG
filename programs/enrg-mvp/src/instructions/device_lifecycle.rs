use anchor_lang::prelude::*;

use crate::constants::{
    ENRG_PROFILE_PROGRAM_ID, INSTRUCTIONS_SYSVAR_ID, MAX_CLOCK_SKEW, MAX_DEVICES_PER_OWNER,
};
use crate::error::ErrorCode;
use crate::security::lifecycle::{
    device_claim_message, device_register_message, device_rotate_message,
};
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
    producer.tier = DeviceTier::Basic; // v7.0 §15: новый девайс — Basic
    producer.month_energy_wh = 0;
    producer.month_start_ts = 0;
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

    /// Per-owner registry — создаётся при первом claim (BLOCK 4:
    /// лимит устройств на владельца).
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + OwnerDevices::INIT_SPACE,
        seeds = [b"owner-devices", authority.key().as_ref()],
        bump
    )]
    pub owner_devices: Account<'info, OwnerDevices>,

    /// CHECK: sysvar Instructions — ed25519-precompile-инструкция с подписью
    /// устройства ДОЛЖНА быть в транзакции перед этой инструкцией.
    #[account(
        constraint = instructions.key() == INSTRUCTIONS_SYSVAR_ID @ ErrorCode::InvalidInstructionsAccount
    )]
    pub instructions: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn claim_device(
    ctx: Context<ClaimDevice>,
    device_signature: [u8; 64],
    claim_nonce: u64,
    claim_timestamp: i64,
) -> Result<()> {
    let producer = &mut ctx.accounts.producer;

    // ADR-0007: отозванное устройство не может быть заклеймлено.
    require!(!producer.revoked, ErrorCode::DeviceRevoked);

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

    // ── Лимит устройств на владельца (BLOCK 4 — антидробление) ──
    let owner_devices = &mut ctx.accounts.owner_devices;
    if owner_devices.owner == Pubkey::default() {
        owner_devices.owner = owner;
        owner_devices.total_claimed = 0;
        owner_devices.active_count = 0;
    }
    require!(owner_devices.owner == owner, ErrorCode::Unauthorized);
    require!(
        owner_devices.total_claimed < MAX_DEVICES_PER_OWNER,
        ErrorCode::DeviceLimitReached
    );
    owner_devices.total_claimed = owner_devices
        .total_claimed
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

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
    require!(
        !ctx.accounts.producer.revoked,
        ErrorCode::DeviceRevoked // ADR-0007: отозванному устройству профиль не создаём
    );
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
    require!(!producer.revoked, ErrorCode::DeviceRevoked); // ADR-0007
    require!(
        producer.state.can_transition_to(DeviceState::Provisioned),
        ErrorCode::InvalidStateTransition
    );
    producer.state = DeviceState::Provisioned;

    let clock = Clock::get()?;
    emit!(DeviceProvisioned {
        device_id: producer.device_id,
        owner: producer.authority,
        timestamp: clock.unix_timestamp,
    });
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

    /// Per-owner registry — лимит активных устройств (BLOCK 4).
    #[account(
        mut,
        seeds = [b"owner-devices", authority.key().as_ref()],
        bump,
        constraint = owner_devices.owner == authority.key() @ ErrorCode::Unauthorized
    )]
    pub owner_devices: Account<'info, OwnerDevices>,
}

pub fn activate_device(ctx: Context<ActivateDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(!producer.revoked, ErrorCode::DeviceRevoked); // ADR-0007
    require!(
        producer.state.can_transition_to(DeviceState::Active),
        ErrorCode::InvalidStateTransition
    );

    // Лимит активных устройств на владельца (BLOCK 4 — антидробление).
    let owner_devices = &mut ctx.accounts.owner_devices;
    require!(
        owner_devices.active_count < MAX_DEVICES_PER_OWNER,
        ErrorCode::DeviceLimitReached
    );
    owner_devices.active_count = owner_devices
        .active_count
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    producer.state = DeviceState::Active;

    let clock = Clock::get()?;
    emit!(DeviceActivated {
        device_id: producer.device_id,
        owner: producer.authority,
        timestamp: clock.unix_timestamp,
    });
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

    /// Per-owner registry — счётчик активных устройств (BLOCK 4).
    #[account(
        mut,
        seeds = [b"owner-devices", authority.key().as_ref()],
        bump,
        constraint = owner_devices.owner == authority.key() @ ErrorCode::Unauthorized
    )]
    pub owner_devices: Account<'info, OwnerDevices>,
}

pub fn quarantine_device(ctx: Context<QuarantineDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(!producer.revoked, ErrorCode::DeviceRevoked); // ADR-0007
    require!(
        producer.state.can_transition_to(DeviceState::Quarantine),
        ErrorCode::InvalidStateTransition
    );
    // Из Active уходит ровно один активный счётчик (Quarantine достижим только из Active).
    let owner_devices = &mut ctx.accounts.owner_devices;
    owner_devices.active_count = owner_devices.active_count.saturating_sub(1);
    producer.state = DeviceState::Quarantine;

    let clock = Clock::get()?;
    emit!(DeviceQuarantined {
        device_id: producer.device_id,
        owner: producer.authority,
        timestamp: clock.unix_timestamp,
    });
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

    /// Per-owner registry — счётчик активных устройств (BLOCK 4).
    #[account(
        mut,
        seeds = [b"owner-devices", authority.key().as_ref()],
        bump,
        constraint = owner_devices.owner == authority.key() @ ErrorCode::Unauthorized
    )]
    pub owner_devices: Account<'info, OwnerDevices>,
}

pub fn maintenance_device(ctx: Context<MaintenanceDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(!producer.revoked, ErrorCode::DeviceRevoked); // ADR-0007
    require!(
        producer.state.can_transition_to(DeviceState::Maintenance),
        ErrorCode::InvalidStateTransition
    );
    // Уменьшаем счётчик только если устройство уходит из Active
    // (из Quarantine счётчик уже был уменьшен при карантине).
    if producer.state == DeviceState::Active {
        let owner_devices = &mut ctx.accounts.owner_devices;
        owner_devices.active_count = owner_devices.active_count.saturating_sub(1);
    }
    producer.state = DeviceState::Maintenance;

    let clock = Clock::get()?;
    emit!(DeviceMaintenance {
        device_id: producer.device_id,
        owner: producer.authority,
        timestamp: clock.unix_timestamp,
    });
    msg!("Device moved to maintenance: {}", producer.device_id);
    Ok(())
}

#[derive(Accounts)]
pub struct RevokeDevice<'info> {
    /// Владелец устройства ИЛИ протокольный админ (vault.authority).
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"producer", producer.device_id.as_ref()],
        bump,
        constraint = producer.device_id != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub producer: Account<'info, EnergyProducer>,

    /// Per-owner registry — счётчик активных устройств (BLOCK 4).
    /// Опционально: для незаклеймленных устройств (authority == default)
    /// аккаунта владельца может не существовать (админ-отзыв).
    #[account(
        mut,
        seeds = [b"owner-devices", producer.authority.as_ref()],
        bump,
        constraint = owner_devices.owner == producer.authority @ ErrorCode::Unauthorized
    )]
    pub owner_devices: Option<Account<'info, OwnerDevices>>,

    /// Vault — протокольный админ (vault.authority) может отозвать устройство
    /// (ADR-0005: «by owner or system»). Опционален: owner-отзыв работает без
    /// vault (обратная совместимость).
    #[account(seeds = [b"vault"], bump)]
    pub vault: Option<Account<'info, Vault>>,
}

pub fn revoke_device(ctx: Context<RevokeDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;

    // ADR-0007: повторный отзыв недопустим (терминальное состояние).
    require!(!producer.revoked, ErrorCode::DeviceAlreadyRevoked);

    // Авторизация: владелец ИЛИ протокольный админ (vault.authority).
    let is_owner = producer.authority == ctx.accounts.authority.key();
    let is_admin = ctx
        .accounts
        .vault
        .as_ref()
        .map(|v| v.authority == ctx.accounts.authority.key())
        .unwrap_or(false);
    require!(is_owner || is_admin, ErrorCode::Unauthorized);

    // Отзыв возможен из любого не-терминального состояния (ADR-0005/0007:
    // «permanent decommissioning by owner or system»).
    require!(
        producer.state != DeviceState::Revoked,
        ErrorCode::DeviceAlreadyRevoked
    );

    // Уменьшаем счётчик только если устройство уходит из Active
    // (из Quarantine/Maintenance счётчик уже уменьшен ранее).
    if producer.state == DeviceState::Active {
        if let Some(owner_devices) = &mut ctx.accounts.owner_devices {
            owner_devices.active_count = owner_devices.active_count.saturating_sub(1);
        }
    }
    producer.state = DeviceState::Revoked;
    producer.revoked = true; // ADR-0007: явный флаг отзыва

    let clock = Clock::get()?;
    emit!(DeviceRevoked {
        device_id: producer.device_id,
        owner: producer.authority,
        timestamp: clock.unix_timestamp,
    });
    msg!("Device revoked: {}", producer.device_id);
    Ok(())
}

// ══════════════════════════════════════════════════════════════
//  ROTATE KEY — ротация ключа устройства (ADR-0007)
// ══════════════════════════════════════════════════════════════
//  Владелец (или протокольный админ) меняет публичный ключ устройства.
//  НОВЫЙ ключ обязан подписать сообщение
//    b"enrg:device:rotate" || new_device_id(32) || owner(32)
//                          || rotate_nonce(8 LE) || rotate_timestamp(8 LE)
//  — proof-of-possession нового ключа (ADR-0007 §4).
//
//  Реализация: создаётся новая запись EnergyProducer с seed
//  [b"producer", new_device_id] (PDA определяется новым ключом), в неё
//  копируется состояние (nonce, энергия, tier, owner, state). Старая запись
//  помечается revoked + rotated_to = new_device_id (аудит-след). Счётчик
//  активных устройств не меняется: устройство остаётся тем же, меняется ключ.
#[derive(Accounts)]
#[instruction(new_device_id: Pubkey)]
pub struct RotateDeviceKey<'info> {
    /// Владелец устройства ИЛИ протокольный админ (vault.authority).
    /// mut — т.к. является payer для init новой записи.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Текущая запись устройства (PDA от старого device_id).
    #[account(
        mut,
        seeds = [b"producer", old_producer.device_id.as_ref()],
        bump,
        constraint = old_producer.device_id != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub old_producer: Account<'info, EnergyProducer>,

    /// Новый публичный ключ устройства (Ed25519, 32 байта) — новый seed PDA.
    /// CHECK: используется только для вывода PDA seeds и проверки подписи.
    #[account(
        constraint = new_device_id.key() != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub new_device_id: UncheckedAccount<'info>,

    /// Новая запись устройства (PDA от нового device_id) — наследует состояние.
    #[account(
        init,
        payer = authority,
        space = 8 + EnergyProducer::INIT_SPACE,
        seeds = [b"producer", new_device_id.key().as_ref()],
        bump
    )]
    pub new_producer: Account<'info, EnergyProducer>,

    /// Vault — проверка админ-роли (authority == vault.authority).
    /// Опционален: owner-ротация работает без vault (обратная совместимость).
    #[account(seeds = [b"vault"], bump)]
    pub vault: Option<Account<'info, Vault>>,

    /// CHECK: sysvar Instructions — ed25519-precompile с подписью НОВОГО ключа.
    #[account(
        constraint = instructions.key() == INSTRUCTIONS_SYSVAR_ID @ ErrorCode::InvalidInstructionsAccount
    )]
    pub instructions: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn rotate_device_key(
    ctx: Context<RotateDeviceKey>,
    new_device_id: Pubkey,
    device_signature: [u8; 64],
    rotate_nonce: u64,
    rotate_timestamp: i64,
) -> Result<()> {
    let old = &mut ctx.accounts.old_producer;

    // ADR-0007: отозванное устройство не ротируем.
    require!(!old.revoked, ErrorCode::DeviceAlreadyRevoked);
    require!(old.device_id != new_device_id, ErrorCode::InvalidParameter);
    require!(
        ctx.accounts.new_device_id.key() == new_device_id,
        ErrorCode::InvalidParameter
    );
    require!(old.state != DeviceState::Revoked, ErrorCode::DeviceAlreadyRevoked);

    // Авторизация: владелец ИЛИ протокольный админ (vault.authority).
    let is_owner = old.authority == ctx.accounts.authority.key();
    let is_admin = ctx
        .accounts
        .vault
        .as_ref()
        .map(|v| v.authority == ctx.accounts.authority.key())
        .unwrap_or(false);
    require!(is_owner || is_admin, ErrorCode::Unauthorized);

    let clock = Clock::get()?;
    require!(rotate_timestamp > 0, ErrorCode::InvalidParameter);
    require!(
        rotate_timestamp <= clock.unix_timestamp + MAX_CLOCK_SKEW,
        ErrorCode::FutureTimestamp
    );
    // Anti-replay: rotate-nonce строго возрастает относительно claim_nonce.
    require!(rotate_nonce > old.claim_nonce, ErrorCode::InvalidNonce);

    // ── Подпись НОВОГО ключа (ADR-0007: proof-of-possession нового ключа) ──
    let owner = old.authority;
    let message = device_rotate_message(&new_device_id, &owner, rotate_nonce, rotate_timestamp);
    verify_ed25519_signature(
        &device_signature,
        &new_device_id.to_bytes(),
        &message,
        &ctx.accounts.instructions.to_account_info(),
    )?;

    // ── Новая запись: копируем состояние ──
    let new_producer = &mut ctx.accounts.new_producer;
    new_producer.authority = owner;
    new_producer.device_id = new_device_id;
    new_producer.nonce = old.nonce;
    new_producer.energy_wh = old.energy_wh;
    new_producer.timestamp = old.timestamp;
    new_producer.state = old.state;
    new_producer.tier = old.tier;
    new_producer.month_energy_wh = old.month_energy_wh;
    new_producer.month_start_ts = old.month_start_ts;
    new_producer.claim_nonce = rotate_nonce;
    new_producer.claimed_at = clock.unix_timestamp;
    new_producer.revoked = false;
    new_producer.rotated_to = Pubkey::default();

    // ── Старая запись — терминальное состояние + аудит-след ──
    old.state = DeviceState::Revoked;
    old.revoked = true;
    old.rotated_to = new_device_id;

    emit!(DeviceKeyRotated {
        device_id: old.device_id,
        new_device_id,
        owner,
        changed_by: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });
    msg!("Device key rotated: {} -> {}", old.device_id, new_device_id);
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

    /// Per-owner registry — счётчик активных устройств (BLOCK 4).
    #[account(
        mut,
        seeds = [b"owner-devices", authority.key().as_ref()],
        bump,
        constraint = owner_devices.owner == authority.key() @ ErrorCode::Unauthorized
    )]
    pub owner_devices: Account<'info, OwnerDevices>,
}

pub fn release_from_quarantine(ctx: Context<ReleaseFromQuarantine>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(!producer.revoked, ErrorCode::DeviceRevoked); // ADR-0007
    require!(
        producer.state.can_transition_to(DeviceState::Active),
        ErrorCode::InvalidStateTransition
    );
    // Возврат в Active — инкремент счётчика (лимит проверяется).
    let owner_devices = &mut ctx.accounts.owner_devices;
    require!(
        owner_devices.active_count < MAX_DEVICES_PER_OWNER,
        ErrorCode::DeviceLimitReached
    );
    owner_devices.active_count = owner_devices
        .active_count
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    producer.state = DeviceState::Active;

    let clock = Clock::get()?;
    emit!(DeviceReleasedFromQuarantine {
        device_id: producer.device_id,
        owner: producer.authority,
        timestamp: clock.unix_timestamp,
    });
    msg!("Device released from quarantine: {}", producer.device_id);
    Ok(())
}

