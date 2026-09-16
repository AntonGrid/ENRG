use anchor_lang::prelude::*;

pub mod state;

use state::EnergyProfile;

declare_id!("78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt");

/// Re-export generated CPI module for external programs.
pub use self::enrg_profile::*;

/// Maximum device rated power (W).
///
/// Upper bound of rated_power — manipulation protection (audit BLOCK 4):
/// without it, an owner could set an arbitrarily large power and thus
/// inflate the mint cap (enrg-mvp::mint_energy checks
/// `report.energy_wh <= profile.rated_power`).
/// M-4: lowered from 100 GW to 1 MW (1_000_000 W) — for unverified devices
/// the per-report cap is now ≤ 1 MWh. Verified profiles with higher power
/// require a separate verification/upgrade procedure.
pub const MAX_RATED_POWER: u64 = 1_000_000; // 1 MW

/// enrg-mvp program id — the only program allowed to write the rolling window
/// WITHOUT the profile owner's signature (through its `mint-authority` PDA).
///
/// Audit 2026-09-16: `record_production` requires the profile owner to sign and
/// `mint_energy` derives the profile PDA from `producer.authority`, so the mint
/// transaction had to be signed by the device owner. The oracle could therefore
/// mint only for devices owned by its own key and rewards could never reach a
/// different owner wallet. This constant enables the authorized path.
pub const ENRG_MVP_PROGRAM_ID: Pubkey = pubkey!("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");

/// Seed of the enrg-mvp PDA that signs the authorized CPI.
pub const MINT_AUTHORITY_SEED: &[u8] = b"mint-authority";

/// The enrg-mvp `mint-authority` PDA (derived on the fly, never stored).
pub fn mint_authority_pda() -> Pubkey {
    Pubkey::find_program_address(&[MINT_AUTHORITY_SEED], &ENRG_MVP_PROGRAM_ID).0
}

/// Shared rolling-window update (both entry points must agree exactly).
fn record_production_inner(profile: &mut EnergyProfile, energy_wh: u64, timestamp: i64) {
    profile.device_energy_30d = update_energy_window_u128(
        profile.device_energy_30d,
        profile.device_energy_updated_at,
        timestamp,
        energy_wh as u128,
    );
    profile.device_energy_updated_at = timestamp;
}

/// Updates the device rolling energy window (30-day window).
/// Subtracts the energy that left the window and adds the new energy.
fn update_energy_window_u128(
    current_window: u128,
    last_updated_at: i64,
    now: i64,
    new_energy: u128,
) -> u128 {
    const THIRTY_DAYS_SECONDS: i64 = 30 * 24 * 60 * 60;

    let elapsed = now - last_updated_at;

    if elapsed <= 0 {
        // Time did not move forward — just add
        return current_window.saturating_add(new_energy);
    }

    if elapsed >= THIRTY_DAYS_SECONDS {
        // More than 30 days passed — the window resets completely
        return new_energy;
    }

    // Proportional decay of the old window
    let decay = (current_window as u128)
        .saturating_mul(elapsed as u128)
        .saturating_div(THIRTY_DAYS_SECONDS as u128);

    let remaining = current_window.saturating_sub(decay);
    remaining.saturating_add(new_energy)
}

#[program]
pub mod enrg_profile {
    use super::*;

    /// Creates the EnergyProfile PDA for the given authority.
    ///
    /// Seeds: [b"profile", authority.key().as_ref()]
    pub fn initialize_profile(
        ctx: Context<InitializeProfile>,
        device_id: Pubkey,
        rated_power: u64,
        device_type: String,
        location: String,
    ) -> Result<()> {
        require!(
            device_type.len() <= EnergyProfile::MAX_DEVICE_TYPE_LEN,
            ErrorCode::DeviceTypeTooLong
        );
        require!(
            location.len() <= EnergyProfile::MAX_LOCATION_LEN,
            ErrorCode::LocationTooLong
        );
        require!(
            rated_power <= MAX_RATED_POWER,
            ErrorCode::RatedPowerTooHigh
        );

        let profile = &mut ctx.accounts.profile;
        profile.authority = ctx.accounts.authority.key();
        profile.device_id = device_id;
        profile.rated_power = rated_power;
        profile.device_type = device_type;
        profile.location = location;
        profile.device_energy_30d = 0;
        profile.device_energy_updated_at = Clock::get()?.unix_timestamp;
        profile.bump = ctx.bumps.profile;

        Ok(())
    }

    /// Updates device metadata (rated_power, device_type, location).
    /// Only the profile authority can call it.
    ///
    /// M-4: rated_power is IMMUTABLE after the first assignment — the owner
    /// cannot "raise their own mint cap". A change is only possible via a
    /// verification/upgrade procedure (beyond the MVP scope; requires an
    /// upgrade instruction with governance control). The change is recorded
    /// by the RatedPowerChanged event.
    pub fn update_metadata(
        ctx: Context<UpdateMetadata>,
        rated_power: u64,
        device_type: String,
        location: String,
    ) -> Result<()> {
        require!(
            device_type.len() <= EnergyProfile::MAX_DEVICE_TYPE_LEN,
            ErrorCode::DeviceTypeTooLong
        );
        require!(
            location.len() <= EnergyProfile::MAX_LOCATION_LEN,
            ErrorCode::LocationTooLong
        );
        require!(
            rated_power <= MAX_RATED_POWER,
            ErrorCode::RatedPowerTooHigh
        );

        let profile = &mut ctx.accounts.profile;

        // M-4: the first call (0 → N) sets the power; any subsequent
        // rated_power changes are rejected (RatedPowerImmutable).
        let old_rated_power = profile.rated_power;
        if old_rated_power != 0 && rated_power != old_rated_power {
            return err!(ErrorCode::RatedPowerImmutable);
        }

        profile.rated_power = rated_power;
        profile.device_type = device_type;
        profile.location = location;

        if old_rated_power != profile.rated_power {
            emit!(RatedPowerChanged {
                profile: profile.key(),
                old_rated_power,
                new_rated_power: profile.rated_power,
                changed_by: ctx.accounts.authority.key(),
                timestamp: Clock::get()?.unix_timestamp,
            });
        }

        Ok(())
    }

    /// Records energy production into the device rolling window.
    /// Called via CPI from enrg-mvp on every mint.
    /// Requires the PROFILE OWNER's signature (legacy path, kept for
    /// compatibility; `mint_energy` uses `record_production_authorized`).
    pub fn record_production(
        ctx: Context<RecordProduction>,
        energy_wh: u64,
        timestamp: i64,
    ) -> Result<()> {
        record_production_inner(&mut ctx.accounts.profile, energy_wh, timestamp);

        msg!(
            "record_production: device_energy_30d={}",
            ctx.accounts.profile.device_energy_30d
        );

        Ok(())
    }

    /// Records production WITHOUT the profile owner's signature.
    ///
    /// Used by `enrg-mvp::mint_energy` so an oracle can mint for a device owned by
    /// ANY wallet (the reward goes to `producer.authority`, not to the signer).
    ///
    /// Authorization: `caller` MUST be the enrg-mvp `mint-authority` PDA
    /// (`mint_authority_pda()`). That PDA is owned by enrg-mvp, so only enrg-mvp
    /// can sign for it — no third party can move a device's window. Everything
    /// else (device Ed25519 signature, oracle signature, nonce, freshness, policy)
    /// was already validated by `mint_energy` before this CPI.
    pub fn record_production_authorized(
        ctx: Context<RecordProductionAuthorized>,
        energy_wh: u64,
        timestamp: i64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.caller.key(),
            mint_authority_pda(),
            ErrorCode::UnauthorizedCaller
        );

        record_production_inner(&mut ctx.accounts.profile, energy_wh, timestamp);

        msg!(
            "record_production_authorized: device_energy_30d={} authority={}",
            ctx.accounts.profile.device_energy_30d,
            ctx.accounts.authority.key()
        );

        Ok(())
    }

    /// View function to read the profile.
    /// Returns all EnergyProfile fields.
    pub fn read_profile(ctx: Context<ReadProfile>) -> Result<EnergyProfile> {
        let profile = &ctx.accounts.profile;
        Ok(EnergyProfile {
            authority: profile.authority,
            device_id: profile.device_id,
            rated_power: profile.rated_power,
            device_type: profile.device_type.clone(),
            location: profile.location.clone(),
            device_energy_30d: profile.device_energy_30d,
            device_energy_updated_at: profile.device_energy_updated_at,
            bump: profile.bump,
        })
    }
}

// ═══════════════════════════════════════════
//  Account validation structs
// ═══════════════════════════════════════════

#[derive(Accounts)]
pub struct InitializeProfile<'info> {
    /// Profile owner (signs the transaction).
    #[account(mut)]
    pub authority: Signer<'info>,

    /// EnergyProfile PDA, created with seeds [b"profile", authority.key().as_ref()].
    #[account(
        init,
        seeds = [b"profile", authority.key().as_ref()],
        bump,
        payer = authority,
        space = EnergyProfile::SIZE
    )]
    pub profile: Account<'info, EnergyProfile>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMetadata<'info> {
    /// Profile owner (signs the transaction).
    pub authority: Signer<'info>,

    /// PDA EnergyProfile.
    #[account(
        mut,
        seeds = [b"profile", authority.key().as_ref()],
        bump = profile.bump
    )]
    pub profile: Account<'info, EnergyProfile>,
}

#[derive(Accounts)]
pub struct RecordProduction<'info> {
    /// Profile owner (authority) — signs the CPI.
    pub authority: Signer<'info>,

    /// EnergyProfile PDA (mut for updating the rolling window).
    #[account(
        mut,
        seeds = [b"profile", authority.key().as_ref()],
        bump = profile.bump
    )]
    pub profile: Account<'info, EnergyProfile>,
}

/// Authorized production recording (see `record_production_authorized`).
///
/// The profile owner does NOT sign: `caller` is enrg-mvp, which signs the CPI with
/// its own `mint-authority` PDA. `authority` only participates in the PDA seeds
/// and the `constraint` proves it is the profile's real owner, so a caller cannot
/// redirect the update to a foreign profile.
#[derive(Accounts)]
pub struct RecordProductionAuthorized<'info> {
    /// Must equal the enrg-mvp `mint-authority` PDA (checked in the handler).
    pub caller: Signer<'info>,

    /// Profile owner (NOT a signer) — used only for the PDA seeds.
    /// CHECK: constrained by the `profile` seeds and the constraint below.
    pub authority: UncheckedAccount<'info>,

    /// EnergyProfile PDA (mut for updating the rolling window).
    #[account(
        mut,
        seeds = [b"profile", authority.key().as_ref()],
        bump = profile.bump,
        constraint = profile.authority == authority.key() @ ErrorCode::ProfileAuthorityMismatch
    )]
    pub profile: Account<'info, EnergyProfile>,
}

#[derive(Accounts)]
pub struct ReadProfile<'info> {
    /// EnergyProfile PDA (read-only).
    #[account(
        seeds = [b"profile", authority.key().as_ref()],
        bump = profile.bump
    )]
    pub profile: Account<'info, EnergyProfile>,

    /// Authority whose profile is read (not necessarily the signer).
    /// CHECK: used only for deriving the PDA seeds.
    pub authority: UncheckedAccount<'info>,
}

// ═══════════════════════════════════════════
//  Error codes
// ═══════════════════════════════════════════

#[error_code]
pub enum ErrorCode {
    #[msg("Device type string exceeds maximum length (32 bytes)")]
    DeviceTypeTooLong,
    #[msg("Location string exceeds maximum length (64 bytes)")]
    LocationTooLong,
    #[msg("Rated power exceeds the maximum allowed (1 MW)")]
    RatedPowerTooHigh,
    // M-4: changing rated_power after the first assignment is forbidden
    // (only a verification/upgrade procedure via governance).
    #[msg("Rated power is immutable after initial assignment")]
    RatedPowerImmutable,
    // Audit 2026-09-16: authorized production recording (oracle-side mint).
    #[msg("Caller is not the enrg-mvp mint-authority PDA")]
    UnauthorizedCaller,
    #[msg("Profile authority does not match the provided authority account")]
    ProfileAuthorityMismatch,
}

// M-4: audit event for rated_power changes.
#[event]
pub struct RatedPowerChanged {
    pub profile: Pubkey,
    pub old_rated_power: u64,
    pub new_rated_power: u64,
    pub changed_by: Pubkey,
    pub timestamp: i64,
}