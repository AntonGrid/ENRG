use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
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
    #[msg("Invalid signature length")]
    InvalidSignatureLength,
    #[msg("Invalid public key length")]
    InvalidPublicKeyLength,
    #[msg("Ed25519 verification failed")]
    Ed25519VerificationFailed,
    #[msg("Device is not in the required state for this operation")]
    InvalidDeviceState,
    #[msg("Device state transition is not allowed")]
    InvalidStateTransition,
    #[msg("Device is in quarantine — minting is suspended")]
    DeviceInQuarantine,
    #[msg("Device is revoked — operation not allowed")]
    DeviceRevoked,
    #[msg("Device is not registered")]
    DeviceNotRegistered,
    #[msg("Device is already claimed by another wallet")]
    DeviceAlreadyClaimed,
}
