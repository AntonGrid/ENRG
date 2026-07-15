use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    // Protocol errors
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Invalid nonce")]
    InvalidNonce,
    #[msg("Stale proof")]
    StaleProof,
    #[msg("Excessive energy")]
    ExcessiveEnergy,
    #[msg("Insufficient stake")]
    InsufficientStake,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Already in pool")]
    AlreadyInPool,
    #[msg("Invalid parameter")]
    InvalidParameter,
    #[msg("Not found")]
    NotFound,
    #[msg("Already exists")]
    AlreadyExists,
    #[msg("Zero amount mint")]
    ZeroAmountMint,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    // Ed25519 verification errors
    #[msg("Invalid signature length")]
    InvalidSignatureLength,
    #[msg("Invalid public key length")]
    InvalidPublicKeyLength,
}
