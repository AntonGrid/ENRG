use anchor_lang::prelude::*;

use crate::constants::{DEFAULT_MAX_ENERGY_BPS, EXPECTED_DEPLOYER, MAX_CLOCK_SKEW};
use crate::error::ErrorCode;
use crate::security::validation::verify_timestamp_with_skew;
use crate::state::*;

// ══════════════════════════════════════════════════════════════
//  Policy Registry (ADR-0003) — отдельный компонент принятия
//  решений о допустимости Proof'ов и минта.
//
//  Verifier (`mint_energy`) является ИСПОЛНИТЕЛЕМ, а не источником
//  политик. Все решения (whitelist оракулов, состояние устройства,
//  freshness, tier-лимиты, энергия, пауза минта, supply cap)
//  принимаются PolicyEngine в этом модуле.
// ══════════════════════════════════════════════════════════════

#[derive(Accounts)]
pub struct InitializePolicyRegistry<'info> {
    /// Policy Registry PDA [b"policy-registry"].
    #[account(
        init,
        payer = authority,
        space = 8 + PolicyRegistry::LEN,
        seeds = [b"policy-registry"],
        bump
    )]
    pub policy_registry: Account<'info, PolicyRegistry>,

    /// Protocol deployer (H-2-паттерн: защита от front-running захвата).
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    #[account(
        mut,
        seeds = [b"policy-registry"],
        bump,
        constraint = policy_registry.authority == authority.key() @ ErrorCode::NotPolicyAuthority
    )]
    pub policy_registry: Account<'info, PolicyRegistry>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetPolicyAuthority<'info> {
    #[account(
        mut,
        seeds = [b"policy-registry"],
        bump,
        constraint = policy_registry.authority == authority.key() @ ErrorCode::NotPolicyAuthority
    )]
    pub policy_registry: Account<'info, PolicyRegistry>,

    pub authority: Signer<'info>,
}

/// Полный срез обновляемых политик (передаётся в `update_policy`).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PolicyUpdate {
    pub mint_enabled: bool,
    pub enforce_oracle_whitelist: bool,
    pub enforce_device_state: bool,
    pub enforce_tier_limits: bool,
    pub enforce_energy_caps: bool,
    pub enforce_supply_cap: bool,
    pub max_energy_bps: u64,
    pub max_clock_skew_sec: i64,
}

/// Инициализация Policy Registry. Только `EXPECTED_DEPLOYER`.
/// Дефолты повторяют поведение протокола до Policy Engine.
pub fn initialize_policy_registry(
    ctx: Context<InitializePolicyRegistry>,
) -> Result<()> {
    require!(
        ctx.accounts.authority.key() == EXPECTED_DEPLOYER,
        ErrorCode::UnauthorizedDeployer
    );

    let registry = &mut ctx.accounts.policy_registry;
    **registry = PolicyRegistry::defaults(ctx.accounts.authority.key(), ctx.bumps.policy_registry);
    registry.updated_at = Clock::get()?.unix_timestamp;

    emit!(PolicyRegistryInitialized {
        authority: ctx.accounts.authority.key(),
        version: registry.version,
    });

    msg!("Policy Registry initialized: version={}", registry.version);

    Ok(())
}

/// Обновление набора политик (authority реестра).
pub fn update_policy(
    ctx: Context<UpdatePolicy>,
    update: PolicyUpdate,
) -> Result<()> {
    // Санитизация параметров: bps ∈ (0, 1_000_000] (до 10000 % от rated_power),
    // skew ∈ [0, 3600] сек.
    require!(update.max_energy_bps > 0, ErrorCode::InvalidParameter);
    require!(update.max_energy_bps <= 1_000_000, ErrorCode::InvalidParameter);
    require!(update.max_clock_skew_sec >= 0, ErrorCode::InvalidParameter);
    require!(update.max_clock_skew_sec <= 3600, ErrorCode::InvalidParameter);

    let registry = &mut ctx.accounts.policy_registry;

    registry.mint_enabled = update.mint_enabled;
    registry.enforce_oracle_whitelist = update.enforce_oracle_whitelist;
    registry.enforce_device_state = update.enforce_device_state;
    registry.enforce_tier_limits = update.enforce_tier_limits;
    registry.enforce_energy_caps = update.enforce_energy_caps;
    registry.enforce_supply_cap = update.enforce_supply_cap;
    registry.max_energy_bps = update.max_energy_bps;
    registry.max_clock_skew_sec = update.max_clock_skew_sec;
    registry.version = registry
        .version
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    registry.updated_at = Clock::get()?.unix_timestamp;

    emit!(PolicyUpdated {
        policy_registry: registry.key(),
        mint_enabled: registry.mint_enabled,
        enforce_oracle_whitelist: registry.enforce_oracle_whitelist,
        enforce_device_state: registry.enforce_device_state,
        enforce_tier_limits: registry.enforce_tier_limits,
        enforce_energy_caps: registry.enforce_energy_caps,
        enforce_supply_cap: registry.enforce_supply_cap,
        max_energy_bps: registry.max_energy_bps,
        max_clock_skew_sec: registry.max_clock_skew_sec,
        version: registry.version,
        updated_by: ctx.accounts.authority.key(),
    });

    msg!(
        "Policy updated: version={} mint_enabled={} whitelist={} state={} tier={} energy={} supply={} bps={} skew={}",
        registry.version,
        registry.mint_enabled,
        registry.enforce_oracle_whitelist,
        registry.enforce_device_state,
        registry.enforce_tier_limits,
        registry.enforce_energy_caps,
        registry.enforce_supply_cap,
        registry.max_energy_bps,
        registry.max_clock_skew_sec,
    );

    Ok(())
}


/// Смена администратора политик (возможен перевод роли под Governance ADR-0009).
pub fn set_policy_authority(
    ctx: Context<SetPolicyAuthority>,
    new_authority: Pubkey,
) -> Result<()> {
    require!(new_authority != Pubkey::default(), ErrorCode::InvalidParameter);

    let registry = &mut ctx.accounts.policy_registry;
    let old_authority = registry.authority;
    registry.authority = new_authority;
    registry.version = registry
        .version
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    registry.updated_at = Clock::get()?.unix_timestamp;

    emit!(PolicyAuthorityChanged {
        old_authority,
        new_authority,
        changed_by: ctx.accounts.authority.key(),
    });

    Ok(())
}

// ══════════════════════════════════════════════════════════════
//  Policy Engine — единая точка принятия решений (ADR-0003)
// ══════════════════════════════════════════════════════════════

/// Входные данные «предикатной» части политики (проверки до минта).
pub struct MintPreambleInput<'a> {
    /// Набор политик; `None` → дефолты протокола (обратная совместимость).
    pub policy: Option<&'a PolicyRegistry>,
    /// Устройство (EnergyProducer) из Device Registry.
    pub producer: &'a EnergyProducer,
    /// Отчёт оракула, подлежащий оценке.
    pub report: &'a OracleReport,
    /// C-0: `report.oracle` содержится в OracleRegistry.
    pub oracle_trusted: bool,
    /// Номинальная мощность устройства (EnergyProfile.rated_power).
    pub profile_rated_power: u64,
    /// Текущее время (clock.unix_timestamp).
    pub now: i64,
}

/// Входные данные «результирующей» части политики (после расчёта награды).
pub struct MintRewardInput<'a> {
    /// Набор политик; `None` → дефолты протокола (обратная совместимость).
    pub policy: Option<&'a PolicyRegistry>,
    /// Рассчитанная награда (SRC, атомарные единицы).
    pub reward: u64,
    /// Текущий total_supply (атомарные единицы).
    pub vault_total_supply: u64,
    /// Жёсткий потолок эмиссии (vault.max_supply).
    pub vault_max_supply: u64,
}

/// Policy Engine (ADR-0003).
///
/// Verifier (`mint_energy`) не принимает решений: он передаёт сюда
/// верифицированные данные и исполняет результат. Дефолты (policy = None)
/// полностью повторяют поведение протокола до введения Policy Registry.
pub struct PolicyEngine;

impl PolicyEngine {
    /// Предикатная часть: глобальный выключатель, whitelist оракулов,
    /// состояние устройства, freshness timestamp, tier-лимиты, энергия.
    pub fn evaluate_preamble(input: MintPreambleInput<'_>) -> Result<()> {
        let policy = input.policy;

        let mint_enabled = policy.map_or(true, |p| p.mint_enabled);
        let enforce_whitelist = policy.map_or(true, |p| p.enforce_oracle_whitelist);
        let enforce_state = policy.map_or(true, |p| p.enforce_device_state);
        let enforce_tier = policy.map_or(true, |p| p.enforce_tier_limits);
        let enforce_energy = policy.map_or(true, |p| p.enforce_energy_caps);
        let max_energy_bps = policy.map_or(DEFAULT_MAX_ENERGY_BPS, |p| p.max_energy_bps);
        let max_clock_skew = policy.map_or(MAX_CLOCK_SKEW, |p| p.max_clock_skew_sec);

        // 0. Глобальный выключатель (maintenance / pause).
        require!(mint_enabled, ErrorCode::MintPaused);

        // 1. C-0: отчёт должен исходить от доверенного оракула (OracleRegistry).
        if enforce_whitelist {
            require!(input.oracle_trusted, ErrorCode::UntrustedOracle);
        }

        // 2. Состояние устройства (ADR-0005): mint только из Active.
        if enforce_state {
            require!(
                input.producer.can_mint(input.now),
                ErrorCode::InvalidDeviceState
            );
        }

        // 3. Freshness verified_at (политика задаёт допустимый сдвиг часов).
        verify_timestamp_with_skew(input.now, input.report.verified_at, max_clock_skew)?;

        // 4. Tier-лимит месяца (v7.0 §15).
        if enforce_tier {
            require!(
                input.producer.tier.allows_increment(
                    input.producer.month_energy_wh,
                    input.report.energy_wh,
                ),
                ErrorCode::TierLimitExceeded
            );
        }

        // 5. Энергия за proof ≤ rated_power × max_energy_bps / 10_000.
        if enforce_energy {
            let max_energy = input
                .profile_rated_power
                .checked_mul(max_energy_bps)
                .and_then(|v| v.checked_div(10_000))
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            require!(input.report.energy_wh <= max_energy, ErrorCode::ExcessiveEnergy);
        }

        Ok(())
    }

    /// Результирующая часть: награда > 0 и supply cap.
    pub fn evaluate_reward(input: MintRewardInput<'_>) -> Result<()> {
        let policy = input.policy;
        let enforce_supply = policy.map_or(true, |p| p.enforce_supply_cap);

        // Никаких «пустых» минтов — всегда (не отключается политикой).
        require!(input.reward > 0, ErrorCode::ZeroAmountMint);

        if enforce_supply {
            let new_supply = input
                .vault_total_supply
                .checked_add(input.reward)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            require!(new_supply <= input.vault_max_supply, ErrorCode::SupplyLimitExceeded);
        }

        Ok(())
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    fn pk(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    fn default_policy() -> PolicyRegistry {
        PolicyRegistry::defaults(pk(1), 255)
    }

    fn producer_with(
        state: DeviceState,
        tier: DeviceTier,
        month_energy: u64,
        month_start: i64,
    ) -> EnergyProducer {
        EnergyProducer {
            authority: pk(2),
            device_id: pk(3),
            nonce: 0,
            energy_wh: 0,
            timestamp: 0,
            state,
            tier,
            month_energy_wh: month_energy,
            month_start_ts: month_start,
            claim_nonce: 0,
            claimed_at: 0,
            revoked: false,
            rotated_to: Pubkey::default(),
        }
    }

    fn report_with(energy_wh: u64, verified_at: i64) -> OracleReport {
        OracleReport {
            oracle: pk(4),
            device_id: pk(3),
            nonce: 1,
            device_timestamp: verified_at,
            verified_at,
            energy_wh,
            device_signature: [0u8; 64],
            oracle_signature: [0u8; 64],
        }
    }

    fn preamble(
        policy: Option<&PolicyRegistry>,
        producer: &EnergyProducer,
        report: &OracleReport,
    ) -> Result<()> {
        PolicyEngine::evaluate_preamble(MintPreambleInput {
            policy,
            producer,
            report,
            oracle_trusted: true,
            profile_rated_power: 10_000,
            now: report.verified_at + 60,
        })
    }

    fn err_code(res: Result<()>) -> u32 {
        match res {
            Ok(()) => panic!("expected an error"),
            Err(anchor_lang::error::Error::AnchorError(e)) => e.error_code_number,
            Err(e) => panic!("unexpected error kind: {:?}", e),
        }
    }

    fn code(e: ErrorCode) -> u32 {
        u32::from(e)
    }

    // ── Предикатная часть ──

    #[test]
    fn defaults_without_registry_match_legacy_behavior() {
        let p = producer_with(DeviceState::Active, DeviceTier::Industrial, 0, 0);
        let r = report_with(1_000, 1_000);
        let res = preamble(None, &p, &r);
        assert!(res.is_ok(), "defaults must accept a valid proof: {:?}", res);
    }

    #[test]
    fn mint_paused_rejects_everything() {
        let mut reg = default_policy();
        reg.mint_enabled = false;
        let p = producer_with(DeviceState::Active, DeviceTier::Industrial, 0, 0);
        let r = report_with(1_000, 1_000);
        let res = preamble(Some(&reg), &p, &r);
        assert_eq!(err_code(res), code(ErrorCode::MintPaused));
    }

    #[test]
    fn untrusted_oracle_rejected_when_enforced() {
        let reg = default_policy();
        let p = producer_with(DeviceState::Active, DeviceTier::Industrial, 0, 0);
        let r = report_with(1_000, 1_000);
        let res = PolicyEngine::evaluate_preamble(MintPreambleInput {
            policy: Some(&reg),
            producer: &p,
            report: &r,
            oracle_trusted: false,
            profile_rated_power: 10_000,
            now: 1_060,
        });
        assert_eq!(err_code(res), code(ErrorCode::UntrustedOracle));
    }

    #[test]
    fn whitelist_can_be_relaxed() {
        let mut reg = default_policy();
        reg.enforce_oracle_whitelist = false;
        let p = producer_with(DeviceState::Active, DeviceTier::Industrial, 0, 0);
        let r = report_with(1_000, 1_000);
        let res = PolicyEngine::evaluate_preamble(MintPreambleInput {
            policy: Some(&reg),
            producer: &p,
            report: &r,
            oracle_trusted: false,
            profile_rated_power: 10_000,
            now: 1_060,
        });
        assert!(res.is_ok(), "whitelist disabled must not block: {:?}", res);
    }

    #[test]
    fn non_active_device_rejected_when_state_enforced() {
        let reg = default_policy();
        let p = producer_with(DeviceState::Maintenance, DeviceTier::Industrial, 0, 0);
        let r = report_with(1_000, 1_000);
        let res = preamble(Some(&reg), &p, &r);
        assert_eq!(err_code(res), code(ErrorCode::InvalidDeviceState));
    }

    #[test]
    fn state_gating_can_be_relaxed() {
        let mut reg = default_policy();
        reg.enforce_device_state = false;
        let p = producer_with(DeviceState::Maintenance, DeviceTier::Industrial, 0, 0);
        let r = report_with(1_000, 1_000);
        let res = preamble(Some(&reg), &p, &r);
        assert!(res.is_ok(), "state gating disabled must not block: {:?}", res);
    }

    #[test]
    fn stale_or_future_timestamp_rejected() {
        let reg = default_policy();
        let p = producer_with(DeviceState::Active, DeviceTier::Industrial, 0, 0);

        // Старый proof: verified_at сильно в прошлом (> MAX_PROOF_AGE).
        let old = report_with(1_000, 1_000);
        let res = PolicyEngine::evaluate_preamble(MintPreambleInput {
            policy: Some(&reg),
            producer: &p,
            report: &old,
            oracle_trusted: true,
            profile_rated_power: 10_000,
            now: old.verified_at + 900 + 60,
        });
        assert_eq!(err_code(res), code(ErrorCode::StaleProof));

        // Будущий proof: verified_at > now + skew.
        let fut = report_with(1_000, 1_000);
        let res = PolicyEngine::evaluate_preamble(MintPreambleInput {
            policy: Some(&reg),
            producer: &p,
            report: &fut,
            oracle_trusted: true,
            profile_rated_power: 10_000,
            now: fut.verified_at - MAX_CLOCK_SKEW - 60,
        });
        assert_eq!(err_code(res), code(ErrorCode::FutureTimestamp));
    }

    #[test]
    fn tier_limit_rejected_when_enforced() {
        let reg = default_policy();
        // Basic: 60_000 + 50_000 = 110_000 > 100_000 лимита.
        let p = producer_with(DeviceState::Active, DeviceTier::Basic, 60_000, 1_000);
        let r = report_with(50_000, 1_100);
        let res = preamble(Some(&reg), &p, &r);
        assert_eq!(err_code(res), code(ErrorCode::TierLimitExceeded));
    }

    #[test]
    fn tier_limit_can_be_relaxed() {
        let mut reg = default_policy();
        reg.enforce_tier_limits = false;
        let p = producer_with(DeviceState::Active, DeviceTier::Basic, 60_000, 1_000);
        let r = report_with(50_000, 1_100);
        // rated_power поднят, чтобы энергия не упиралась в energy-кап:
        // проверяем именно ослабление tier-лимита (60_000+50_000 > 100_000).
        let res = PolicyEngine::evaluate_preamble(MintPreambleInput {
            policy: Some(&reg),
            producer: &p,
            report: &r,
            oracle_trusted: true,
            profile_rated_power: 500_000,
            now: 1_160,
        });
        assert!(res.is_ok(), "tier limits disabled must not block: {:?}", res);
    }

    #[test]
    fn excessive_energy_rejected() {
        let reg = default_policy();
        let p = producer_with(DeviceState::Active, DeviceTier::Industrial, 0, 0);
        // rated_power = 10_000 Wh, bps = 10_000 → max 10_000 Wh; отчёт 11_000.
        let r = report_with(11_000, 1_100);
        let res = preamble(Some(&reg), &p, &r);
        assert_eq!(err_code(res), code(ErrorCode::ExcessiveEnergy));
    }

    #[test]
    fn max_energy_bps_scales_limit() {
        let mut reg = default_policy();
        reg.max_energy_bps = 150_000; // 1500 %
        let p = producer_with(DeviceState::Active, DeviceTier::Industrial, 0, 0);
        // rated_power = 10_000 × 1500 % = 150_000 Wh; отчёт 100_000 проходит.
        let r = report_with(100_000, 1_100);
        let res = preamble(Some(&reg), &p, &r);
        assert!(res.is_ok(), "scaled cap must accept 100k Wh: {:?}", res);
    }

    // ── Результирующая часть ──

    #[test]
    fn zero_reward_rejected() {
        let res = PolicyEngine::evaluate_reward(MintRewardInput {
            policy: None,
            reward: 0,
            vault_total_supply: 0,
            vault_max_supply: u64::MAX,
        });
        assert_eq!(err_code(res), code(ErrorCode::ZeroAmountMint));
    }

    #[test]
    fn supply_cap_enforced_by_default() {
        let res = PolicyEngine::evaluate_reward(MintRewardInput {
            policy: None,
            reward: 1_000,
            vault_total_supply: 10_000,
            vault_max_supply: 11_000,
        });
        assert!(res.is_ok(), "within cap must pass");

        let res = PolicyEngine::evaluate_reward(MintRewardInput {
            policy: None,
            reward: 1_000,
            vault_total_supply: 10_000,
            vault_max_supply: 10_400,
        });
        assert_eq!(err_code(res), code(ErrorCode::SupplyLimitExceeded));
    }

    #[test]
    fn supply_cap_can_be_relaxed() {
        let mut reg = default_policy();
        reg.enforce_supply_cap = false;
        let res = PolicyEngine::evaluate_reward(MintRewardInput {
            policy: Some(&reg),
            reward: 1_000,
            vault_total_supply: 10_000,
            vault_max_supply: 10_000,
        });
        assert!(res.is_ok(), "supply cap disabled must not block: {:?}", res);
    }

    #[test]
    fn reward_never_zero_even_if_supply_relaxed() {
        let mut reg = default_policy();
        reg.enforce_supply_cap = false;
        let res = PolicyEngine::evaluate_reward(MintRewardInput {
            policy: Some(&reg),
            reward: 0,
            vault_total_supply: 0,
            vault_max_supply: u64::MAX,
        });
        assert_eq!(err_code(res), code(ErrorCode::ZeroAmountMint));
    }
}

