use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;

pub mod validation;
pub mod ed25519;

pub use validation::*;
pub use ed25519::*;

/// Verify an Ed25519 signature on-chain using Solana's builtin Ed25519 program.
///
/// NOTE: `instructions` account сейчас не используется, оставлен для совместимости
/// с прежней сигнатурой и возможного возвращения к старой модели проверки.
pub fn verify_ed25519_signature(
    signature: &[u8; 64],
    public_key: &[u8; 32],
    message: &[u8],
    _instructions: &AccountInfo,
) -> Result<()> {
    let ix = ed25519::build_ed25519_ix(message, public_key, signature);

    // Встроенная Ed25519-программа не требует аккаунтов, поэтому передаём пустой слайс.
    invoke(&ix, &[]).map_err(Into::into)
}
