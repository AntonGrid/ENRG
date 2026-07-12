use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Proof {
    /// Sequential proof number.
    pub nonce: u64,

    /// UNIX timestamp.
    pub timestamp: i64,

    /// Verified energy in Wh.
    pub energy_wh: u64,

    /// Ed25519 signature produced by the device.
    pub signature: [u8; 64],
}
