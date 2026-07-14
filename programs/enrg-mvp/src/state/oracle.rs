use anchor_lang::prelude::*;

/// Verified Oracle report.
///
/// This is the only trusted object accepted
/// by the ENRG Protocol Core.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OracleReport {
    /// Trusted Oracle identity.
    pub oracle: Pubkey,

    /// Producer device.
    pub device_id: Pubkey,

    /// Sequential proof number.
    pub nonce: u64,

    /// Original device timestamp.
    pub device_timestamp: i64,

    /// Oracle verification timestamp.
    pub verified_at: i64,

    /// Verified energy.
    pub energy_wh: u64,

    /// Original device signature.
    pub device_signature: [u8; 64],
}
