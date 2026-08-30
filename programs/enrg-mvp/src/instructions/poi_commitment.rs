use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::security::verify_ed25519_signature;
use crate::state::{poi_commit_message, PoiCommitment};

/// Commit a Proof-of-Intelligence contribution digest on-chain
/// (ADR-0010 / ENRG-AI Phase 2).
///
/// The device signs `b"enrg:poi:commit" || round || device_id || digest`
/// (Ed25519, verified via the precompile + Instructions sysvar). The PDA
/// [b"poi-commit", round, device_id] stores the digest + signature, so the
/// history of "what was contributed when and by whom" is publicly verifiable
/// without publishing the model weights.
#[derive(Accounts)]
#[instruction(round: u64)]
pub struct CommitContribution<'info> {
    /// Commitment PDA [b"poi-commit", round, device_id].
    #[account(
        init,
        payer = payer,
        space = 8 + PoiCommitment::INIT_SPACE,
        seeds = [b"poi-commit", round.to_le_bytes().as_ref(), device_id.key().as_ref()],
        bump
    )]
    pub commitment: Account<'info, PoiCommitment>,

    /// The device that produced the contribution. Not a transaction signer —
    /// ownership is proven by the Ed25519 signature over the commit message.
    /// CHECK: the pubkey is read-only and bound into the PDA seeds and the
    /// signed message; its validity is enforced by verify_ed25519_signature
    /// against the Ed25519 precompile in the same transaction.
    pub device_id: AccountInfo<'info>,

    /// Rent payer (usually the oracle/aggregator; anyone may commit).
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Instructions sysvar — required for Ed25519 signature verification.
    /// CHECK: read-only sysvar; its address is validated inside
    /// verify_ed25519_signature (INSTRUCTIONS_SYSVAR_ID).
    pub instructions: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn commit_contribution(
    ctx: Context<CommitContribution>,
    round: u64,
    digest: [u8; 32],
    signature: [u8; 64],
) -> Result<()> {
    let device_id = ctx.accounts.device_id.key();
    require!(device_id != Pubkey::default(), ErrorCode::InvalidParameter);
    require!(
        !digest.iter().all(|&b| b == 0),
        ErrorCode::InvalidLeafHash
    );

    let message = poi_commit_message(round, &device_id, &digest);
    verify_ed25519_signature(
        &signature,
        &device_id.to_bytes(),
        &message,
        &ctx.accounts.instructions.to_account_info(),
    )?;

    let clock = Clock::get()?;
    let commitment = &mut ctx.accounts.commitment;
    commitment.device_id = device_id;
    commitment.round = round;
    commitment.digest = digest;
    commitment.signature = signature;
    commitment.committed_at = clock.unix_timestamp;

    emit!(crate::state::events::PoiCommitted {
        device_id,
        round,
        digest,
        committed_at: clock.unix_timestamp,
    });

    msg!("PoI commitment: device={} round={}", device_id, round);
    Ok(())
}
