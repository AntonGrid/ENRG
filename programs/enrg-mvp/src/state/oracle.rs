use anchor_lang::prelude::*;

/// Verified Oracle report.
///
/// This is the only trusted object accepted
/// by the ENRG Protocol Core.
///
/// The report is authenticated by TWO signatures:
/// - `device_signature` — the device confirms (device_id, nonce, device_timestamp, energy_wh);
/// - `oracle_signature` — the trusted oracle confirms that it verified the
///   device data (device_id, nonce, device_timestamp, verified_at, energy_wh).
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

    /// Oracle signature over the aggregated (verified) report.
    pub oracle_signature: [u8; 64],
}

impl OracleReport {
    /// Serialize the fields signed by the DEVICE.
    /// This produces the exact message that was signed by the device.
    pub fn device_message_to_sign(&self) -> Result<Vec<u8>> {
        let mut buf = Vec::with_capacity(32 + 8 + 8 + 8);

        buf.extend_from_slice(&self.device_id.to_bytes());
        buf.extend_from_slice(&self.nonce.to_le_bytes());
        buf.extend_from_slice(&self.device_timestamp.to_le_bytes());
        buf.extend_from_slice(&self.energy_wh.to_le_bytes());

        Ok(buf)
    }

    /// Serialize the fields signed by the ORACLE.
    /// Binds the oracle verification tag to the device data.
    pub fn oracle_message_to_sign(&self) -> Result<Vec<u8>> {
        let mut buf = Vec::with_capacity(32 + 8 + 8 + 8 + 8);

        buf.extend_from_slice(&self.device_id.to_bytes());
        buf.extend_from_slice(&self.nonce.to_le_bytes());
        buf.extend_from_slice(&self.device_timestamp.to_le_bytes());
        buf.extend_from_slice(&self.verified_at.to_le_bytes());
        buf.extend_from_slice(&self.energy_wh.to_le_bytes());

        Ok(buf)
    }

    /// Canonical proof hash used by the oracle quorum (P3-6).
    ///
    /// MUST be computed from the DEVICE-signed data only
    /// (`device_message_to_sign`: device_id ‖ nonce ‖ device_timestamp ‖
    /// energy_wh) — NOT from the oracle message, which includes `verified_at`
    /// (each oracle verifies at a slightly different moment, so an oracle-based
    /// hash would never match across independent oracles → false conflicts).
    /// Oracles vote on `b"enrg:oracle:attest" || device || nonce || proof_hash`
    /// in `submit_oracle_attestation`, and `mint_energy` (when the quorum is
    /// required) demands a finalized attestation whose hash equals this value.
    pub fn proof_hash(&self) -> Result<[u8; 32]> {
        let msg = self.device_message_to_sign()?;
        Ok(solana_sha256_hasher::hash(&msg).to_bytes())
    }
}
