use anchor_lang::prelude::*;

/// Built-in Solana Ed25519 program (precompile).
/// Used for on-chain Ed25519 signature verification.
pub const ED25519_PROGRAM_ID: Pubkey =
    pubkey!("Ed25519SigVerify111111111111111111111111111");

/// Instructions sysvar — list of instructions in the current transaction.
/// Required for verifying Ed25519 signatures inside a transaction.
pub const INSTRUCTIONS_SYSVAR_ID: Pubkey =
    pubkey!("Sysvar1nstructions1111111111111111111111111");

/// Program ID of the on-chain enrg-profile program (CPI target for
/// register_device / mint_energy). Matches the declared ID in
/// `programs/enrg-profile/src/lib.rs` and the address in `idls/enrg_profile.json`.
pub const ENRG_PROFILE_PROGRAM_ID: Pubkey =
    pubkey!("78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt");

/// Allowed clock skew when validating timestamps (sec).
pub const MAX_CLOCK_SKEW: i64 = 300;

/// Number of decimal places for the SRC token.
pub const SRC_DECIMALS: u8 = 9;

/// Scaling basis used in reward formulas (atomars per "basis unit").
/// SRC_BASIS = 10^(SRC_DECIMALS - 6) = 10^3.
/// Kept separate from the supply cap; it only scales energy->reward math.
pub const SRC_BASIS: u64 = 10u64.pow(SRC_DECIMALS as u32 - 6);

/// Total commission (per cent) taken from each gross reward.
pub const COMMISSION_PERCENT: u64 = 15;

/// Buyback fund share (per cent) of the commission.
pub const BUYBACK_PERCENT: u64 = 20;
/// Staking fund share (per cent) of the commission.
pub const STAKING_PERCENT: u64 = 40;
/// DAO fund share (per cent) of the commission.
pub const DAO_PERCENT: u64 = 30;
// Emergency fund receives the remainder of the commission.

/// --- SRC total supply ---
/// The product intends a total of 1_000_000_000 (1 billion) SRC tokens.
/// Like Bitcoin is counted in satoshis, all on-chain supply accounting
/// happens in ATOMIC units (1 SRC == 10^9 atomics / "atomic units").
///
/// MAX_SUPPLY is therefore measured in ATOMIC units:
///   1_000_000_000 SRC * 10^9 = 10^18 atomics.
///
/// vault.total_supply (atomars) is compared against this number.
pub const MAX_SUPPLY_ATOMIC: u64 = 1_000_000_000_000_000_000; // 1e18

/// Backward-compatible name kept for references that still use MAX_SUPPLY.
#[deprecated(note = "use MAX_SUPPLY_ATOMIC; value now in atomic units = 1e18")]
pub const MAX_SUPPLY: u64 = MAX_SUPPLY_ATOMIC;

/// Asymptotic difficulty exponent for the emission curve.
pub const EMISSION_DIFFICULTY_K: u64 = 10;

/// Initial energy (Wh) required to mine one SRC "basis" unit at emission start.
/// energy_per_src(0) = INITIAL_ENERGY_PER_SRC = 1_000_000 Wh = 1 MWh.
pub const INITIAL_ENERGY_PER_SRC: u64 = 1_000_000;

/// Default energy pool threshold (Wh).
pub const DEFAULT_POOL_THRESHOLD: u128 = 1_000_000;

/// Founder vesting duration (4 years).
pub const FOUNDER_VESTING_DURATION: i64 =
    4 * 365 * 24 * 60 * 60;

/// Founder wallet (prod) — единый бенефициар founder-вестинга и источник
/// всех founder-ролей. Адрес зашит в программу: вестинг-аккаунт можно
/// инициализировать и получать средства только этим кошельком.
/// (Devnet продолжает использовать текущий program authority.)
pub const FOUNDER_WALLET: Pubkey =
    pubkey!("6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8");
