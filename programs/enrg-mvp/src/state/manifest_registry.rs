use anchor_lang::prelude::*;

#[account]
pub struct ManifestRegistry {
    /// Authority that can update Merkle root
    pub authority: Pubkey,

    /// Current Merkle root (256-bit hash)
    pub merkle_root: [u8; 32],

    /// Timestamp of the last root update
    pub updated_at: i64,

    /// Version of the registry (for upgrades)
    pub version: u64,

    /// Total number of manifests recorded
    pub manifest_count: u64,

    /// Padding for future expansions
    pub reserved: [u8; 64],
}

impl ManifestRegistry {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 64;
}
