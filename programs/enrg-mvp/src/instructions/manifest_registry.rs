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

    /// Oracle that is authorized to update the root
    #[account(address = registry.oracle_authority)]
    pub oracle: Signer<'info>,

    /// Authority to manage oracle access
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetOracleAuthority<'info> {
    #[account(mut, has_one = authority)]
    pub registry: Account<'info, ManifestRegistry>,

    pub authority: Signer<'info>,
}

pub fn initialize_manifest_registry(ctx: Context<InitializeManifestRegistry>) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    let clock = Clock::get()?;

    registry.authority = ctx.accounts.authority.key();
    registry.oracle_authority = ctx.accounts.authority.key();
    registry.merkle_root = [0u8; 32];
    registry.updated_at = clock.unix_timestamp;
    registry.version = 1;
    registry.manifest_count = 0;
    registry.reserved = [0u8; 64];

    emit!(ManifestRegistryInitialized {
        registry: registry.key(),
        authority: registry.authority,
        oracle_authority: registry.oracle_authority,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

pub fn set_oracle_authority(
    ctx: Context<SetOracleAuthority>,
    new_oracle: Pubkey,
) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    let old_oracle = registry.oracle_authority;

    registry.oracle_authority = new_oracle;

    emit!(OracleAuthorityChanged {
        registry: registry.key(),
        old_oracle,
        new_oracle,
        changed_by: ctx.accounts.authority.key(),
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
        updated_by: ctx.accounts.oracle.key(),
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
    pub oracle_authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MerkleRootUpdated {
    pub registry: Pubkey,
    pub new_root: [u8; 32],
    pub version: u64,
    pub manifest_count: u64,
    pub updated_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct OracleAuthorityChanged {
    pub registry: Pubkey,
    pub old_oracle: Pubkey,
    pub new_oracle: Pubkey,
    pub changed_by: Pubkey,
}

#[error_code]
pub enum RegistryError {
    #[msg("Overflow in version counter")]
    Overflow,
}
