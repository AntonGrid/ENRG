use anchor_lang::prelude::*;

use crate::error::ErrorCode;

/// Ed25519 verification — упрощённая фаза.
///
/// Сейчас:
/// - Проверяем только, что message не пустое.
/// - Логируем базовую информацию о сообщении и ключе.
/// - НЕ проверяем, что аккаунт действительно sysvar::instructions.
/// - НЕ парсим инструкции и НЕ сверяем pubkey/message/signature.
///
/// Важно:
/// - Сигнатура функции уже включает instructions_sysvar: &AccountInfo.
/// - Это позволит в следующей фазе добавить реальную проверку без изменения API.
pub fn verify_ed25519_signature(
    signature: &[u8; 64],
    public_key: &[u8; 32],
    message: &[u8],
    _instructions_sysvar: &AccountInfo,
) -> Result<()> {
    require!(!message.is_empty(), ErrorCode::InvalidParameter);

    msg!(
        "Ed25519 verification stub (phase: instructions wired but not parsed): \
         public_key[0..4]={:?}, msg_len={}, sig_len={}",
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
