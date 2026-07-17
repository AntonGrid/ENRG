use anchor_lang::prelude::*;

#[account]
pub struct ManifestVerification {
    /// ID манифеста (совпадает с UUID из off-chain реестра)
    pub manifest_id: [u8; 16],

    /// ED25519 публичный ключ издателя (32 байта)
    pub publisher_key: [u8; 32],

    /// Хеш содержимого манифеста (Keccak256, 32 байта)
    pub content_hash: [u8; 32],

    /// ED25519 подпись (64 байта)
    pub signature: [u8; 64],

    /// Timestamp публикации
    pub created_at: i64,

    /// Статус верификации
    pub verified: bool,

    /// Версия схемы манифеста
    pub manifest_version: u8,

    /// Reserved для будущих расширений
    pub reserved: [u8; 32],
}

impl ManifestVerification {
    pub const SPACE: usize = 8 + 16 + 32 + 32 + 64 + 8 + 1 + 1 + 32;
}
