use anchor_lang::prelude::*;

#[account]
pub struct ManifestVerification {
    /// Manifest ID (matches the UUID from the off-chain registry)
    pub manifest_id: [u8; 16],

    /// ED25519 public key of the publisher (32 bytes)
    pub publisher_key: [u8; 32],

    /// Manifest content hash (Keccak256, 32 bytes)
    pub content_hash: [u8; 32],

    /// ED25519 signature (64 bytes)
    pub signature: [u8; 64],

    /// Publication timestamp
    pub created_at: i64,

    /// Verification status
    pub verified: bool,

    /// Manifest schema version
    pub manifest_version: u8,

    /// Reserved for future extensions
    pub reserved: [u8; 32],
}

impl ManifestVerification {
    pub const SPACE: usize = 8 + 16 + 32 + 32 + 64 + 8 + 1 + 1 + 32;
}
