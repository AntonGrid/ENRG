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

/// Уровень доверия устройства (v7.0 §15 — Device Trust Levels).
///
/// Влияет на лимиты майнинга: Basic ≤ 100 kWh/мес, Verified ≤ 10 MWh/мес,
/// Industrial / Institutional — без ограничений. Тир назначается протокольным
/// администратором (Vault authority) через `set_device_tier`.
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
    /// Лимит майнинга на месяц (Wh). `None` — без ограничений.
    pub fn monthly_limit_wh(&self) -> Option<u64> {
        match self {
            DeviceTier::Basic => Some(crate::constants::BASIC_MONTHLY_LIMIT_WH),
            DeviceTier::Verified => Some(crate::constants::VERIFIED_MONTHLY_LIMIT_WH),
            DeviceTier::Industrial | DeviceTier::Institutional => None,
        }
    }

    /// Разрешён ли отчёт `report_energy` с учётом уже накопленной месячной
    /// энергии (v7.0 §15): `month_energy + report_energy <= limit`.
    /// Используется в mint_energy перед записью вклада.
    pub fn allows_increment(&self, month_energy: u64, report_energy: u64) -> bool {
        match self.monthly_limit_wh() {
            Some(limit) => month_energy
                .checked_add(report_energy)
                .map_or(false, |v| v <= limit),
            None => true,
        }
    }

    /// Признак премиум-тира (премиум-функции ENRG Market, v7.0 §30).
    pub fn is_premium(&self) -> bool {
        matches!(self, DeviceTier::Industrial | DeviceTier::Institutional)
    }
}

/// Core device identity.
///
/// Хранит только базовую on-chain логику протокола.
/// Метаданные устройства (мощность, тип, локация) и
/// скользящее окно энергии (30 days) вынесены в
/// отдельную программу — enrg-profile (EnergyProfile PDA).
///
/// Seeds: [b"producer", device_id.key().as_ref()]
#[account]
#[derive(InitSpace)]
pub struct EnergyProducer {
    /// Владелец устройства (wallet).
    pub authority: Pubkey,

    /// Публичный ключ физического устройства (Ed25519).
    pub device_id: Pubkey,

    /// Последний использованный nonce (защита от replay).
    pub nonce: u64,

    /// Суммарная подтверждённая энергия за всё время (Wh).
    pub energy_wh: u64,

    /// Временная метка последнего подтверждённого репорта.
    pub timestamp: i64,

    /// Текущее состояние устройства (Device Lifecycle, ADR-0005).
    pub state: DeviceState,

    /// Уровень доверия устройства (v7.0 §15) — лимиты майнинга.
    pub tier: DeviceTier,

    /// Подтверждённая энергия за текущий месяц (Wh) — для tier-лимита.
    pub month_energy_wh: u64,

    /// Начало текущего месячного окна (unix ts) — для tier-лимита.
    pub month_start_ts: i64,

    /// Монотонный nonce последнего claim-сообщения (защита от replay).
    /// Отдельно от `nonce` (proof-nonce отчётов): claim и proof не пересекаются.
    pub claim_nonce: u64,

    /// Временная метка успешного claim (аудит, ADR-0002).
    pub claimed_at: i64,

    /// Флаг отзыва (ADR-0007). После revoke/rotate — true: устройство не может
    /// минтить и менять состояние. Дублирует terminal-состояние
    /// DeviceState::Revoked для defense-in-depth и простых проверок.
    pub revoked: bool,

    /// При ротации ключа (ADR-0007) — новый device_id. Pubkey::default(), если
    /// ротации не было. Аудит-след old → new.
    pub rotated_to: Pubkey,
}

impl EnergyProducer {
    /// Разрешено ли устройству минтить в момент `now`:
    /// не отозвано (ADR-0007) И состояние Active (ADR-0005) И tier-лимит
    /// месяца не исчерпан (v7.0 §15).
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

    /// Энергия месяца с учётом «прокрутки» окна к `now`.
    /// Если окно истекло (>= TIER_MONTH_SECS) — новый месяц, энергия = 0.
    pub fn effective_month_energy(&self, now: i64) -> u64 {
        if self.month_start_ts == 0
            || now.saturating_sub(self.month_start_ts) >= crate::constants::TIER_MONTH_SECS
        {
            0
        } else {
            self.month_energy_wh
        }
    }

    /// Прокручивает месячное окно к `now` (вызывать перед записью энергии).
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
        // v7.0 §15: Basic ≤ 100 kWh/мес, Verified ≤ 10 MWh/мес, остальные — без лимита.
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
        // ADR-0007: флаг revoked блокирует mint даже в состоянии Active.
        let mut p = producer_with(DeviceState::Active, DeviceTier::Industrial, 0, 1_000);
        assert!(p.can_mint(1_000));
        p.revoked = true;
        assert!(!p.can_mint(1_000), "revoked device must not mint");
        // И state-переход из Revoked невозможен (терминальное состояние).
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
        // Basic: 60_000 + 50_000 = 110_000 > 100_000 → запрещено (mint-путь).
        assert!(DeviceTier::Basic.allows_increment(60_000, 40_000));
        assert!(!DeviceTier::Basic.allows_increment(60_000, 50_000));
        // Verified: в пределах 10 МВт·ч.
        assert!(DeviceTier::Verified.allows_increment(5_000_000, 5_000_000));
        assert!(!DeviceTier::Verified.allows_increment(5_000_000, 6_000_000));
        // Industrial/Institutional — без лимита.
        assert!(DeviceTier::Industrial.allows_increment(u64::MAX, u64::MAX));
        // Переполнение month_energy + report не «протаскивает» лимит.
        assert!(!DeviceTier::Basic.allows_increment(u64::MAX, 1));
    }
}


