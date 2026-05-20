use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized signer")]
    Unauthorized,
    #[msg("Proof is too old")]
    StaleProof,
    #[msg("Invalid Ed25519 signature")]
    InvalidSignature,
    #[msg("Energy reading exceeds maximum allowed for device power rating")]
    ExcessiveEnergy,
    #[msg("Nonce must be greater than previous nonce")]
    InvalidNonce,
    #[msg("Insufficient stake to withdraw")]
    InsufficientStake,
    #[msg("No staked amount or staking pool empty")]
    NoStake,
    #[msg("1-year cliff period has not passed")]
    CliffNotReached,
    #[msg("No vested tokens available to claim at this time")]
    NothingToClaim,
    #[msg("Arithmetic overflow occurred")]
    MathOverflow,
    #[msg("Mint amount must be greater than zero")]
    ZeroAmountMint,
    #[msg("Commission allocation does not sum to 100%")]
    InvalidCommissionAllocation,
}