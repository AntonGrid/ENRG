use anchor_lang::prelude::*;
use crate::constants::INSTRUCTIONS_SYSVAR_ID;
use crate::error::ErrorCode;
use crate::security::verify_ed25519_signature;
use crate::state::{ManifestRegistry, ManifestVerification};

/// Канонический префикс сообщения, которое подписывает ИЗДАТЕЛЬ манифеста.
/// Формат зафиксирован на уровне протокола (ADR-0004/ADR-0007): менять нельзя
/// без одновременной миграции издательских клиентов и офф-чейн паблишера.
pub const MANIFEST_SIGN_MESSAGE_PREFIX: &[u8] = b"enrg:manifest";

/// Сообщение, подписываемое издателем при публикации манифеста:
/// ```text
/// b"enrg:manifest" (13 bytes)
/// || manifest_id       (16 bytes)
/// || content_hash      (32 bytes)
/// || manifest_version  (1 byte)
/// ```
pub fn manifest_sign_message(
    manifest_id: &[u8; 16],
    content_hash: &[u8; 32],
    manifest_version: u8,
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(MANIFEST_SIGN_MESSAGE_PREFIX.len() + 16 + 32 + 1);
    buf.extend_from_slice(MANIFEST_SIGN_MESSAGE_PREFIX);
    buf.extend_from_slice(manifest_id);
    buf.extend_from_slice(content_hash);
    buf.push(manifest_version);
    buf
}

#[derive(Accounts)]
#[instruction(manifest_id: [u8; 16])]
pub struct RegisterManifestVerification<'info> {
    #[account(
        init,
        payer = publisher,
        space = ManifestVerification::SPACE,
        seeds = [b"manifest-verification", manifest_id.as_ref()],
        bump
    )]
    pub verification: Account<'info, ManifestVerification>,

    /// Единственный легитимный ManifestRegistry (PDA программы).
    /// Издатель манифеста обязан быть `oracle_authority` реестра — доверенной
    /// стороной (ADR-0004/ADR-0007). Это закрывает «любой может зарегистрировать
    /// произвольный манифест» (аудит 2026-08-18, P0-1).
    #[account(
        seeds = [b"manifest-registry"],
        bump
    )]
    pub registry: Account<'info, ManifestRegistry>,

    #[account(mut)]
    pub publisher: Signer<'info>,

    /// CHECK: sysvar Instructions — ed25519-precompile-инструкция с подписью
    /// издателя ДОЛЖНА быть в транзакции перед этой инструкцией.
    #[account(
        constraint = instructions.key() == INSTRUCTIONS_SYSVAR_ID @ ErrorCode::InvalidInstructionsAccount
    )]
    pub instructions: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_manifest_verification(
    ctx: Context<RegisterManifestVerification>,
    manifest_id: [u8; 16],
    publisher_key: [u8; 32],
    content_hash: [u8; 32],
    signature: [u8; 64],
    manifest_version: u8,
) -> Result<()> {
    // ── ADR-0004/0007: подпись издателя проверяется on-chain (P0-1) ──
    // 1) Издатель должен быть доверенной стороной (oracle_authority реестра).
    let registry = &ctx.accounts.registry;
    let publisher_pubkey = Pubkey::new_from_array(publisher_key);
    require!(
        publisher_pubkey == registry.oracle_authority,
        ErrorCode::UntrustedManifestPublisher
    );

    // 2) Подпись издателя над каноническим сообщением (см. manifest_sign_message).
    let message = manifest_sign_message(&manifest_id, &content_hash, manifest_version);
    verify_ed25519_signature(
        &signature,
        &publisher_key,
        &message,
        &ctx.accounts.instructions.to_account_info(),
    )?;

    let verification = &mut ctx.accounts.verification;
    let clock = Clock::get()?;

    verification.manifest_id = manifest_id;
    verification.publisher_key = publisher_key;
    verification.content_hash = content_hash;
    verification.signature = signature;
    verification.created_at = clock.unix_timestamp;
    verification.manifest_version = manifest_version;
    verification.verified = true; // подпись действительно проверена
    verification.reserved = [0u8; 32];

    emit!(ManifestVerificationRegistered {
        manifest_id,
        publisher: ctx.accounts.publisher.key(),
        content_hash,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct ManifestVerificationRegistered {
    pub manifest_id: [u8; 16],
    pub publisher: Pubkey,
    pub content_hash: [u8; 32],
    pub timestamp: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_message_format_is_locked() {
        let mid = [1u8; 16];
        let ch = [2u8; 32];
        let msg = manifest_sign_message(&mid, &ch, 7);

        let mut expected = Vec::new();
        expected.extend_from_slice(MANIFEST_SIGN_MESSAGE_PREFIX);
        expected.extend_from_slice(&mid);
        expected.extend_from_slice(&ch);
        expected.push(7);

        assert_eq!(msg, expected);
        assert_eq!(msg.len(), MANIFEST_SIGN_MESSAGE_PREFIX.len() + 16 + 32 + 1);
    }

    #[test]
    fn sign_message_binds_all_fields() {
        let mid = [1u8; 16];
        let ch = [2u8; 32];
        let base = manifest_sign_message(&mid, &ch, 7);

        assert_ne!(base, manifest_sign_message(&[3u8; 16], &ch, 7), "manifest_id must be bound");
        assert_ne!(base, manifest_sign_message(&mid, &[4u8; 32], 7), "content_hash must be bound");
        assert_ne!(base, manifest_sign_message(&mid, &ch, 8), "version must be bound");
    }
}

