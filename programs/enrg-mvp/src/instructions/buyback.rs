use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount};

use crate::error::ErrorCode;
use crate::state::*;

/// Burns SRC tokens from the buyback fund.
///
/// Anyone can trigger buyback & burn. Tokens are burned
/// from the protocol-owned buyback account, reducing total supply.
pub fn buyback_and_burn(ctx: Context<BuybackAndBurn>, amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    require!(amount > 0, ErrorCode::ZeroAmountMint);

    // Check buyback balance
    let buyback_balance = ctx.accounts.buyback_account.amount;
    require!(
        amount <= buyback_balance,
        ErrorCode::InsufficientStake
    );

    // Burn tokens from buyback account
    let token_program = ctx.accounts.token_program.key();

    token::burn(
        CpiContext::new(
            token_program,
            Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.buyback_account.to_account_info(),
                authority: ctx.accounts.buyback_authority.to_account_info(),
            },
        ),
        amount,
    )?;

    // Update vault supply
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

    /// CHECK: Buyback authority PDA signs for burning tokens from buyback_account.
    /// The PDA is derived from seeds matching TokenMint config.
    #[account(
        seeds = [b"buyback-authority"],
        bump = token_mint.buyback_authority_bump
    )]
    pub buyback_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}
