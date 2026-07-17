use anchor_lang::prelude::*;
use crate::state::ManifestVerification;

#[derive(Accounts)]
#[instruction(manifest_id: [u8; 16])]
pub struct RegisterManifestVerification<'info> {
    #[account(
        init,
        payer = publisher,
        space = ManifestVerification::SPACE,
        seeds = [b"manifest-verification", &manifest_id],
        bump
    )]
    pub verification: Account<'info, ManifestVerification>,

    #[account(mut)]
    pub publisher: Signer<'info>,

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
    let verification = &mut ctx.accounts.verification;
    let clock = Clock::get()?;

    verification.manifest_id = manifest_id;
    verification.publisher_key = publisher_key;
    verification.content_hash = content_hash;
    verification.signature = signature;
    verification.created_at = clock.unix_timestamp;
    verification.manifest_version = manifest_version;
    verification.verified = false;
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
