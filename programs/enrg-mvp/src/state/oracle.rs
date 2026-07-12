use anchor_lang::prelude::*;

/// Oracle submission metadata.
///
/// This structure represents verified data
/// accepted by the ENRG Oracle before
/// entering the Protocol Core.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OracleReport {
    /// Oracle identity.
    pub oracle: Pubkey,

    /// Device identifier.
    pub device_id: Pubkey,

    /// Verified proof.
    pub proof: Proof,

    /// Verification timestamp.
    pub verified_at: i64,
}

use crate::state::Proof;
