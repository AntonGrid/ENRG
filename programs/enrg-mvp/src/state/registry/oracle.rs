use anchor_lang::prelude::*;

/// Oracle Registry.
///
/// Stores the set of trusted Oracle identities
/// authorized to submit verified reports
/// to the ENRG Protocol.
#[account]
pub struct OracleRegistry {
    /// Registry authority (protocol admin / governance root).
    pub authority: Pubkey,

    /// Oracle admin — управляет списком доверенных оракулов.
    /// Разделение ролей: protocol_admin (vault/funds/безопасность)
    /// vs oracle_admin (add/remove оракулов).
    pub oracle_admin: Pubkey,

    /// Trusted Oracle identities.
    pub oracles: Vec<Pubkey>,
}

impl OracleRegistry {
    /// Maximum number of trusted Oracles.
    pub const MAX_ORACLES: usize = 100;

    pub const LEN: usize =
        32 +                              // authority
        32 +                              // oracle_admin
        4 + Self::MAX_ORACLES * 32;       // Vec<Pubkey>

    /// Returns true if the Oracle is trusted.
    pub fn contains(
        &self,
        oracle: &Pubkey,
    ) -> bool {
        self.oracles.contains(oracle)
    }
}
