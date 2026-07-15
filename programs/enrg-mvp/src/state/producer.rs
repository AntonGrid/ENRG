use anchor_lang::prelude::*;

#[account]
pub struct EnergyProducer {
    /// Wallet that owns the producer.
    pub authority: Pubkey,

    /// Physical device identifier.
    pub device_id: Pubkey,

    /// Last accepted nonce.
    pub nonce: u64,

    /// Total verified energy (Wh).
    pub energy_wh: u64,

    /// Timestamp of the last accepted proof.
    pub timestamp: i64,

    /// Initialization flag.
    pub is_initialized: bool,

    /// Maximum device power in watts.
    pub max_power_w: u64,
}

impl EnergyProducer {
    pub const LEN: usize =
        32 + // authority
        32 + // device_id
        8  + // nonce
        8  + // energy_wh
        8  + // timestamp
        1  + // is_initialized
        8;   // max_power_w
}
