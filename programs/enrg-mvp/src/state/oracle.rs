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

impl OracleReport {
    /// Serialize report fields excluding signature.
    /// This produces the exact message that was signed by the device.
    pub fn message_to_sign(&self) -> Result<Vec<u8>> {
        let mut buf = Vec::with_capacity(8 + 8 + 8 + 8);

        // Serialize only the fields the device signs:
        // device_id + nonce + device_timestamp + energy_wh
        buf.extend_from_slice(&self.device_id.to_bytes());
        buf.extend_from_slice(&self.nonce.to_le_bytes());
        buf.extend_from_slice(&self.device_timestamp.to_le_bytes());
        buf.extend_from_slice(&self.energy_wh.to_le_bytes());

        Ok(buf)
    }
}
