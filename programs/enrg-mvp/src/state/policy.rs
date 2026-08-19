use anchor_lang::prelude::*;

/// Policy Registry (ADR-0003).
///
/// On-chain set of policies that determine which Proofs and mints are allowed.
/// `mint_energy` (Verifier) **does not make decisions** — it executes the
/// policies addressed by this registry. This removes the documented
/// "verifier+policy co-location" deviation (see `instructions/mint.rs`).
///
/// PDA: seeds = [b"policy-registry"]
///
/// **Backward compatibility:** the account is optional in `MintEnergy`. If the
/// PDA is not initialized, the protocol default policies apply — behavior
/// identical to the pre-Policy Engine version. After initialization, policies
/// are set via `update_policy` (registry authority; may later be handed over
/// to Governance ADR-0009 via `set_policy_authority`).
#[account]
pub struct PolicyRegistry {
    /// Policy administrator. Initially — `EXPECTED_DEPLOYER`; change via
    /// `set_policy_authority` (the role may be handed over to Governance ADR-0009).
    pub authority: Pubkey,

    /// Global mint switch (maintenance / pause).
    /// `false` → `mint_energy` rejects all Proofs (`MintPaused`).
    pub mint_enabled: bool,

    /// Check that `report.oracle` is a member of `OracleRegistry` (C-0).
    pub enforce_oracle_whitelist: bool,

    /// Device-state gating (ADR-0005: mint only from `Active`).
    pub enforce_device_state: bool,

    /// Monthly tier limits (v7.0 §15).
    pub enforce_tier_limits: bool,

    /// Energy cap per proof: `≤ rated_power × max_energy_bps / 10_000`.
    pub enforce_energy_caps: bool,

    /// Supply cap: `total_supply + reward ≤ vault.max_supply`.
    pub enforce_supply_cap: bool,

    /// Maximum energy per proof in basis points of `rated_power`
    /// (10_000 == 100%). Default — 10_000 (as in the pre-Policy Engine version).
    pub max_energy_bps: u64,

    /// Allowed clock skew (sec) for the `verified_at` freshness check.
    pub max_clock_skew_sec: i64,

    /// Policy-set version (incremented on every update).
    pub version: u64,

    /// Timestamp of the last update (unix, sec).
    pub updated_at: i64,

    /// PDA bump.
    pub bump: u8,
}

impl PolicyRegistry {
    /// Account size (without the Anchor discriminator — 8 bytes).
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

    /// Default policy set (mirrors pre-Policy Engine behavior).
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
