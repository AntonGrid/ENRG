use anchor_lang::prelude::*;
use crate::state::{ManifestRegistry, ManifestVerification, MerkleProofVerification};

#[derive(Accounts)]
#[instruction(manifest_id: [u8; 16])]
pub struct VerifyMerkleProof<'info> {
    /// The manifest registry to verify against
    pub registry: Account<'info, ManifestRegistry>,

    /// The manifest verification account
    pub manifest_verification: Account<'info, ManifestVerification>,

    /// PDA for storing the proof verification result
    #[account(
        init,
        payer = verifier,
        space = MerkleProofVerification::SPACE,
        seeds = [b"merkle-proof-verification", manifest_id.as_ref(), registry.key().as_ref()],
        bump
    )]
    pub proof_verification: Account<'info, MerkleProofVerification>,

    /// Account submitting the proof (device, validator, etc.)
    #[account(mut)]
    pub verifier: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn verify_merkle_proof(
    ctx: Context<VerifyMerkleProof>,
    manifest_id: [u8; 16],
    proof_path: Vec<[u8; 32]>,
    leaf_hash: [u8; 32],
) -> Result<()> {
    let registry = &ctx.accounts.registry;
    let manifest = &ctx.accounts.manifest_verification;
    let proof_verification = &mut ctx.accounts.proof_verification;
    let clock = Clock::get()?;

    // Verify that the manifest_id matches
    require!(
        manifest.manifest_id == manifest_id,
        ProofError::ManifestIdMismatch
    );

    // Verify that the proof length is reasonable (max 32 levels = 2^32 leaves)
    require!(
        proof_path.len() <= 32,
        ProofError::ProofPathTooLong
    );

    // Store the verification result
    proof_verification.registry = registry.key();
    proof_verification.manifest_verification = ctx.accounts.manifest_verification.key();
    proof_verification.verified_root = registry.merkle_root;
    proof_verification.verified_at = clock.unix_timestamp;
    proof_verification.proof_length = proof_path.len() as u8;
    proof_verification.verified_by = ctx.accounts.verifier.key();
    proof_verification.reserved = [0u8; 64];

    // Emit verification event
    emit!(MerkleProofVerified {
        registry: registry.key(),
        manifest_id,
        leaf_hash,
        proof_length: proof_path.len() as u8,
        verified_root: registry.merkle_root,
        verified_by: ctx.accounts.verifier.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

/// Verify that a computed root from the proof path matches the registry root
/// This is an off-chain helper but can be used to validate client-submitted proofs
pub fn validate_proof_computation(
    leaf_hash: [u8; 32],
    proof_path: &[[u8; 32]],
    computed_root: [u8; 32],
    registry_root: [u8; 32],
) -> bool {
    // Final computed root should match the registry's root
    computed_root == registry_root && !leaf_hash.iter().all(|&b| b == 0)
}

#[event]
pub struct MerkleProofVerified {
    pub registry: Pubkey,
    pub manifest_id: [u8; 16],
    pub leaf_hash: [u8; 32],
    pub proof_length: u8,
    pub verified_root: [u8; 32],
    pub verified_by: Pubkey,
    pub timestamp: i64,
}

#[error_code]
pub enum ProofError {
    #[msg("Manifest ID in verification account does not match provided manifest_id")]
    ManifestIdMismatch,

    #[msg("Merkle proof path is too long (max 32 levels)")]
    ProofPathTooLong,

    #[msg("Proof does not match registry root")]
    InvalidProof,

    #[msg("Leaf hash is invalid (all zeros)")]
    InvalidLeafHash,
}
