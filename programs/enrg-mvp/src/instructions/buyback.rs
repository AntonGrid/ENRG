use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount};

use crate::error::ErrorCode;
use crate::state::*;

/// Burns SRC tokens from the buyback fund.
///
/// Anyone can trigger buyback & burn. Tokens are burned
/// from the protocol-owned buyback account, reducing total supply.
/// Buyback PDA (fund-buyback) signs for burn because it is the owner of buyback_account.
pub fn buyback_and_burn(ctx: Context<BuybackAndBurn>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmountMint);

    // Check buyback balance
    let buyback_balance = ctx.accounts.buyback_account.amount;
    require!(
        amount <= buyback_balance,
        ErrorCode::InsufficientStake
    );

    // Burn tokens from buyback account.
    // Buyback PDA (fund-buyback) is the owner of buyback_account,
    // so it signs via seeds [b"fund-buyback"].
    let buyback_bump = ctx.accounts.token_mint.buyback_authority_bump;
    let buyback_seeds = &[
        b"fund-buyback".as_ref(),
        &[buyback_bump],
    ];
    let signer_seeds = &[buyback_seeds.as_slice()];

    // Use buyback PDA as authority for burn
    token::burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.buyback_account.to_account_info(),
                authority: ctx.accounts.buyback_authority.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    // Update vault supply
    let vault = &mut ctx.accounts.vault;
    vault.total_supply = vault
        .total_supply
        .checked_sub(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    emit!(TokensBurned {
        amount,
        remaining: buyback_balance - amount,
        total_supply: vault.total_supply,
    });

    msg!(
        "Burned {} SRC from buyback fund (remaining: {}, total supply: {})",
        amount,
        buyback_balance - amount,
        vault.total_supply
    );

    Ok(())
}

#[derive(Accounts)]
pub struct BuybackAndBurn<'info> {
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        seeds = [b"src-mint"],
        bump = token_mint.mint_bump
    )]
    pub mint: Box<Account<'info, Mint>>,

    pub token_mint: Box<Account<'info, TokenMint>>,

    #[account(mut)]
    pub buyback_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: Buyback PDA (fund-buyback) is the owner of buyback_account.
    /// Seeds: [b"fund-buyback"]. Bump stored in TokenMint.
    #[account(
        seeds = [b"fund-buyback"],
        bump = token_mint.buyback_authority_bump,
    )]
    pub buyback_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}
