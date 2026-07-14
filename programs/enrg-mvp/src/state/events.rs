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
