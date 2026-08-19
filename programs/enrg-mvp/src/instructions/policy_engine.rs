use anchor_lang::prelude::*;

use crate::constants::{DEFAULT_MAX_ENERGY_BPS, EXPECTED_DEPLOYER, MAX_CLOCK_SKEW};
use crate::error::ErrorCode;
use crate::security::validation::verify_timestamp_with_skew;
use crate::state::*;

// ══════════════════════════════════════════════════════════════
//  Policy Registry (ADR-0003) — a separate component that makes
//  decisions about proof and mint admissibility.
//
//  The Verifier (`mint_energy`) is an EXECUTOR, not a source of
//  policies. All decisions (oracle whitelist, device state, freshness,
//  tier limits, energy, mint pause, supply cap) are made by the
//  PolicyEngine in this module.
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

    /// Protocol deployer (H-2 pattern: front-running capture protection).
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

/// Full snapshot of the updatable policies (passed to `update_policy`).
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

/// Initialize the Policy Registry. `EXPECTED_DEPLOYER` only.
/// Defaults mirror the pre-Policy Engine protocol behavior.
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

/// Update the policy set (registry authority).
pub fn update_policy(
    ctx: Context<UpdatePolicy>,
    update: PolicyUpdate,
) -> Result<()> {
    // Parameter sanitization: bps ∈ (0, 1_000_000] (up to 10000% of rated_power),
    // skew ∈ [0, 3600] sec.
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


/// Change the policy administrator (the role may go to Governance ADR-0009).
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
//  Policy Engine — single decision point (ADR-0003)
// ══════════════════════════════════════════════════════════════

/// Inputs of the "predicate" part of the policy (pre-mint checks).
pub struct MintPreambleInput<'a> {
    /// Policy set; `None` → protocol defaults (backward compatibility).
    pub policy: Option<&'a PolicyRegistry>,
    /// Device (EnergyProducer) from the Device Registry.
    pub producer: &'a EnergyProducer,
    /// Oracle report to be evaluated.
    pub report: &'a OracleReport,
    /// C-0: `report.oracle` is present in the OracleRegistry.
    pub oracle_trusted: bool,
    /// Device rated power (EnergyProfile.rated_power).
    pub profile_rated_power: u64,
    /// Current time (clock.unix_timestamp).
    pub now: i64,
}

/// Inputs of the "reward" part of the policy (after reward calculation).
pub struct MintRewardInput<'a> {
    /// Policy set; `None` → protocol defaults (backward compatibility).
    pub policy: Option<&'a PolicyRegistry>,
    /// Calculated reward (SRC, atomic units).
    pub reward: u64,
    /// Current total_supply (atomic units).
    pub vault_total_supply: u64,
    /// Hard emission cap (vault.max_supply).
    pub vault_max_supply: u64,
}

/// Policy Engine (ADR-0003).
///
/// The Verifier (`mint_energy`) makes no decisions: it passes the verified
/// data here and executes the result. Defaults (policy = None) fully mirror
/// the pre-Policy Registry protocol behavior.
pub struct PolicyEngine;

impl PolicyEngine {
    /// Predicate part: global switch, oracle whitelist, device state,
    /// timestamp freshness, tier limits, energy.
    pub fn evaluate_preamble(input: MintPreambleInput<'_>) -> Result<()> {
        let policy = input.policy;

        let mint_enabled = policy.map_or(true, |p| p.mint_enabled);
        let enforce_whitelist = policy.map_or(true, |p| p.enforce_oracle_whitelist);
        let enforce_state = policy.map_or(true, |p| p.enforce_device_state);
        let enforce_tier = policy.map_or(true, |p| p.enforce_tier_limits);
        let enforce_energy = policy.map_or(true, |p| p.enforce_energy_caps);
        let max_energy_bps = policy.map_or(DEFAULT_MAX_ENERGY_BPS, |p| p.max_energy_bps);
        let max_clock_skew = policy.map_or(MAX_CLOCK_SKEW, |p| p.max_clock_skew_sec);

        // 0. Global switch (maintenance / pause).
        require!(mint_enabled, ErrorCode::MintPaused);

        // 1. C-0: the report must come from a trusted oracle (OracleRegistry).
        if enforce_whitelist {
            require!(input.oracle_trusted, ErrorCode::UntrustedOracle);
        }

        // 2. Device state (ADR-0005): mint only from Active.
        if enforce_state {
            require!(
                input.producer.can_mint(input.now),
                ErrorCode::InvalidDeviceState
            );
        }

        // 3. verified_at freshness (the policy sets the allowed clock skew).
        verify_timestamp_with_skew(input.now, input.report.verified_at, max_clock_skew)?;

        // 4. Monthly tier limit (v7.0 §15).
        if enforce_tier {
            require!(
                input.producer.tier.allows_increment(
                    input.producer.month_energy_wh,
                    input.report.energy_wh,
                ),
                ErrorCode::TierLimitExceeded
            );
        }

        // 5. Energy per proof ≤ rated_power × max_energy_bps / 10_000.
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

    /// Reward part: reward > 0 and supply cap.
    pub fn evaluate_reward(input: MintRewardInput<'_>) -> Result<()> {
        let policy = input.policy;
        let enforce_supply = policy.map_or(true, |p| p.enforce_supply_cap);

        // No "empty" mints — always (not disabled by policy).
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

    // ── Predicate part ──

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

        // Stale proof: verified_at far in the past (> MAX_PROOF_AGE).
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

        // Future proof: verified_at > now + skew.
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
        // Basic: 60_000 + 50_000 = 110_000 > 100_000 limit.
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
        // rated_power raised so the energy does not hit the energy cap:
        // we check specifically the tier-limit relaxation (60_000+50_000 > 100_000).
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
        // rated_power = 10_000 Wh, bps = 10_000 → max 10_000 Wh; report 11_000.
        let r = report_with(11_000, 1_100);
        let res = preamble(Some(&reg), &p, &r);
        assert_eq!(err_code(res), code(ErrorCode::ExcessiveEnergy));
    }

    #[test]
    fn max_energy_bps_scales_limit() {
        let mut reg = default_policy();
        reg.max_energy_bps = 150_000; // 1500 %
        let p = producer_with(DeviceState::Active, DeviceTier::Industrial, 0, 0);
        // rated_power = 10_000 × 1500% = 150_000 Wh; a 100_000 report passes.
        let r = report_with(100_000, 1_100);
        let res = preamble(Some(&reg), &p, &r);
        assert!(res.is_ok(), "scaled cap must accept 100k Wh: {:?}", res);
    }

    // ── Reward part ──

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

