/// SRC token decimals.
pub const SRC_DECIMALS: u8 = 9;

/// Smallest SRC unit corresponding to 0.001 SRC.
pub const SRC_BASIS: u64 =
    10u64.pow(SRC_DECIMALS as u32 - 6);

/// Protocol commission (%).
pub const COMMISSION_PERCENT: u64 = 15;

/// Buyback allocation (% of commission).
pub const BUYBACK_PERCENT: u64 = 20;

/// Staking allocation (% of commission).
pub const STAKING_PERCENT: u64 = 40;

/// DAO allocation (% of commission).
pub const DAO_PERCENT: u64 = 30;

/// Maximum SRC supply.
pub const MAX_SUPPLY: u64 =
    1_000_000_000;

/// Asymptotic emission coefficient.
pub const EMISSION_DIFFICULTY_K: u64 = 10;

/// Initial energy required to mint approximately one SRC (Wh).
///
/// The actual reward is calculated dynamically according to
/// the asymptotic emission model.
pub const INITIAL_ENERGY_PER_SRC: u64 =
    1_000_000;

/// Default energy pool threshold (Wh).
pub const DEFAULT_POOL_THRESHOLD: u128 =
    1_000_000;
