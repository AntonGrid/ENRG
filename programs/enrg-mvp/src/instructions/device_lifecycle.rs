use anchor_lang::prelude::*;
use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
pub struct RegisterDevice<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(
        init,
        payer = operator,
        space = 8 + EnergyProducer::INIT_SPACE,
        seeds = [b"producer", device_id.key().as_ref()],
        bump
    )]
    pub producer: Account<'info, EnergyProducer>,
    /// CHECK: device identity public key
    pub device_id: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: enrg-profile program ID (для CPI создания профиля).
    /// Единственная разрешённая CPI-цель для создания EnergyProfile.
    #[account(
        constraint = profile_program.key() == crate::constants::ENRG_PROFILE_PROGRAM_ID @ ErrorCode::InvalidParameter
    )]
    pub profile_program: UncheckedAccount<'info>,
    /// CHECK: EnergyProfile PDA, создаётся через CPI-вызов в enrg-profile.
    #[account(mut)]
    pub profile: UncheckedAccount<'info>,
}

pub fn register_device(ctx: Context<RegisterDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    producer.authority = Pubkey::default();
    producer.device_id = ctx.accounts.device_id.key();
    producer.nonce = 0;
    producer.energy_wh = 0;
    producer.timestamp = 0;
    producer.state = DeviceState::Registered;
    msg!("Device registered: {}", producer.device_id);

    // ── CPI: создание EnergyProfile в enrg-profile ──
    // Seeds PDPA профиля: [b"profile", operator.key().as_ref()] (см. enrg-profile).
    let operator_key = ctx.accounts.operator.key();
    let profile_seeds = &[b"profile".as_ref(), operator_key.as_ref()];
    let (profile_pda, _bump) = Pubkey::find_program_address(
        profile_seeds,
        &ctx.accounts.profile_program.key(),
    );
    require!(
        ctx.accounts.profile.key() == profile_pda,
        ErrorCode::InvalidParameter
    );

    let cpi_program = ctx.accounts.profile_program.to_account_info();
    let cpi_ctx = CpiContext::new(
        cpi_program,
        crate::enrg_profile::cpi::accounts::InitializeProfile {
            authority: ctx.accounts.operator.to_account_info(),
            profile: ctx.accounts.profile.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        },
    );

    crate::enrg_profile::cpi::initialize_profile(
        cpi_ctx,
        ctx.accounts.device_id.key(),
        0, // rated_power — заполняется позже через enrg-profile::update_metadata
        String::new(), // device_type
        String::new(), // location
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimDevice<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"producer", producer.device_id.as_ref()],
        bump
    )]
    pub producer: Account<'info, EnergyProducer>,
}

pub fn claim_device(ctx: Context<ClaimDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(producer.state == DeviceState::Registered, ErrorCode::InvalidDeviceState);
    require!(producer.authority == Pubkey::default(), ErrorCode::DeviceAlreadyClaimed);
    require!(producer.device_id != Pubkey::default(), ErrorCode::InvalidParameter);
    producer.authority = ctx.accounts.authority.key();
    producer.state = DeviceState::Claimed;
    msg!("Device claimed: {}", producer.device_id);
    Ok(())
}

#[derive(Accounts)]
pub struct ProvisionDevice<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"producer", producer.device_id.as_ref()],
        bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub producer: Account<'info, EnergyProducer>,
}

pub fn provision_device(ctx: Context<ProvisionDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(producer.state.can_transition_to(DeviceState::Provisioned), ErrorCode::InvalidStateTransition);
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
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub producer: Account<'info, EnergyProducer>,
}

pub fn activate_device(ctx: Context<ActivateDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(producer.state.can_transition_to(DeviceState::Active), ErrorCode::InvalidStateTransition);
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
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub producer: Account<'info, EnergyProducer>,
}

pub fn quarantine_device(ctx: Context<QuarantineDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(producer.state.can_transition_to(DeviceState::Quarantine), ErrorCode::InvalidStateTransition);
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
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub producer: Account<'info, EnergyProducer>,
}

pub fn maintenance_device(ctx: Context<MaintenanceDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(producer.state.can_transition_to(DeviceState::Maintenance), ErrorCode::InvalidStateTransition);
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
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub producer: Account<'info, EnergyProducer>,
}

pub fn revoke_device(ctx: Context<RevokeDevice>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(producer.state.can_transition_to(DeviceState::Revoked), ErrorCode::InvalidStateTransition);
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
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub producer: Account<'info, EnergyProducer>,
}

pub fn release_from_quarantine(ctx: Context<ReleaseFromQuarantine>) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    require!(producer.state == DeviceState::Quarantine, ErrorCode::InvalidDeviceState);
    producer.state = DeviceState::Active;
    msg!("Device released from quarantine: {}", producer.device_id);
    Ok(())
}
