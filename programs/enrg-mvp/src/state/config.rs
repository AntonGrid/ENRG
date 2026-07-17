use anchor_lang::prelude::*;

/// Protocol configuration PDA.
///
/// Stores the active Oracle identity and SRC Mint address
/// for the current protocol session.
///
/// This is NOT a registry — it stores the *working pair*
/// (oracle + mint) that the protocol uses at any given time.
/// The full set of trusted oracles lives in OracleRegistry.
///
/// Single Responsibility:
///   Config = active oracle + mint binding
///   Vault   = protocol economics
///   OracleRegistry = set of trusted oracles
#[account]
pub struct Config {
    /// Protocol authority who initialized the config.
    pub authority: Pubkey,

    /// Active trusted Oracle public key.
    pub oracle: Pubkey,

    /// SRC Mint address.
    pub mint: Pubkey,

    /// Config PDA bump.
    pub bump: u8,
}

impl Config {
    pub const LEN: usize =
        32 + // authority
        32 + // oracle
        32 + // mint
        1;   // bump
}
