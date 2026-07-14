use anchor_lang::prelude::*;

use crate::constants::*;

/// Global protocol state.
///
/// Vault stores protocol economics,
/// emission state and global statistics.
///
/// SPL mint configuration is maintained
/// separately by the TokenMint PDA.
#[account]
pub struct Vault {
    /// Wallet that deployed the protocol.
    pub deployer: Pubkey,

    /// Current protocol authority.
    pub authority: Pubkey,

    /// Protocol version.
    pub protocol_version: u16,

    /// Total SRC minted.
    pub total_supply: u64,

    /// Maximum SRC supply.
    pub max_supply: u64,

    /// Current emission coefficient.
    pub emission_k: u64,

    /// Total verified energy (Wh).
    pub total_energy_wh: u128,

    /// Total registered producers.
    pub total_producers: u64,

    /// Total accepted proofs.
    pub total_proofs: u64,
}

impl Vault {
    pub const LEN: usize =
        32 + // deployer
        32 + // authority
        2  + // protocol_version
        8  + // total_supply
        8  + // max_supply
        8  + // emission_k
        16 + // total_energy_wh
        8  + // total_producers
        8;   // total_proofs
}

impl Default for Vault {
    fn default() -> Self {
        Self {
            deployer: Pubkey::default(),
            authority: Pubkey::default(),

            protocol_version: 1,

            total_supply: 0,
            max_supply: MAX_SUPPLY,

            emission_k: EMISSION_DIFFICULTY_K,

            total_energy_wh: 0,
            total_producers: 0,
            total_proofs: 0,
        }
    }
}
