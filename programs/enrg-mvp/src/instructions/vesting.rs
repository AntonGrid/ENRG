use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{
    FOUNDER_ALLOCATION_ATOMIC, FOUNDER_VESTING_CLIFF, FOUNDER_VESTING_RELEASE, FOUNDER_WALLET,
};
use crate::error::ErrorCode;
use crate::state::*;

/// Bootstrap-путь для FounderVesting.
///
/// Аккаунт можно получить двумя способами (обратно совместимо):
/// 1. **Генезис/пре-сид** (localnet `solana-test-validator --account`,
///    файл `tests/genesis/founder-vesting.json`): аккаунт уже существует по
///    адресу `findProgramAddress([b"founder-vesting"])` и принадлежит программе —
///    `init_if_needed` пропускает инициализацию, поля перезаписываются.
/// 2. **On-chain bootstrap** (Devnet/mainnet): аккаунт отсутствует — `init_if_needed`
///    создаёт его программой по тому же seed (payer = founder), далее обработчик
///    заполняет поля. Никакой внешней genesis-инъекции не требуется.
#[derive(Accounts)]
pub struct InitializeFounderVesting<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + FounderVesting::LEN,
        seeds = [b"founder-vesting"],
        bump,
    )]
    pub vesting: Account<'info, FounderVesting>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimVested<'info> {
    #[account(mut)]
    pub vesting: Account<'info, FounderVesting>,

    /// Источник — тот же founder ATA, на который был заминчен премайн
    /// (владелец — FOUNDER_WALLET). Токены нельзя вывести откуда-либо ещё.
    #[account(
        mut,
        constraint = founder_ata.owner == FOUNDER_WALLET
            @ ErrorCode::Unauthorized
    )]
    pub founder_ata: Account<'info, TokenAccount>,

    /// Куда переводим — ATA кошелька основателя.
    #[account(mut)]
    pub destination_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn initialize_founder_vesting(
    ctx: Context<InitializeFounderVesting>,
) -> Result<()> {

    // Единый бенефициар founder-вестинга зашит в программу:
    // инициализировать вестинг может только FOUNDER_WALLET.
    require!(
        ctx.accounts.authority.key() == FOUNDER_WALLET,
        ErrorCode::Unauthorized
    );

    let vesting = &mut ctx.accounts.vesting;
    let now = Clock::get()?.unix_timestamp;

    vesting.founder = FOUNDER_WALLET;
    vesting.total_amount = FOUNDER_ALLOCATION_ATOMIC; // 2e17 зашито
    vesting.start_time = now;
    vesting.cliff = FOUNDER_VESTING_CLIFF;      // 1 год
    vesting.release = FOUNDER_VESTING_RELEASE;  // 3 года
    vesting.withdrawn = 0;
    vesting.last_claim = now;

    Ok(())
}

pub fn claim_vested(
    ctx: Context<ClaimVested>,
) -> Result<()> {

    let vesting = &mut ctx.accounts.vesting;

    require!(
        vesting.founder == ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );

    let now = Clock::get()?.unix_timestamp;

    // Cliff + линейный release (чистая функция из state::vesting).
    let vested = vesting.vested_at(now);

    require!(
        vested >= vesting.withdrawn,
        ErrorCode::ArithmeticOverflow
    );

    let claimable = vested
        .checked_sub(vesting.withdrawn)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    require!(
        claimable > 0,
        ErrorCode::NothingToClaim
    );

    // РЕАЛЬНЫЙ перевод с founder_ata на destination_ata.
    // authority (Signer = FOUNDER_WALLET) подписывает transfer, потому что
    // founder_ata принадлежит FOUNDER_WALLET. Источник строго founder_ata
    // (создаётся и пополняется только премайном), сумма ограничена vested —
    // вывести раньше времени невозможно.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.founder_ata.to_account_info(),
                to: ctx.accounts.destination_ata.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        claimable,
    )?;

    vesting.withdrawn = vested;
    vesting.last_claim = now;

    msg!(
        "Founder transferred {} SRC (atomic), withdrawn_total={}",
        claimable, vested
    );

    Ok(())
}
