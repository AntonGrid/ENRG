use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
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
            (Quarantine, Revoked) => true,
            (Maintenance, Active) => true,
            (Maintenance, Revoked) => true,
            (_, Revoked) => true,
            _ => false,
        }
    }
}

impl Default for DeviceState {
    fn default() -> Self {
        DeviceState::Unregistered
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
}
