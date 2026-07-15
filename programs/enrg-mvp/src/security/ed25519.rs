use anchor_lang::prelude::*;

/// Ed25519 verification placeholder.
/// Full CPI integration will be added after dependency resolution.
pub fn verify_ed25519_signature(
    _signature: &[u8; 64],
    _public_key: &[u8; 32],
    _message: &[u8],
) -> Result<()> {
    // Placeholder — returns success without verification
    Ok(())
}

pub fn verify_oracle_signature(
    _signature: &[u8; 64],
    _pubkey: &[u8; 32],
    _data: &[u8],
) -> Result<()> {
    // Placeholder — returns success without verification
    Ok(())
}
