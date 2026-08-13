use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::error::ErrorCode;
use crate::state::*;

/// Теги протокольных фондов для `withdraw_fund` (единый паттерн вывода).
pub const FUND_BUYBACK: u8 = 0;
pub const FUND_STAKING: u8 = 1;
pub const FUND_DAO: u8 = 2;
pub const FUND_EMERGENCY: u8 = 3;

/// Вывод уже выпущенных SRC из ATA протокольного фонда на ATA получателя.
///
/// Это перевод (transfer), а не mint: новые токены не создаются.
/// Управляется единым паттерном для всех четырёх фондов
/// (buyback / staking / dao / emergency) через аргумент `fund_tag`.
///
/// АВТОРИЗАЦИЯ (временная): пока отдельного governance нет, роль governor
/// исполняет Vault.authority (см. BLOCK 2 аудита — set_authority и план
/// multisig/timelock). TODO(audit): заменить Vault.authority на выделенного
/// governor / мультисиг после внедрения governance.
#[derive(Accounts)]
pub struct WithdrawFund<'info> {
    /// Vault PDA — глобальное состояние протокола (проверка authority).
    #[account(
        seeds = [b"vault"],
        bump,
        constraint = vault.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub vault: Box<Account<'info, Vault>>,

    /// TokenMint PDA — хранит адреса фондовых ATA.
    #[account(
        seeds = [b"token-mint"],
        bump = token_mint.bump
    )]
    pub token_mint: Box<Account<'info, TokenMint>>,

    /// Временный governor — Vault.authority.
    pub authority: Signer<'info>,

    /// ATA конкретного фонда (источник вывода).
    #[account(mut)]
    pub fund_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA фонда — владелец `fund_account`, подписывает CPI-перевод
    /// через seeds. Соответствие тегу проверяется в handler.
    pub fund_authority: UncheckedAccount<'info>,

    /// ATA получателя (для того же mint).
    #[account(mut)]
    pub destination: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn withdraw_fund(ctx: Context<WithdrawFund>, fund_tag: u8, amount: u64) -> Result<()> {
    // ── Авторизация: Vault.authority как временный governor ──
    require!(
        ctx.accounts.vault.authority == ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );
    require!(amount > 0, ErrorCode::ZeroAmountMint);

    let token_mint = &ctx.accounts.token_mint;

    // ── Определяем seed и ожидаемую ATA по тегу фонда ──
    let (seed, expected_fund_account) = match fund_tag {
        FUND_BUYBACK => (b"fund-buyback".as_ref(), token_mint.buyback_account),
        FUND_STAKING => (b"fund-staking".as_ref(), token_mint.staking_account),
        FUND_DAO => (b"fund-dao".as_ref(), token_mint.dao_account),
        FUND_EMERGENCY => (b"fund-emergency".as_ref(), token_mint.emergency_account),
        _ => return Err(ErrorCode::InvalidParameter.into()),
    };

    // ── Фонд обязан быть тем, что записан в TokenMint для этого тега ──
    require!(
        ctx.accounts.fund_account.key() == expected_fund_account,
        ErrorCode::InvalidParameter
    );

    // ── fund_authority обязан быть PDA фонда, а ATA принадлежать ему ──
    let (fund_pda, fund_bump) = Pubkey::find_program_address(&[seed], ctx.program_id);
    require!(
        ctx.accounts.fund_authority.key() == fund_pda,
        ErrorCode::InvalidParameter
    );
    require!(
        ctx.accounts.fund_account.owner == fund_pda,
        ErrorCode::Unauthorized
    );

    // ── Получатель обязан быть ATA того же mint ──
    require!(
        ctx.accounts.destination.mint == ctx.accounts.fund_account.mint,
        ErrorCode::InvalidParameter
    );

    // ── Лимит по балансу фонда ──
    require!(
        ctx.accounts.fund_account.amount >= amount,
        ErrorCode::InsufficientStake
    );

    // ── CPI transfer: фонд (fund PDA) -> получатель ──
    let signer_seeds: &[&[u8]] = &[seed, &[fund_bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.fund_account.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.fund_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
    )?;

    emit!(FundsWithdrawn {
        fund_tag,
        amount,
        to: ctx.accounts.destination.key(),
        by: ctx.accounts.authority.key(),
    });

    msg!(
        "Funds withdrawn: tag={}, amount={}, to={}",
        fund_tag,
        amount,
        ctx.accounts.destination.key()
    );

    Ok(())
}
