use anchor_lang::prelude::*;

#[account]
pub struct MerkleProofVerification {
    /// Registry PDA (links to the ManifestRegistry)
    pub registry: Pubkey,

    /// Manifest verification account that was proven
    pub manifest_verification: Pubkey,

    /// Merkle root against which proof was verified
    pub verified_root: [u8; 32],

    /// Timestamp of verification
    pub verified_at: i64,

    /// Proof path length (for efficiency checks)
    pub proof_length: u8,

    /// Device or verifier that submitted the proof
    pub verified_by: Pubkey,

    /// Reserved for future extensions
    pub reserved: [u8; 64],
}

impl MerkleProofVerification {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 1 + 32 + 64;
}
