use anchor_lang::prelude::*;

/// Per-owner device registry — счётчик устройств владельца.
///
/// Seeds: [b"owner-devices", owner.key().as_ref()]
/// Создаётся при первом claim устройства владельцем (init_if_needed).
///
/// Лимит активных устройств на одного владельца (BLOCK 4 аудита) защищает
/// от «дробления» устройств — массовой регистрации мелких device_id с целью
/// обхода лимитов/манипуляций экономикой.
#[account]
#[derive(InitSpace)]
pub struct OwnerDevices {
    /// Владелец устройств (wallet).
    pub owner: Pubkey,

    /// Всего устройств, заявленных (claimed) владельцем за всё время.
    pub total_claimed: u64,

    /// Текущее число устройств владельца в состоянии Active.
    pub active_count: u64,
}
