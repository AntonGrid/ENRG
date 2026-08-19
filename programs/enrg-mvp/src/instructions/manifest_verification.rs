use anchor_lang::prelude::*;
use crate::constants::INSTRUCTIONS_SYSVAR_ID;
use crate::error::ErrorCode;
use crate::security::verify_ed25519_signature;
use crate::state::{ManifestRegistry, ManifestVerification};

/// Canonical prefix of the message signed by the manifest PUBLISHER.
/// The format is fixed at the protocol level (ADR-0004/ADR-0007): it cannot
/// be changed without a coordinated migration of publisher clients and the
/// off-chain publisher.
pub const MANIFEST_SIGN_MESSAGE_PREFIX: &[u8] = b"enrg:manifest";

/// The message signed by the publisher when publishing a manifest:
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

    /// The only legitimate ManifestRegistry (program PDA).
    /// The manifest publisher must be the registry `oracle_authority` — a trusted
    /// party (ADR-0004/ADR-0007). This closes the "anyone can register an
    /// arbitrary manifest" gap (audit 2026-08-18, P0-1).
    #[account(
        seeds = [b"manifest-registry"],
        bump
    )]
    pub registry: Account<'info, ManifestRegistry>,

    #[account(mut)]
    pub publisher: Signer<'info>,

    /// CHECK: sysvar Instructions — an ed25519 precompile instruction with the
    /// publisher signature MUST be in the transaction before this instruction.
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
    // ── ADR-0004/0007: the publisher signature is verified on-chain (P0-1) ──
    // 1) The publisher must be a trusted party (registry oracle_authority).
    let registry = &ctx.accounts.registry;
    let publisher_pubkey = Pubkey::new_from_array(publisher_key);
    require!(
        publisher_pubkey == registry.oracle_authority,
        ErrorCode::UntrustedManifestPublisher
    );

    // 2) The publisher signature over the canonical message (see manifest_sign_message).
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
    verification.verified = true; // the signature was actually verified
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

