use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::ErrorCode;
use crate::state::*;

/// Initialize the global Vault PDA — the store of the protocol economy.
#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Vault::LEN,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// SRC Mint reference (for vault initialization).
    /// Must match the mint stored in TokenMint PDA.
    #[account(
        constraint = mint.key() == token_mint.mint @ crate::error::ErrorCode::InvalidParameter
    )]
    pub mint: Account<'info, Mint>,

    /// TokenMint PDA — protocol token configuration.
    #[account(
        seeds = [b"token-mint"],
        bump = token_mint.bump
    )]
    pub token_mint: Account<'info, TokenMint>,

    pub system_program: Program<'info, System>,
}

/// Initialize the fund addresses in the TokenMint PDA.
#[derive(Accounts)]
pub struct InitializeFunds<'info> {
    /// Vault PDA — global protocol state and owner of all Token Accounts.
    #[account(
        mut,
        seeds = [b"vault"],
        bump,
        constraint = vault.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub vault: Account<'info, Vault>,

    /// TokenMint PDA — holds all token configuration addresses.
    #[account(
        mut,
        seeds = [b"token-mint"],
        bump = token_mint.bump
    )]
    pub token_mint: Account<'info, TokenMint>,

    /// SRC Mint.
    #[account(
        seeds = [b"src-mint"],
        bump = token_mint.mint_bump,
        constraint = mint.key() == token_mint.mint @ ErrorCode::InvalidParameter
    )]
    pub mint: Account<'info, Mint>,

    /// Vault PDA as the token authority for all protocol ATAs.
    /// CHECK: the Vault PDA signs via seeds.
    #[account(
        seeds = [b"vault"],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// Buyback ATA — owned by the Vault PDA.
    /// Must be created in advance.
    #[account(mut)]
    pub buyback_account: Account<'info, TokenAccount>,

    /// Staking rewards ATA — owned by the Vault PDA.
    #[account(mut)]
    pub staking_account: Account<'info, TokenAccount>,

    /// DAO treasury ATA — owned by the Vault PDA.
    #[account(mut)]
    pub dao_account: Account<'info, TokenAccount>,

    /// Emergency reserve ATA — owned by the Vault PDA.
    #[account(mut)]
    pub emergency_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
    // H-2: only EXPECTED_DEPLOYER can initialize the vault
    // (protection against front-running capture of the protocol economy).
    require!(
        ctx.accounts.authority.key() == EXPECTED_DEPLOYER,
        ErrorCode::UnauthorizedDeployer
    );

    let vault = &mut ctx.accounts.vault;

    // The account was just created (all fields zero) — set up the default economy.
    if vault.deployer == Pubkey::default() {
        vault.deployer = ctx.accounts.authority.key();
        vault.authority = ctx.accounts.authority.key();

        vault.protocol_version = 1;

        vault.total_supply = 0;
        vault.max_supply = MAX_SUPPLY_ATOMIC;

        vault.emission_k = EMISSION_DIFFICULTY_K;

        vault.total_energy_wh = 0;
        vault.total_producers = 0;
        vault.total_proofs = 0;
    }

    Ok(())
}

pub fn initialize_funds(ctx: Context<InitializeFunds>) -> Result<()> {
    let token_mint = &mut ctx.accounts.token_mint;

    // Fund Token Accounts must be owned by their fund PDAs
    // (fund-buyback / fund-staking / fund-dao / fund-emergency).
    // This prevents substituting arbitrary ATAs for the fund accounts.
    let program_id = ctx.program_id;
    for (name, seed, account) in [
        ("buyback", b"fund-buyback".as_ref(), &ctx.accounts.buyback_account),
        ("staking", b"fund-staking".as_ref(), &ctx.accounts.staking_account),
        ("dao", b"fund-dao".as_ref(), &ctx.accounts.dao_account),
        ("emergency", b"fund-emergency".as_ref(), &ctx.accounts.emergency_account),
    ] {
        let (fund_pda, _) = Pubkey::find_program_address(&[seed], program_id);
        require!(
            account.owner == fund_pda,
            ErrorCode::InvalidParameter
        );
        msg!("{} fund account verified: {}", name, account.key());
    }

    // Store all fund addresses in the TokenMint PDA
    token_mint.buyback_account = ctx.accounts.buyback_account.key();
    token_mint.staking_account = ctx.accounts.staking_account.key();
    token_mint.dao_account = ctx.accounts.dao_account.key();
    token_mint.emergency_account = ctx.accounts.emergency_account.key();

    Ok(())
}

/// Change Vault.authority (protocol admin / temporary governor).
///
/// ROLE SEPARATION (audit BLOCK 2): Vault.authority — protocol admin,
/// managing vault/funds/security; the oracle list is a separate role
/// (oracle_admin in OracleRegistry). The mint-authority PDA mechanism is unaffected.
///
/// TODO(audit): implement a two-step change (pending_authority + accept) and/or
/// timelock/multisig. Currently the change is single-step and recorded by the
/// VaultAuthorityChanged event. Changing the Vault layout (adding pending_authority)
/// requires migrating the deployed account, so it is deliberately deferred.
#[derive(Accounts)]
pub struct SetVaultAuthority<'info> {
    #[account(
        mut,
        seeds = [b"vault"],
        bump,
        constraint = vault.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub vault: Box<Account<'info, Vault>>,

    pub authority: Signer<'info>,
}

pub fn set_vault_authority(
    ctx: Context<SetVaultAuthority>,
    new_authority: Pubkey,
) -> Result<()> {

    require!(
        new_authority != Pubkey::default(),
        ErrorCode::InvalidParameter
    );

    let vault = &mut ctx.accounts.vault;
    let old_authority = vault.authority;
    vault.authority = new_authority;

    emit!(VaultAuthorityChanged {
        old_authority,
        new_authority,
        changed_by: ctx.accounts.authority.key(),
    });

    msg!(
        "Vault authority changed: {} -> {}",
        old_authority,
        new_authority
    );

    Ok(())
}
