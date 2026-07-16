use anchor_lang::prelude::*;

use crate::error::ErrorCode;

/// Ed25519 verification — упрощённая фаза (MVP).
///
/// Сейчас:
/// - Проверяем, что message не пустое.
/// - Логируем базовую информацию о сообщении и ключе.
/// - НЕ проверяем, что аккаунт действительно sysvar::instructions.
/// - НЕ проверяем фактическое соответствие pubkey/message/signature.
///
/// Важно:
/// - Сигнатура функции уже включает `instructions_sysvar: &AccountInfo`.
/// - Это позволит в следующей фазе добавить реальную проверку без изменения API.
///
/// Следующий этап (после обновления Anchor/Solana):
/// - использовать helper-функции `load_instruction_at*` из актуального `solana_program`;
/// - извлечь ed25519-инструкцию и сверить pubkey/message/signature.
pub fn verify_ed25519_signature(
    signature: &[u8; 64],
    public_key: &[u8; 32],
    message: &[u8],
    _instructions_sysvar: &AccountInfo,
) -> Result<()> {
    // Базовая sanity-проверка
    require!(!message.is_empty(), ErrorCode::InvalidParameter);

    msg!(
        "Ed25519 verification stub (legacy stack): pubkey[0..4]={:?}, msg_len={}, sig_len={}",
        &public_key[..4],
        message.len(),
        signature.len(),
    );

    Ok(())
}

/// Alias для oracle-подписей (если будет использоваться отдельно от девайса).
pub fn verify_oracle_signature(
    signature: &[u8; 64],
    pubkey: &[u8; 32],
    data: &[u8],
    instructions_sysvar: &AccountInfo,
) -> Result<()> {
    verify_ed25519_signature(signature, pubkey, data, instructions_sysvar)
}
