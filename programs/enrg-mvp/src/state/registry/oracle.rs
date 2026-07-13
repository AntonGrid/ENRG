use anchor_lang::prelude::*;

/// Oracle Registry.
///
/// Stores the set of trusted Oracle identities
/// authorized to submit verified reports
/// to the ENRG Protocol.
#[account]
pub struct OracleRegistry {
    /// Registry authority (DAO / Governance).
    pub authority: Pubkey,

    /// Trusted Oracle identities.
    pub oracles: Vec<Pubkey>,
}

impl OracleRegistry {
    /// Maximum number of trusted Oracles.
    pub const MAX_ORACLES: usize = 100;

    pub const LEN: usize =
        32 +                              // authority
        4 + Self::MAX_ORACLES * 32;       // Vec<Pubkey>
}
