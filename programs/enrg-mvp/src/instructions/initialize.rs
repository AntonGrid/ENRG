use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::state::*;

/// Инициализация глобального Vault PDA — хранилища экономики протокола.
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

/// Инициализация адресов фондов в TokenMint PDA.
#[derive(Accounts)]
pub struct InitializeFunds<'info> {
    /// Vault PDA — глобальное состояние протокола и владелец всех Token Accounts.
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, Vault>,

    /// TokenMint PDA — хранит все конфигурационные адреса токена.
    #[account(
        mut,
        seeds = [b"token-mint"],
        bump = token_mint.bump
    )]
    pub token_mint: Account<'info, TokenMint>,

    /// SRC Mint.
    #[account(
        seeds = [b"src-mint"],
        bump = token_mint.mint_bump
    )]
    pub mint: Account<'info, Mint>,

    /// Vault PDA как токенный авторити для всех протокольных ATA.
    /// CHECK: Vault PDA подписывает через seeds.
    #[account(
        seeds = [b"vault"],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// Buyback ATA — принадлежит Vault PDA.
    /// Должен быть создан заранее.
    #[account(mut)]
    pub buyback_account: Account<'info, TokenAccount>,

    /// Staking rewards ATA — принадлежит Vault PDA.
    #[account(mut)]
    pub staking_account: Account<'info, TokenAccount>,

    /// DAO treasury ATA — принадлежит Vault PDA.
    #[account(mut)]
    pub dao_account: Account<'info, TokenAccount>,

    /// Emergency reserve ATA — принадлежит Vault PDA.
    #[account(mut)]
    pub emergency_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    // Аккаунт только что создан (все поля в нулях) — настраиваем дефолтную экономику.
    if vault.deployer == Pubkey::default() {
        vault.deployer = ctx.accounts.authority.key();
        vault.authority = ctx.accounts.authority.key();

        vault.protocol_version = 1;

        vault.total_supply = 0;
        vault.max_supply = MAX_SUPPLY;

        vault.emission_k = EMISSION_DIFFICULTY_K;

        vault.total_energy_wh = 0;
        vault.total_producers = 0;
        vault.total_proofs = 0;
    }

    Ok(())
}

pub fn initialize_funds(ctx: Context<InitializeFunds>) -> Result<()> {
    let token_mint = &mut ctx.accounts.token_mint;

    // Сохраняем все адреса фондов в TokenMint PDA
    token_mint.buyback_account = ctx.accounts.buyback_account.key();
    token_mint.staking_account = ctx.accounts.staking_account.key();
    token_mint.dao_account = ctx.accounts.dao_account.key();
    token_mint.emergency_account = ctx.accounts.emergency_account.key();

    Ok(())
}
