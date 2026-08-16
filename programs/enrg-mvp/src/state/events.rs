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

/// Emitted when the oracle admin role changes (BLOCK 2 — разделение ролей).
#[event]
pub struct OracleAdminChanged {
    pub old_oracle_admin: Pubkey,
    pub new_oracle_admin: Pubkey,
    pub changed_by: Pubkey,
}

/// Emitted when the vault authority changes (single-step; multisig/timelock planned).
#[event]
pub struct VaultAuthorityChanged {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
    pub changed_by: Pubkey,
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
    /// Initiator of the burn (Vault.authority — governor).
    pub initiator: Pubkey,
}

/// Emitted after SRC are withdrawn from a protocol fund
/// (buyback / staking / dao / emergency) by the governor.
#[event]
pub struct FundsWithdrawn {
    /// Fund tag: 0=buyback, 1=staking, 2=dao, 3=emergency.
    pub fund_tag: u8,
    /// Amount of SRC transferred out of the fund.
    pub amount: u64,
    /// Destination token account.
    pub to: Pubkey,
    /// Initiator (Vault.authority as temporary governor).
    pub by: Pubkey,
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

/// Emitted when a device key is rotated (ADR-0007).
/// Старая запись помечается revoked/rotated_to; новая запись наследует
/// состояние (nonce, энергия, tier, owner).
#[event]
pub struct DeviceKeyRotated {
    /// Старый (отозванный) device_id.
    pub device_id: Pubkey,
    /// Новый device_id (публичный ключ устройства).
    pub new_device_id: Pubkey,
    /// Владелец (authority) — остаётся прежним.
    pub owner: Pubkey,
    /// Кто инициировал ротацию (owner или протокольный админ).
    pub changed_by: Pubkey,
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

/// Emitted when a device tier changes (v7.0 §15 — Trust Levels).
#[event]
pub struct DeviceTierSet {
    pub producer: Pubkey,
    pub tier: crate::state::producer::DeviceTier,
    pub changed_by: Pubkey,
}

/// Emitted when a profile anomaly reduces ERS (v7.0 §27).
#[event]
pub struct AnomalyReported {
    pub reputation: Pubkey,
    pub score_after: u32,
    pub severity: u8,
}

/// Emitted after ERS is refreshed by a mint (v7.0 §16).
#[event]
pub struct ReputationUpdated {
    pub reputation: Pubkey,
    pub score: u32,
    pub total_energy_wh: u64,
}

/// Emitted when a pool member's verified energy is recorded (v7.0 §14).
#[event]
pub struct PoolEnergyRecorded {
    pub pool: Pubkey,
    pub producer: Pubkey,
    pub energy_wh: u128,
    pub total_energy: u128,
}

/// Emitted when the pool crosses the distribution threshold (v7.0 §14).
#[event]
pub struct PoolThresholdReached {
    pub pool: Pubkey,
    pub total_energy: u128,
    pub threshold: u128,
}

/// Emitted after proportional pool distribution.
#[event]
pub struct PoolDistributed {
    pub pool: Pubkey,
    pub total_energy: u128,
    pub total_reward: u64,
    pub members: u32,
}

/// Emitted when the Policy Registry is initialized (ADR-0003).
#[event]
pub struct PolicyRegistryInitialized {
    pub authority: Pubkey,
    pub version: u64,
}

/// Emitted when the policy set is updated (ADR-0003).
#[event]
pub struct PolicyUpdated {
    pub policy_registry: Pubkey,
    pub mint_enabled: bool,
    pub enforce_oracle_whitelist: bool,
    pub enforce_device_state: bool,
    pub enforce_tier_limits: bool,
    pub enforce_energy_caps: bool,
    pub enforce_supply_cap: bool,
    pub max_energy_bps: u64,
    pub max_clock_skew_sec: i64,
    pub version: u64,
    pub updated_by: Pubkey,
}

/// Emitted when the policy authority role changes (ADR-0003 / ADR-0009).
#[event]
pub struct PolicyAuthorityChanged {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
    pub changed_by: Pubkey,
}

