use anchor_lang::prelude::*;

/// EnergyProfile — stores device metadata and the rolling energy window.
///
/// Seeds PDA: [b"profile", authority.key().as_ref()]
#[account]
pub struct EnergyProfile {
    /// Profile owner (authority).
    pub authority: Pubkey,
    /// Device ID (from the Device Registry).
    pub device_id: Pubkey,
    /// Device rated power (W).
    pub rated_power: u64,
    /// Device type (string up to 32 bytes).
    pub device_type: String,
    /// Location (string up to 64 bytes).
    pub location: String,
    /// Rolling energy window for 30 days (Wh).
    pub device_energy_30d: u128,
    /// Time of the last window update.
    pub device_energy_updated_at: i64,
    /// Bump seed for the PDA.
    pub bump: u8,
}

impl EnergyProfile {
    pub const MAX_DEVICE_TYPE_LEN: usize = 32;
    pub const MAX_LOCATION_LEN: usize = 64;

    pub const SIZE: usize = 8 + // discriminator Anchor
        32 + // authority
        32 + // device_id
        8 +  // rated_power
        4 + Self::MAX_DEVICE_TYPE_LEN + // device_type (String)
        4 + Self::MAX_LOCATION_LEN + // location (String)
        16 + // device_energy_30d
        8 +  // device_energy_updated_at
        1;   // bump
}