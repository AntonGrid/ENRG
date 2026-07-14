use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::state::*;

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

    pub mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeFunds<'info> {
    #[account(
        init,
        payer = authority,
        seeds = [b"buyback", mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault
    )]
    pub buyback_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        seeds = [b"staking", mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault
    )]
    pub staking_pool: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        seeds = [b"dao", mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault
    )]
    pub dao_reserve: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        seeds = [b"emergency", mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault
    )]
    pub emergency_fund: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_vault(
    ctx: Context<InitializeVault>,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    if vault.deployer == Pubkey::default() {
        vault.deployer = ctx.accounts.authority.key();
    } else {
        require_keys_eq!(
            vault.deployer,
            ctx.accounts.authority.key()
        );
    }

    vault.authority = ctx.accounts.authority.key();

    vault.protocol_version = 1;

    vault.total_supply = 0;
    vault.max_supply = MAX_SUPPLY;
    vault.emission_k = EMISSION_DIFFICULTY_K;

    vault.total_energy_wh = 0;
    vault.total_producers = 0;
    vault.total_proofs = 0;

    Ok(())
}

pub fn initialize_funds(
    _ctx: Context<InitializeFunds>,
) -> Result<()> {
    Ok(())
}
