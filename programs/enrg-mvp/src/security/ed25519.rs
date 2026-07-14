use anchor_lang::prelude::*;

/// Ed25519 verification layer.
///
/// NOTE:
/// The ENRG Protocol relies on Solana's native
/// Ed25519Program for signature verification.
///
/// Oracle transactions must include a successful
/// Ed25519 verification instruction before
/// invoking Protocol Core.
///
/// This module serves as the protocol interface
/// for signature verification and will be extended
/// with instruction introspection.
pub fn verify_oracle_signature() -> Result<()> {
    Ok(())
}
