use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized signer")]
    Unauthorized,

    #[msg("Proof is too old")]
    StaleProof,

    #[msg("Proof timestamp is in the future")]
    FutureProof,

    #[msg("Proof has already been processed")]
    DuplicateProof,

    #[msg("Invalid Ed25519 signature")]
    InvalidSignature,

    #[msg("Energy reading exceeds maximum allowed for device power rating")]
    ExcessiveEnergy,

    #[msg("Nonce must be greater than previous nonce")]
    InvalidNonce,

    #[msg("Device is not active")]
    DeviceNotActive,

    #[msg("Device is not provisioned")]
    DeviceNotProvisioned,

    #[msg("Policy rejected proof")]
    PolicyRejected,

    #[msg("Insufficient stake to withdraw")]
    InsufficientStake,

    #[msg("No staked amount or staking pool empty")]
    NoStake,

    #[msg("1-year cliff period has not passed")]
    CliffNotReached,

    #[msg("No vested tokens available to claim at this time")]
    NothingToClaim,

    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,

    #[msg("Mint amount must be greater than zero")]
    ZeroAmountMint,

    #[msg("Invalid parameter")]
    InvalidParameter,

    #[msg("Excessive energy required")]
    ExcessiveEnergyRequired,

    #[msg("Insufficient energy")]
    InsufficientEnergy,

    #[msg("Maximum supply reached")]
    MaxSupplyReached,

    #[msg("Emission limit reached")]
    EmissionLimitReached,

    #[msg("Producer already belongs to pool")]
    AlreadyInPool,

    #[msg("Object already exists")]
    AlreadyExists,

    #[msg("Object not found")]
    NotFound,
}
