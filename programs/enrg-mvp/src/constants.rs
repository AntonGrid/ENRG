/// SRC token decimals (on-chain mint decimals).
pub const SRC_DECIMALS: u8 = 9;

/// Smallest SRC unit used in reward math.
/// Исторически это было ENRG_BASIS = 10^(decimals - 6).
/// При 9 знаках после запятой:
///   - 1 SRC = 10^9 атомарных единиц;
///   - SRC_BASIS = 10^3 — масштабный коэффициент для формул награды.
pub const SRC_BASIS: u64 = 10u64.pow(SRC_DECIMALS as u32 - 6);

/// Protocol commission (% of gross reward).
pub const COMMISSION_PERCENT: u64 = 15;

/// Buyback allocation (% of commission).
pub const BUYBACK_PERCENT: u64 = 20;

/// Staking allocation (% of commission).
pub const STAKING_PERCENT: u64 = 40;

/// DAO allocation (% of commission).
pub const DAO_PERCENT: u64 = 30;

/// Maximum SRC supply (in whole tokens).
/// Интерпретация:
///   - max 1_000_000_000 SRC;
///   - при базовом уровне сложности это соответствует ~1e9 MWh
///     совокупной выработки (см. INITIAL_ENERGY_PER_SRC).
pub const MAX_SUPPLY: u64 = 1_000_000_000;

/// Asymptotic emission coefficient K for difficulty = K^share.
/// share = total_supply / MAX_SUPPLY ∈ [0, 1].
/// При K = 10:
///   - на старте сложность ≈ 1;
///   - при половине эмиссии — √10 ≈ 3.16;
///   - к концу эмиссии — 10x от стартовой.
pub const EMISSION_DIFFICULTY_K: u64 = 10;

/// Base energy required per token unit at zero supply (Wh).
/// При total_supply = 0:
///   energy_per_src(0) = INITIAL_ENERGY_PER_SRC = 1_000_000 Wh = 1 MWh.
/// То есть в ранней фазе:
///   ~1 SRC соответствует ~1 MWh выработанной/подтверждённой энергии.
pub const INITIAL_ENERGY_PER_SRC: u64 = 1_000_000;

/// Default energy pool threshold (Wh).
pub const DEFAULT_POOL_THRESHOLD: u128 = 1_000_000;

/// Founder vesting duration (4 years).
pub const FOUNDER_VESTING_DURATION: i64 =
    4 * 365 * 24 * 60 * 60;
