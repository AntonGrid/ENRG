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
/// Emergency fund share (per cent) of the commission.
/// Остаток комиссии после buyback/staking/dao достаётся emergency-фонду.
pub const EMERGENCY_PERCENT: u64 = 10;

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

/// Founder vesting: cliff 1 year (no tokens), then linear release over 3 years.
/// Full cycle = CLIFF + RELEASE = 4 years.
pub const FOUNDER_VESTING_CLIFF: i64 =
    365 * 24 * 60 * 60; // 1 year, fully locked
pub const FOUNDER_VESTING_RELEASE: i64 =
    3 * 365 * 24 * 60 * 60; // 3 years, linear (1/36 per month)

/// Founder allocation: 20% of MAX_SUPPLY_ATOMIC (1e18) = 2e17 atomic = 200M SRC.
pub const FOUNDER_ALLOCATION_ATOMIC: u64 =
    200_000_000_000_000_000; // 2e17

/// Backward-compatible total duration (kept for references).
pub const FOUNDER_VESTING_DURATION: i64 =
    FOUNDER_VESTING_CLIFF + FOUNDER_VESTING_RELEASE;

/// Максимум активных устройств на одного владельца (BLOCK 4 аудита —
/// защита от «дробления» устройств).
pub const MAX_DEVICES_PER_OWNER: u64 = 100;

/// Founder wallet (prod) — единый бенефициар founder-вестинга и источник
/// всех founder-ролей. Адрес зашит в программу: вестинг-аккаунт можно
/// инициализировать и получать средства только этим кошельком.
/// (Devnet продолжает использовать текущий program authority.)
pub const FOUNDER_WALLET: Pubkey =
    pubkey!("6gM2eEALvTD8ByMkAtawW8tfS5LEn7yFEcMh2Ly3nUN8");

// ══════════════════════════════════════════════════════════════
//  Governance MVP (ADR-0009)
//  Числа — атомарные единицы (1 SRC = 1e9 атомар; MAX_SUPPLY_ATOMIC = 1e18).
// ══════════════════════════════════════════════════════════════

/// Timelock: предложение исполняется не раньше, чем через 7 дней после одобрения.
pub const TIMELOCK_DELAY: u64 = 7 * 24 * 60 * 60; // 604_800 s

/// Максимум членов governance-списка.
pub const GOVERNANCE_MEMBER_MAX: usize = 5;

/// Минимум членов governance-списка.
pub const GOVERNANCE_MIN_MEMBERS: usize = 3;

/// Лимит эмиссии на одно governance-предложение (атомарные единицы).
/// 1e15 атомар = 1_000_000 SRC = 0.1% от MAX_SUPPLY_ATOMIC.
pub const PROPOSAL_AMOUNT_MAX_ATOMIC: u64 = 1_000_000_000_000_000; // 1e15

/// Максимальная длина заголовка предложения (байт).
pub const PROPOSAL_TITLE_MAX_LEN: usize = 64;

// ══════════════════════════════════════════════════════════════
//  Device Trust Levels (v7.0 §15)
//  Лимиты майнинга на tier устройства (Wh за месяц).
//  Basic ≤ 100 kWh/мес; Verified ≤ 10 MWh/мес;
//  Industrial / Institutional — без ограничений.
// ══════════════════════════════════════════════════════════════

/// Базовый тир: до 100 kWh в месяц (100_000 Wh).
pub const BASIC_MONTHLY_LIMIT_WH: u64 = 100_000;

/// Verified: сертифицированный бытовой счётчик — до 10 MWh в месяц.
pub const VERIFIED_MONTHLY_LIMIT_WH: u64 = 10_000_000;

/// Окно «месяца» для tier-лимитов (30 дней, секунды).
pub const TIER_MONTH_SECS: i64 = 30 * 24 * 60 * 60;

/// Максимальный балл ERS (Energy Reputation Score, v7.0 §16).
pub const ERS_MAX_SCORE: u32 = 1_000;

/// Порог ERS для премиум-доступа к ENRG Market (v7.0 §16, §30).
pub const ERS_PREMIUM_THRESHOLD: u32 = 700;

#[cfg(test)]
mod tests {
    use super::*;

    /// v7.0 §17: токен с 9 десятичными знаками.
    #[test]
    fn decimals_is_nine() {
        assert_eq!(SRC_DECIMALS, 9);
        assert_eq!(10u64.pow(SRC_DECIMALS as u32), 1_000_000_000);
    }

    /// Атомарные единицы: 1 SRC = 1e9 атомар; MAX = 1e18 атомар = 1e9 SRC.
    #[test]
    #[allow(deprecated)]
    fn max_supply_in_atomic_units() {
        assert_eq!(MAX_SUPPLY_ATOMIC, 1_000_000_000_000_000_000);
        assert_eq!(MAX_SUPPLY, MAX_SUPPLY_ATOMIC, "MAX_SUPPLY — deprecated alias");
        assert_eq!(MAX_SUPPLY_ATOMIC / (10u64.pow(SRC_DECIMALS as u32)), 1_000_000_000);
    }

    /// Founder allocation = 20% от MAX_SUPPLY_ATOMIC = 2e17 атомар.
    #[test]
    fn founder_allocation_is_twenty_percent() {
        assert_eq!(FOUNDER_ALLOCATION_ATOMIC, 200_000_000_000_000_000); // 2e17
        assert_eq!(FOUNDER_ALLOCATION_ATOMIC * 5, MAX_SUPPLY_ATOMIC);
    }

    /// v7.0 §18: комиссия 15% распределяется 20/40/30/10 — в сумме 100%.
    #[test]
    fn commission_percentages_sum_to_100() {
        assert_eq!(COMMISSION_PERCENT, 15);
        assert_eq!(
            BUYBACK_PERCENT + STAKING_PERCENT + DAO_PERCENT + EMERGENCY_PERCENT,
            100
        );
    }

    /// Проверка: награда = 85% пользователю + 15% комиссия, и доли фондов
    /// в сумме равны комиссии (emergency — остаток).
    #[test]
    fn distribution_applies_to_15_percent_commission() {
        let reward: u64 = 10_000_000;
        let user = reward * 85 / 100;
        let fee = reward - user;
        assert_eq!(fee, reward * COMMISSION_PERCENT / 100);
        assert_eq!(user + fee, reward);

        let buyback = fee * BUYBACK_PERCENT / 100;
        let staking = fee * STAKING_PERCENT / 100;
        let dao = fee * DAO_PERCENT / 100;
        let emergency = fee - buyback - staking - dao; // остаток
        assert_eq!(buyback + staking + dao + emergency, fee);
        assert!(emergency >= fee * EMERGENCY_PERCENT / 100 - 1);
        assert!(emergency <= fee * EMERGENCY_PERCENT / 100 + 1);
    }

    /// v7.0 §17: 1e18 атомар ≈ 1e9 ENRG (SRC), 1 SRC = 1e9 атомар.
    #[test]
    fn atomic_scale_matches_spec() {
        let src_in_atomics = 10u64.pow(SRC_DECIMALS as u32);
        assert_eq!(src_in_atomics, 1_000_000_000);
        assert_eq!(MAX_SUPPLY_ATOMIC / src_in_atomics, 1_000_000_000);
    }
}

