use anchor_lang::prelude::*;

/// Emitted after a proof has been accepted by the protocol.
#[event]
pub struct ProofAccepted {
    pub producer: Pubkey,
    pub oracle: Pubkey,
    pub device_id: Pubkey,
    pub nonce: u64,
    pub energy_wh: u64,
}

/// Emitted after rewards have been distributed.
#[event]
pub struct RewardDistributed {
    pub producer: Pubkey,
    pub reward: u64,
    pub buyback: u64,
    pub staking: u64,
    pub dao: u64,
    pub emergency: u64,
}

/// Emitted when a producer joins a pool.
#[event]
pub struct PoolJoined {
    pub pool: Pubkey,
    pub producer: Pubkey,
}

/// Emitted when a trusted oracle is added.
#[event]
pub struct OracleAdded {
    pub oracle: Pubkey,
}

/// Emitted when a trusted oracle is removed.
#[event]
pub struct OracleRemoved {
    pub oracle: Pubkey,
}

/// Emitted whenever the emission curve changes.
#[event]
pub struct EmissionDifficultyChanged {
    /// Current total supply.
    pub current_supply: u64,

    /// Supply expressed as a fraction of MAX_SUPPLY (scaled by 1e18).
    pub supply_fraction: u128,

    /// Current energy required for one SRC token.
    pub energy_per_token: u128,
}

/// Emitted after tokens are burned from the buyback fund.
#[event]
pub struct TokensBurned {
    /// Amount of SRC burned.
    pub amount: u64,
    /// Remaining balance in buyback fund.
    pub remaining: u64,
    /// New total supply after burn.
    pub total_supply: u64,
}

/// Emitted when a device is registered
/// (ADR-0005: UNREGISTERED → REGISTERED; требует Ed25519-подпись устройства).
#[event]
pub struct DeviceRegistered {
    pub device_id: Pubkey,
    pub registered_by: Pubkey,
    pub timestamp: i64,
}

/// Emitted when a device is claimed by an owner
/// (ADR-0005: REGISTERED → CLAIMED; требует Ed25519-подпись устройства).
#[event]
pub struct DeviceClaimed {
    pub device_id: Pubkey,
    pub owner: Pubkey,
    pub claim_nonce: u64,
    pub timestamp: i64,
}

/// Emitted when a device is provisioned
/// (ADR-0005: CLAIMED → PROVISIONED; owner-gated).
#[event]
pub struct DeviceProvisioned {
    pub device_id: Pubkey,
    pub owner: Pubkey,
    pub timestamp: i64,
}

/// Emitted when a device is activated
/// (ADR-0005: PROVISIONED → ACTIVE; owner-gated).
#[event]
pub struct DeviceActivated {
    pub device_id: Pubkey,
    pub owner: Pubkey,
    pub timestamp: i64,
}

/// Emitted when a device is quarantined
/// (ADR-0005: ACTIVE → QUARANTINE; owner-gated).
#[event]
pub struct DeviceQuarantined {
    pub device_id: Pubkey,
    pub owner: Pubkey,
    pub timestamp: i64,
}

/// Emitted when a device is moved to maintenance
/// (ADR-0005: ACTIVE/QUARANTINE → MAINTENANCE; owner-gated).
#[event]
pub struct DeviceMaintenance {
    pub device_id: Pubkey,
    pub owner: Pubkey,
    pub timestamp: i64,
}

/// Emitted when a device is revoked
/// (ADR-0005: ACTIVE/QUARANTINE/MAINTENANCE → REVOKED; owner-gated, terminal state).
#[event]
pub struct DeviceRevoked {
    pub device_id: Pubkey,
    pub owner: Pubkey,
    pub timestamp: i64,
}

/// Emitted when a device is released from quarantine
/// (ADR-0005: QUARANTINE → ACTIVE; owner-gated).
#[event]
pub struct DeviceReleasedFromQuarantine {
    pub device_id: Pubkey,
    pub owner: Pubkey,
    pub timestamp: i64,
}
