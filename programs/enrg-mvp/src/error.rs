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
    #[msg("Overflow in registry version counter")]
    RegistryOverflow,
    #[msg("Manifest ID in verification account does not match provided manifest_id")]
    ManifestIdMismatch,
    #[msg("Merkle proof path is too long (max 32 levels)")]
    ProofPathTooLong,
    #[msg("Proof does not match registry root")]
    InvalidProof,
    #[msg("Leaf hash is invalid (all zeros)")]
    InvalidLeafHash,
    #[msg("Mint only allowed into the token account owned by the producer's owner")]
    UnauthorizedTokenAccountOwner,
    #[msg("Report device_id does not match the producer's registered device")]
    DeviceMismatch,
    #[msg("Signer is not the owner of the producer")]
    NotProducerOwner,
    #[msg("Report oracle is not in the trusted Oracle Registry")]
    UntrustedOracle,
    #[msg("Instructions sysvar is required for Ed25519 signature verification")]
    InvalidInstructionsAccount,
    #[msg("Timestamp is in the future")]
    FutureTimestamp,
    #[msg("Device limit per owner reached")]
    DeviceLimitReached,
    #[msg("Supply limit exceeded")]
    SupplyLimitExceeded,
    #[msg("Founder premine already minted")]
    FounderPremineAlreadyMinted,
    // ── Governance MVP (ADR-0009) ──
    #[msg("Not governance authority")]
    NotGovernanceAuthority,
    #[msg("Not a governance member")]
    NotGovernanceMember,
    #[msg("Member already voted")]
    MemberAlreadyVoted,
    #[msg("No active proposal")]
    NoActiveProposal,
    #[msg("Proposal is not active")]
    ProposalNotActive,
    #[msg("Proposal is not approved")]
    ProposalNotApproved,
    #[msg("Timelock not elapsed yet")]
    TimelockNotElapsed,
    #[msg("Proposal amount exceeds the cap")]
    AmountCapExceeded,
    #[msg("Proposal not found")]
    ProposalNotFound,
    #[msg("Invalid member list (must be 3..=5 unique members)")]
    InvalidMemberList,
    #[msg("Duplicate member in list")]
    DuplicateMember,
    #[msg("Destination token account mint mismatch")]
    DestinationMintMismatch,
    #[msg("Device tier monthly mining limit exceeded")]
    TierLimitExceeded,
    #[msg("Producer is not a pool member")]
    NotInPool,
    #[msg("Pool distribution threshold not reached")]
    PoolThresholdNotReached,
}
