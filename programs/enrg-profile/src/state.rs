use anchor_lang::prelude::*;

/// EnergyProfile — хранит метаданные устройства и скользящее окно энергии.
///
/// Seeds PDA: [b"profile", authority.key().as_ref()]
#[account]
pub struct EnergyProfile {
    /// Владелец профиля (authority).
    pub authority: Pubkey,
    /// ID устройства (из Device Registry).
    pub device_id: Pubkey,
    /// Номинальная мощность устройства (Вт).
    pub rated_power: u64,
    /// Тип устройства (строка до 32 байт).
    pub device_type: String,
    /// Локация (строка до 64 байт).
    pub location: String,
    /// Скользящее окно энергии за 30 дней (Вт·ч).
    pub device_energy_30d: u128,
    /// Время последнего обновления окна.
    pub device_energy_updated_at: i64,
    /// Bump seed для PDA.
    pub bump: u8,
}

impl EnergyProfile {
    pub const MAX_DEVICE_TYPE_LEN: usize = 32;
    pub const MAX_LOCATION_LEN: usize = 64;

    pub const SIZE: usize = 8 + // discriminator Anchor
        32 + // authority
        32 + // device_id
        8 +  // rated_power
        4 + Self::MAX_DEVICE_TYPE_LEN + // device_type (String)
        4 + Self::MAX_LOCATION_LEN + // location (String)
        16 + // device_energy_30d
        8 +  // device_energy_updated_at
        1;   // bump
}