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
//  Creates a device record (EnergyProducer PDA):
//    seeds = [b"producer", device_id.key().as_ref()]
//
//  The device MUST sign the message
//    b"enrg:device:register" || device_id(32) || register_timestamp(8 LE)
//  — this proves key ownership (ADR-0001 / ADR-0002). Without the device
//  signature no record can be created: it is impossible to register a foreign key.
#[derive(Accounts)]
pub struct RegisterDevice<'info> {
    /// Operator: initiates registration and pays the rent.
    #[account(mut)]
    pub operator: Signer<'info>,

    /// PDA device record, strictly bound to device_id.
    #[account(
        init,
        payer = operator,
        space = 8 + EnergyProducer::INIT_SPACE,
        seeds = [b"producer", device_id.key().as_ref()],
        bump
    )]
    pub producer: Account<'info, EnergyProducer>,

    /// CHECK: the device's public Ed25519 key (32 bytes).
    /// Used only for deriving PDA seeds.
    #[account(
        constraint = device_id.key() != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub device_id: UncheckedAccount<'info>,

    /// CHECK: sysvar Instructions — an ed25519 precompile instruction with the
    /// device signature MUST be in the transaction before this instruction.
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

    // ── The device proves key ownership (ADR-0001 / ADR-0002) ──
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
    producer.tier = DeviceTier::Basic; // v7.0 §15: new device — Basic
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
//  Binds the device to a wallet (authority).
//
//  The device MUST sign the message
//    b"enrg:device:claim" || device_id(32) || owner(32)
//                         || claim_nonce(8 LE) || claim_timestamp(8 LE)
//
//  Per ADR-0001 the private key never leaves the device, so the device cannot
//  be "captured" without its consent. The owner is embedded in the message:
//  an intercepted signature cannot be "redirected" to another wallet.
#[derive(Accounts)]
pub struct ClaimDevice<'info> {
    /// The wallet the device is bound to (new authority).
    #[account(mut)]
    pub authority: Signer<'info>,

    /// PDA device record. Seeds are derived from the stored device_id —
    /// substituting the record or binding to a foreign device is impossible.
    #[account(
        mut,
        seeds = [b"producer", producer.device_id.as_ref()],
        bump,
        constraint = producer.device_id != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub producer: Account<'info, EnergyProducer>,

    /// Per-owner registry — created on the first claim (BLOCK 4:
    /// device-per-owner limit).
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + OwnerDevices::INIT_SPACE,
        seeds = [b"owner-devices", authority.key().as_ref()],
        bump
    )]
    pub owner_devices: Account<'info, OwnerDevices>,

    /// CHECK: sysvar Instructions — an ed25519 precompile instruction with the
    /// device signature MUST be in the transaction before this instruction.
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

    // ADR-0007: a revoked device cannot be claimed.
    require!(!producer.revoked, ErrorCode::DeviceRevoked);

    // Transition only from REGISTERED (ADR-0005).
    require!(producer.state == DeviceState::Registered, ErrorCode::InvalidDeviceState);
    // The device must not already be bound to a wallet.
    require!(producer.authority == Pubkey::default(), ErrorCode::DeviceAlreadyClaimed);
    require!(producer.device_id != Pubkey::default(), ErrorCode::InvalidParameter);

    let clock = Clock::get()?;
    require!(claim_timestamp > 0, ErrorCode::InvalidParameter);
    require!(
        claim_timestamp <= clock.unix_timestamp + MAX_CLOCK_SKEW,
        ErrorCode::FutureTimestamp
    );
    // Anti-replay: the claim nonce strictly increases (separate from the proof nonce).
    require!(claim_nonce > producer.claim_nonce, ErrorCode::InvalidNonce);

    // ── DEVICE signature (ADR-0001): the key never leaves the device ──
    let owner = ctx.accounts.authority.key();
    let message = device_claim_message(&producer.device_id, &owner, claim_nonce, claim_timestamp);
    verify_ed25519_signature(
        &device_signature,
        &producer.device_id.to_bytes(),
        &message,
        &ctx.accounts.instructions.to_account_info(),
    )?;

    // ── Device-per-owner limit (BLOCK 4 — anti-fragmentation) ──
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
//  INIT_ENERGY_PROFILE — creates an owner-bound EnergyProfile
// ══════════════════════════════════════════════════════════════
//  Called by the owner (authority) AFTER claim. Creates the EnergyProfile
//  PDA [b"profile", authority] via CPI into enrg-profile. The profile is
//  needed by mint_energy (rated_power + rolling energy window).
#[derive(Accounts)]
pub struct InitEnergyProfile<'info> {
    /// Device owner (producer authority).
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"producer", producer.device_id.as_ref()],
        bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub producer: Account<'info, EnergyProducer>,

    /// CHECK: enrg-profile program ID — the only allowed CPI target.
    #[account(
        constraint = profile_program.key() == ENRG_PROFILE_PROGRAM_ID @ ErrorCode::InvalidParameter
    )]
    pub profile_program: UncheckedAccount<'info>,

    /// CHECK: EnergyProfile PDA, created via a CPI call into enrg-profile.
    #[account(mut)]
    pub profile: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn init_energy_profile(ctx: Context<InitEnergyProfile>) -> Result<()> {
    require!(
        !ctx.accounts.producer.revoked,
        ErrorCode::DeviceRevoked // ADR-0007: no profile for a revoked device
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
        0,            // rated_power — filled later via enrg-profile::update_metadata
        String::new(), // device_type
        String::new(), // location
    )?;

    Ok(())
}


// ══════════════════════════════════════════════════════════════
//  Owner-gated transitions (ADR-0005): PROVISIONED / ACTIVE /
//  QUARANTINE / MAINTENANCE / REVOKED / RELEASE.
//  Authorization — has_one = authority (device owner).
//  Transitions — only through a valid previous state (can_transition_to).
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

    /// Per-owner registry — active-device limit (BLOCK 4).
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

    // Active-device-per-owner limit (BLOCK 4 — anti-fragmentation).
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

    /// Per-owner registry — active-device counter (BLOCK 4).
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
    // Exactly one active counter leaves Active (Quarantine is reachable only from Active).
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

    /// Per-owner registry — active-device counter (BLOCK 4).
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
    // Decrement the counter only when the device leaves Active
    // (from Quarantine the counter was already decremented during quarantine).
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
    /// Device owner OR protocol admin (vault.authority).
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"producer", producer.device_id.as_ref()],
        bump,
        constraint = producer.device_id != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub producer: Account<'info, EnergyProducer>,

    /// Per-owner registry — active-device counter (BLOCK 4).
    /// Optional: for unclaimed devices (authority == default)
    /// the owner account may not exist (admin revocation).
    #[account(
        mut,
        seeds = [b"owner-devices", producer.authority.as_ref()],
        bump,
        constraint = owner_devices.owner == producer.authority @ ErrorCode::Unauthorized
    )]
    pub owner_devices: Option<Account<'info, OwnerDevices>>,

    /// Vault — the protocol admin (vault.authority) can revoke a device
    /// (ADR-0005: "by owner or system"). Optional: owner revocation works
    /// without the vault (backward compatibility).
    #[account(seeds = [b"vault"], bump)]
    pub vault: Option<Account<'info, Vault>>,
}

pub fn revoke_device(ctx: Context<RevokeDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;

    // ADR-0007: a second revocation is invalid (terminal state).
    require!(!producer.revoked, ErrorCode::DeviceAlreadyRevoked);

    // Authorization: owner OR protocol admin (vault.authority).
    let is_owner = producer.authority == ctx.accounts.authority.key();
    let is_admin = ctx
        .accounts
        .vault
        .as_ref()
        .map(|v| v.authority == ctx.accounts.authority.key())
        .unwrap_or(false);
    require!(is_owner || is_admin, ErrorCode::Unauthorized);

    // Revocation is possible from any non-terminal state (ADR-0005/0007:
    // "permanent decommissioning by owner or system").
    require!(
        producer.state != DeviceState::Revoked,
        ErrorCode::DeviceAlreadyRevoked
    );

    // Decrement the counter only when the device leaves Active
    // (from Quarantine/Maintenance the counter was already decremented).
    if producer.state == DeviceState::Active {
        if let Some(owner_devices) = &mut ctx.accounts.owner_devices {
            owner_devices.active_count = owner_devices.active_count.saturating_sub(1);
        }
    }
    producer.state = DeviceState::Revoked;
    producer.revoked = true; // ADR-0007: explicit revocation flag

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
//  ROTATE KEY — device key rotation (ADR-0007)
// ══════════════════════════════════════════════════════════════
//  The owner (or protocol admin) changes the device public key.
//  The NEW key MUST sign the message
//    b"enrg:device:rotate" || new_device_id(32) || owner(32)
//                          || rotate_nonce(8 LE) || rotate_timestamp(8 LE)
//  — proof-of-possession of the new key (ADR-0007 §4).
//
//  Implementation: a new EnergyProducer record is created with the seed
//  [b"producer", new_device_id] (the PDA is determined by the new key), and
//  the state (nonce, energy, tier, owner, state) is copied into it. The old
//  record is marked revoked + rotated_to = new_device_id (audit trail). The
//  active-device counter does not change: the device stays the same, the key changes.
#[derive(Accounts)]
#[instruction(new_device_id: Pubkey)]
pub struct RotateDeviceKey<'info> {
    /// Device owner OR protocol admin (vault.authority).
    /// mut — it is the payer for the init of the new record.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Current device record (PDA of the old device_id).
    #[account(
        mut,
        seeds = [b"producer", old_producer.device_id.as_ref()],
        bump,
        constraint = old_producer.device_id != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub old_producer: Account<'info, EnergyProducer>,

    /// New device public key (Ed25519, 32 bytes) — new PDA seed.
    /// CHECK: used only for deriving PDA seeds and verifying the signature.
    #[account(
        constraint = new_device_id.key() != Pubkey::default() @ ErrorCode::InvalidParameter
    )]
    pub new_device_id: UncheckedAccount<'info>,

    /// New device record (PDA of the new device_id) — inherits the state.
    #[account(
        init,
        payer = authority,
        space = 8 + EnergyProducer::INIT_SPACE,
        seeds = [b"producer", new_device_id.key().as_ref()],
        bump
    )]
    pub new_producer: Account<'info, EnergyProducer>,

    /// Vault — admin-role check (authority == vault.authority).
    /// Optional: owner rotation works without the vault (backward compatibility).
    #[account(seeds = [b"vault"], bump)]
    pub vault: Option<Account<'info, Vault>>,

    /// CHECK: sysvar Instructions — ed25519 precompile with the NEW key signature.
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

    // ADR-0007: a revoked device is not rotated.
    require!(!old.revoked, ErrorCode::DeviceAlreadyRevoked);
    require!(old.device_id != new_device_id, ErrorCode::InvalidParameter);
    require!(
        ctx.accounts.new_device_id.key() == new_device_id,
        ErrorCode::InvalidParameter
    );
    require!(old.state != DeviceState::Revoked, ErrorCode::DeviceAlreadyRevoked);

    // Authorization: owner OR protocol admin (vault.authority).
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
    // Anti-replay: the rotate nonce strictly increases relative to claim_nonce.
    require!(rotate_nonce > old.claim_nonce, ErrorCode::InvalidNonce);

    // ── NEW key signature (ADR-0007: proof-of-possession of the new key) ──
    let owner = old.authority;
    let message = device_rotate_message(&new_device_id, &owner, rotate_nonce, rotate_timestamp);
    verify_ed25519_signature(
        &device_signature,
        &new_device_id.to_bytes(),
        &message,
        &ctx.accounts.instructions.to_account_info(),
    )?;

    // ── New record: copy the state ──
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

    // ── Old record — terminal state + audit trail ──
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

    /// Per-owner registry — active-device counter (BLOCK 4).
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
    // Return to Active — increment the counter (the limit is checked).
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

