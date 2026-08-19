use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum DeviceState {
    Unregistered,
    Registered,
    Claimed,
    Provisioned,
    Active,
    Quarantine,
    Maintenance,
    Revoked,
}

impl DeviceState {
    pub fn can_mint(&self) -> bool {
        matches!(self, DeviceState::Active)
    }
    pub fn can_transition_to(&self, target: DeviceState) -> bool {
        use DeviceState::*;
        match (*self, target) {
            (Unregistered, Registered) => true,
            (Registered, Claimed) => true,
            (Claimed, Provisioned) => true,
            (Provisioned, Active) => true,
            (Active, Quarantine) => true,
            (Active, Maintenance) => true,
            (Active, Revoked) => true,
            (Quarantine, Active) => true,
            (Quarantine, Maintenance) => true,
            (Quarantine, Revoked) => true,
            (Maintenance, Active) => true,
            (Maintenance, Revoked) => true,
            _ => false,
        }
    }
}

impl Default for DeviceState {
    fn default() -> Self {
        DeviceState::Unregistered
    }
}

/// Device trust level (v7.0 §15 — Device Trust Levels).
///
/// Affects minting limits: Basic ≤ 100 kWh/month, Verified ≤ 10 MWh/month,
/// Industrial / Institutional — no limits. The tier is assigned by the protocol
/// administrator (Vault authority) via `set_device_tier`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum DeviceTier {
    Basic,
    Verified,
    Industrial,
    Institutional,
}

impl Default for DeviceTier {
    fn default() -> Self {
        DeviceTier::Basic
    }
}

impl DeviceTier {
    /// Monthly minting limit (Wh). `None` — no limit.
    pub fn monthly_limit_wh(&self) -> Option<u64> {
        match self {
            DeviceTier::Basic => Some(crate::constants::BASIC_MONTHLY_LIMIT_WH),
            DeviceTier::Verified => Some(crate::constants::VERIFIED_MONTHLY_LIMIT_WH),
            DeviceTier::Industrial | DeviceTier::Institutional => None,
        }
    }

    /// Whether a `report_energy` is allowed given the already accumulated monthly
    /// energy (v7.0 §15): `month_energy + report_energy <= limit`.
    /// Used in mint_energy before recording the contribution.
    pub fn allows_increment(&self, month_energy: u64, report_energy: u64) -> bool {
        match self.monthly_limit_wh() {
            Some(limit) => month_energy
                .checked_add(report_energy)
                .map_or(false, |v| v <= limit),
            None => true,
        }
    }

    /// Premium tier flag (premium features of ENRG Market, v7.0 §30).
    pub fn is_premium(&self) -> bool {
        matches!(self, DeviceTier::Industrial | DeviceTier::Institutional)
    }
}

/// Core device identity.
///
/// Stores only the base on-chain protocol logic.
/// Device metadata (power, type, location) and the
/// rolling energy window (30 days) live in a separate
/// program — enrg-profile (EnergyProfile PDA).
///
/// Seeds: [b"producer", device_id.key().as_ref()]
#[account]
#[derive(InitSpace)]
pub struct EnergyProducer {
    /// Device owner (wallet).
    pub authority: Pubkey,

    /// Public key of the physical device (Ed25519).
    pub device_id: Pubkey,

    /// Last used nonce (replay protection).
    pub nonce: u64,

    /// Total confirmed energy of all time (Wh).
    pub energy_wh: u64,

    /// Timestamp of the last confirmed report.
    pub timestamp: i64,

    /// Current device state (Device Lifecycle, ADR-0005).
    pub state: DeviceState,

    /// Device trust level (v7.0 §15) — minting limits.
    pub tier: DeviceTier,

    /// Confirmed energy for the current month (Wh) — for the tier limit.
    pub month_energy_wh: u64,

    /// Start of the current monthly window (unix ts) — for the tier limit.
    pub month_start_ts: i64,

    /// Monotonic nonce of the last claim message (replay protection).
    /// Separate from `nonce` (proof nonce of reports): claim and proof do not overlap.
    pub claim_nonce: u64,

    /// Timestamp of a successful claim (audit, ADR-0002).
    pub claimed_at: i64,

    /// Revocation flag (ADR-0007). After revoke/rotate — true: the device cannot
    /// mint or change state. Duplicates the terminal state
    /// DeviceState::Revoked for defense-in-depth and simple checks.
    pub revoked: bool,

    /// On key rotation (ADR-0007) — the new device_id. Pubkey::default() if no
    /// rotation happened. Audit trail old → new.
    pub rotated_to: Pubkey,
}

impl EnergyProducer {
    /// Whether the device is allowed to mint at time `now`:
    /// not revoked (ADR-0007) AND state Active (ADR-0005) AND the monthly tier
    /// limit is not exhausted (v7.0 §15).
    pub fn can_mint(&self, now: i64) -> bool {
        if self.revoked {
            return false;
        }
        if !self.state.can_mint() {
            return false;
        }
        match self.tier.monthly_limit_wh() {
            Some(limit) => self.effective_month_energy(now) < limit,
            None => true,
        }
    }

    /// Month energy with the window "rolled" to `now`.
    /// If the window expired (>= TIER_MONTH_SECS) — new month, energy = 0.
    pub fn effective_month_energy(&self, now: i64) -> u64 {
        if self.month_start_ts == 0
            || now.saturating_sub(self.month_start_ts) >= crate::constants::TIER_MONTH_SECS
        {
            0
        } else {
            self.month_energy_wh
        }
    }

    /// Rolls the monthly window to `now` (call before recording energy).
    pub fn roll_month(&mut self, now: i64) {
        if self.month_start_ts == 0
            || now.saturating_sub(self.month_start_ts) >= crate::constants::TIER_MONTH_SECS
        {
            self.month_start_ts = now;
            self.month_energy_wh = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn producer_with(
        state: DeviceState,
        tier: DeviceTier,
        month_energy: u64,
        start: i64,
    ) -> EnergyProducer {
        EnergyProducer {
            authority: Pubkey::new_unique(),
            device_id: Pubkey::new_unique(),
            nonce: 0,
            energy_wh: 0,
            timestamp: 0,
            state,
            tier,
            month_energy_wh: month_energy,
            month_start_ts: start,
            claim_nonce: 0,
            claimed_at: 0,
            revoked: false,
            rotated_to: Pubkey::default(),
        }
    }

    #[test]
    fn tier_limits_match_spec() {
        // v7.0 §15: Basic ≤ 100 kWh/month, Verified ≤ 10 MWh/month, the rest — no limit.
        assert_eq!(DeviceTier::Basic.monthly_limit_wh(), Some(100_000));
        assert_eq!(DeviceTier::Verified.monthly_limit_wh(), Some(10_000_000));
        assert_eq!(DeviceTier::Industrial.monthly_limit_wh(), None);
        assert_eq!(DeviceTier::Institutional.monthly_limit_wh(), None);
        assert!(DeviceTier::Industrial.is_premium());
        assert!(!DeviceTier::Basic.is_premium());
    }

    #[test]
    fn active_device_within_limit_can_mint() {
        let p = producer_with(DeviceState::Active, DeviceTier::Basic, 50_000, 1_000);
        assert!(p.can_mint(1_000));
        let v = producer_with(DeviceState::Active, DeviceTier::Verified, 5_000_000, 1_000);
        assert!(v.can_mint(1_000));
    }

    #[test]
    fn non_active_device_cannot_mint() {
        for st in [
            DeviceState::Unregistered,
            DeviceState::Registered,
            DeviceState::Quarantine,
            DeviceState::Revoked,
        ] {
            let p = producer_with(st, DeviceTier::Industrial, 0, 1_000);
            assert!(!p.can_mint(1_000), "state {:?} must not mint", st);
        }
    }

    #[test]
    fn tier_limit_blocks_mint() {
        let p = producer_with(DeviceState::Active, DeviceTier::Basic, 100_000, 1_000);
        assert!(!p.can_mint(1_000));
        let v = producer_with(DeviceState::Active, DeviceTier::Verified, 10_000_000, 1_000);
        assert!(!v.can_mint(1_000));
        let i = producer_with(DeviceState::Active, DeviceTier::Industrial, u64::MAX, 1_000);
        assert!(i.can_mint(1_000));
    }

    #[test]
    fn revoked_device_cannot_mint() {
        // ADR-0007: the revoked flag blocks mint even in the Active state.
        let mut p = producer_with(DeviceState::Active, DeviceTier::Industrial, 0, 1_000);
        assert!(p.can_mint(1_000));
        p.revoked = true;
        assert!(!p.can_mint(1_000), "revoked device must not mint");
        // And a state transition out of Revoked is impossible (terminal state).
        assert!(!DeviceState::Revoked.can_transition_to(DeviceState::Active));
        assert!(!DeviceState::Revoked.can_transition_to(DeviceState::Provisioned));
    }

    #[test]
    fn rotated_to_tracks_audit() {
        let mut p = producer_with(DeviceState::Active, DeviceTier::Basic, 0, 1_000);
        let new_key = Pubkey::new_unique();
        p.rotated_to = new_key;
        p.revoked = true;
        assert_eq!(p.rotated_to, new_key);
        assert!(p.revoked);
    }

    #[test]
    fn month_window_resets_limit() {
        let mut p = producer_with(DeviceState::Active, DeviceTier::Basic, 100_000, 1_000);
        assert!(!p.can_mint(1_000));
        let later = 1_000 + crate::constants::TIER_MONTH_SECS + 1;
        assert_eq!(p.effective_month_energy(later), 0);
        p.roll_month(later);
        assert!(p.can_mint(later));
        assert_eq!(p.month_energy_wh, 0);
        assert_eq!(p.month_start_ts, later);
    }

    #[test]
    fn tier_allows_increment_respects_limit() {
        // Basic: 60_000 + 50_000 = 110_000 > 100_000 → disallowed (mint path).
        assert!(DeviceTier::Basic.allows_increment(60_000, 40_000));
        assert!(!DeviceTier::Basic.allows_increment(60_000, 50_000));
        // Verified: within 10 MWh.
        assert!(DeviceTier::Verified.allows_increment(5_000_000, 5_000_000));
        assert!(!DeviceTier::Verified.allows_increment(5_000_000, 6_000_000));
        // Industrial/Institutional — no limit.
        assert!(DeviceTier::Industrial.allows_increment(u64::MAX, u64::MAX));
        // Overflow of month_energy + report cannot bypass the limit.
        assert!(!DeviceTier::Basic.allows_increment(u64::MAX, 1));
    }
}


