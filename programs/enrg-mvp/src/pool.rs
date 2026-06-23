use anchor_lang::prelude::*;

#[account]
pub struct Pool {
    pub id: u64,                // Уникальный идентификатор пула
    pub authority: Pubkey,      // Владелец/создатель пула
    pub total_energy: u128,     // Суммарная энергия, накопленная в пуле
    pub threshold: u128,        // Порог для минта (по умолчанию 1_000_000 Wh)
    pub producers: Vec<Pubkey>, // Список производителей в пуле
    pub is_active: bool,
    pub created_at: i64,
}

impl Pool {
    pub const LEN: usize = 8 + 8 + 32 + 16 + 16 + 4 + 100 * 32 + 1 + 8;
}
