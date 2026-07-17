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

    // ── CPI: enrg-profile (будет добавлен после создания программы) ──
    // /// CHECK: enrg-profile program ID.
    // pub profile_program: UncheckedAccount<'info>,
    // #[account(
    //     init,
    //     payer = operator,
    //     space = 8 + energy_profile::state::EnergyProfile::INIT_SPACE,
    //     seeds = [b"profile", producer.key().as_ref()],
    //     bump,
    //     seeds::program = profile_program.key()
    // )]
    // pub profile: Account<'info, energy_profile::state::EnergyProfile>,
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

    // TODO: CPI call to profile::init_profile() with metadata
    // profile::cpi::init_profile(...)

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
pub struct RevokeDevice<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"producer", producer.device_id.as_ref()],
        bump,
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
