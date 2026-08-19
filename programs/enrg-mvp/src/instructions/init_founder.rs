use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::constants::{FOUNDER_ALLOCATION_ATOMIC, FOUNDER_WALLET};
use crate::error::ErrorCode;
use crate::state::{founder_premine_not_minted, TokenMint, Vault};

/// One-shot founder premine at launch: 20% of MAX_SUPPLY_ATOMIC (2e17)
/// is minted to the founder ATA (owner = FOUNDER_WALLET) and counted into
/// vault.total_supply. After that founder_minted = 1 — a second premine is
/// impossible. Tokens can leave the founder ATA only via vesting claim
/// (claim_vested performs the real transfer).
///
/// IMPORTANT: after the premine vault.total_supply = 2e17, which is reflected
/// in energy_per_src / supply_fraction — the starting difficulty starts from
/// an occupied supply share.
#[derive(Accounts)]
pub struct AllocateFounder<'info> {
    /// Vault PDA — global protocol state (total_supply/max_supply).
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    /// TokenMint PDA — token configuration (founder ATA + one-shot flag).
    #[account(
        mut,
        seeds = [b"token-mint"],
        bump = token_mint.bump
    )]
    pub token_mint: Box<Account<'info, TokenMint>>,

    /// SRC Mint (writable — the CPI token::mint_to increases supply).
    #[account(
        mut,
        seeds = [b"src-mint"],
        bump = token_mint.mint_bump,
        constraint = mint.key() == token_mint.mint @ ErrorCode::InvalidParameter
    )]
    pub mint: Box<Account<'info, Mint>>,

    /// CHECK: Mint Authority PDA — dedicated signer for token::mint_to().
    #[account(
        seeds = [b"mint-authority"],
        bump = token_mint.mint_authority_bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// Founder ATA — premine recipient (owner = FOUNDER_WALLET).
    #[account(
        mut,
        constraint = founder_token_account.owner == FOUNDER_WALLET
            @ ErrorCode::Unauthorized
    )]
    pub founder_token_account: Box<Account<'info, TokenAccount>>,

    /// Signer — must be FOUNDER_WALLET.
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn allocate_founder(ctx: Context<AllocateFounder>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let token_mint = &mut ctx.accounts.token_mint;

    // ── Only FOUNDER_WALLET initiates the premine ──
    require!(
        ctx.accounts.payer.key() == FOUNDER_WALLET,
        ErrorCode::Unauthorized
    );

    // ── One-shot: a second premine is forbidden ──
    require!(
        founder_premine_not_minted(token_mint.founder_minted),
        ErrorCode::FounderPremineAlreadyMinted
    );

    // ── First call: lock the founder ATA in TokenMint (only it from now on) ──
    if token_mint.founder_account == Pubkey::default() {
        token_mint.founder_account = ctx.accounts.founder_token_account.key();
    }
    require!(
        token_mint.founder_account == ctx.accounts.founder_token_account.key(),
        ErrorCode::InvalidParameter
    );

    // ── Limit: total_supply + 2e17 <= MAX_SUPPLY_ATOMIC ──
    let new_supply = vault
        .total_supply
        .checked_add(FOUNDER_ALLOCATION_ATOMIC)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        new_supply <= vault.max_supply,
        ErrorCode::SupplyLimitExceeded
    );

    // ── Actual mint_to via the Mint Authority PDA ──
    let mint_authority_bump = token_mint.mint_authority_bump;
    let signer_seeds: &[&[u8]] = &[b"mint-authority".as_ref(), &[mint_authority_bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.founder_token_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        FOUNDER_ALLOCATION_ATOMIC,
    )?;

    vault.total_supply = new_supply;
    token_mint.founder_minted = 1;

    msg!(
        "Founder premine minted {} atomic to {}",
        FOUNDER_ALLOCATION_ATOMIC,
        ctx.accounts.founder_token_account.key()
    );

    Ok(())
}