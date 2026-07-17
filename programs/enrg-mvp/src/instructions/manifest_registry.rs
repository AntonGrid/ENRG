use anchor_lang::prelude::*;
use crate::state::ManifestRegistry;

#[derive(Accounts)]
pub struct InitializeManifestRegistry<'info> {
    #[account(init, payer = authority, space = ManifestRegistry::SPACE)]
    pub registry: Account<'info, ManifestRegistry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMerkleRoot<'info> {
    #[account(mut, has_one = authority)]
    pub registry: Account<'info, ManifestRegistry>,

    pub authority: Signer<'info>,
}

pub fn initialize_manifest_registry(ctx: Context<InitializeManifestRegistry>) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    let clock = Clock::get()?;

    registry.authority = ctx.accounts.authority.key();
    registry.merkle_root = [0u8; 32];
    registry.updated_at = clock.unix_timestamp;
    registry.version = 1;
    registry.manifest_count = 0;
    registry.reserved = [0u8; 64];

    emit!(ManifestRegistryInitialized {
        registry: registry.key(),
        authority: registry.authority,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

pub fn update_merkle_root(
    ctx: Context<UpdateMerkleRoot>,
    new_root: [u8; 32],
    manifest_count: u64,
) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    let clock = Clock::get()?;

    registry.merkle_root = new_root;
    registry.updated_at = clock.unix_timestamp;
    registry.version = registry.version.checked_add(1).ok_or(error!(RegistryError::Overflow))?;
    registry.manifest_count = manifest_count;

    emit!(MerkleRootUpdated {
        registry: registry.key(),
        new_root,
        version: registry.version,
        manifest_count,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

pub fn query_merkle_root(registry: &ManifestRegistry) -> [u8; 32] {
    registry.merkle_root
}

#[event]
pub struct ManifestRegistryInitialized {
    pub registry: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MerkleRootUpdated {
    pub registry: Pubkey,
    pub new_root: [u8; 32],
    pub version: u64,
    pub manifest_count: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum RegistryError {
    #[msg("Overflow in version counter")]
    Overflow,
}
