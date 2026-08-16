use anchor_lang::prelude::*;

/// Policy Registry (ADR-0003).
///
/// On-chain набор политик, определяющих допустимость Proof'ов и минта.
/// `mint_energy` (Verifier) **не принимает решений** — он исполняет политики,
/// адресуемые этим реестром. Это устраняет документированное отклонение
/// «verifier+policy co-location» (см. `instructions/mint.rs`).
///
/// PDA: seeds = [b"policy-registry"]
///
/// **Обратная совместимость:** аккаунт опционален в `MintEnergy`. Если PDA
/// не инициализирован, применяются дефолтные политики протокола — поведение
/// идентично версии до Policy Engine. После инициализации политики задаются
/// через `update_policy` (authority реестра, далее может быть передан под
/// Governance ADR-0009 через `set_policy_authority`).
#[account]
pub struct PolicyRegistry {
    /// Администратор политик. Изначально — `EXPECTED_DEPLOYER`; смена через
    /// `set_policy_authority` (возможна передача роли под Governance ADR-0009).
    pub authority: Pubkey,

    /// Глобальный выключатель минта (maintenance / pause).
    /// `false` → `mint_energy` отклоняет все Proof'ы (`MintPaused`).
    pub mint_enabled: bool,

    /// Проверка членства `report.oracle` в `OracleRegistry` (C-0).
    pub enforce_oracle_whitelist: bool,

    /// Gating по состоянию устройства (ADR-0005: mint только из `Active`).
    pub enforce_device_state: bool,

    /// Tier-лимиты месяца (v7.0 §15).
    pub enforce_tier_limits: bool,

    /// Ограничение энергии за proof: `≤ rated_power × max_energy_bps / 10_000`.
    pub enforce_energy_caps: bool,

    /// Supply cap: `total_supply + reward ≤ vault.max_supply`.
    pub enforce_supply_cap: bool,

    /// Максимальная энергия за proof в базисных пунктах от `rated_power`
    /// (10_000 == 100 %). Дефолт — 10_000 (как в версии до Policy Engine).
    pub max_energy_bps: u64,

    /// Допустимый сдвиг часов (сек) для freshness-проверки `verified_at`.
    pub max_clock_skew_sec: i64,

    /// Версия набора политик (инкремент при каждом обновлении).
    pub version: u64,

    /// Timestamp последнего обновления (unix, сек).
    pub updated_at: i64,

    /// PDA bump.
    pub bump: u8,
}

impl PolicyRegistry {
    /// Размер аккаунта (без дискриминатора Anchor — 8 байт).
    pub const LEN: usize =
        32 + // authority
        1 +  // mint_enabled
        1 +  // enforce_oracle_whitelist
        1 +  // enforce_device_state
        1 +  // enforce_tier_limits
        1 +  // enforce_energy_caps
        1 +  // enforce_supply_cap
        8 +  // max_energy_bps
        8 +  // max_clock_skew_sec
        8 +  // version
        8 +  // updated_at
        1;   // bump

    /// Дефолтный набор политик (зеркалирует поведение до Policy Engine).
    pub fn defaults(authority: Pubkey, bump: u8) -> Self {
        Self {
            authority,
            mint_enabled: true,
            enforce_oracle_whitelist: true,
            enforce_device_state: true,
            enforce_tier_limits: true,
            enforce_energy_caps: true,
            enforce_supply_cap: true,
            max_energy_bps: crate::constants::DEFAULT_MAX_ENERGY_BPS,
            max_clock_skew_sec: crate::constants::MAX_CLOCK_SKEW,
            version: 1,
            updated_at: 0,
            bump,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn len_matches_field_layout() {
        assert_eq!(PolicyRegistry::LEN, 32 + 6 + 8 + 8 + 8 + 8 + 1);
    }

    #[test]
    fn defaults_match_legacy_protocol_behavior() {
        let reg = PolicyRegistry::defaults(Pubkey::default(), 255);
        assert!(reg.mint_enabled);
        assert!(reg.enforce_oracle_whitelist);
        assert!(reg.enforce_device_state);
        assert!(reg.enforce_tier_limits);
        assert!(reg.enforce_energy_caps);
        assert!(reg.enforce_supply_cap);
        assert_eq!(reg.max_energy_bps, 10_000);
        assert_eq!(reg.max_clock_skew_sec, crate::constants::MAX_CLOCK_SKEW);
        assert_eq!(reg.version, 1);
    }
}
