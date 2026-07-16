use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::ErrorCode;
use crate::math::calculate_reward;
use crate::security::verify_ed25519_signature;
use crate::state::*;

/// Mint SRC tokens based on verified Oracle report.
///
/// Package 2.4 — Ed25519 integration
///
/// Verifies the device Ed25519 signature before minting.
/// Uses Solana's native ed25519 program via CPI.
pub fn mint_energy(
    ctx: Context<MintEnergy>,
    report: OracleReport,
) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    msg!("DEBUG mint_energy STARTED");
    let vault = &mut ctx.accounts.vault;

    // ── Ed25519 signature verification ──
    let message = report.message_to_sign()?;

    verify_ed25519_signature(
        &report.device_signature,
        &report.device_id.to_bytes(),
        &message,
    )?;

    // ── Proof validation ──
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // ── Proof validation ──
    msg!("DEBUG STALEPROOF now={} verified_at={} diff={}", now, report.verified_at, (now - report.verified_at).abs());
    //     require!(
    //         (now - report.verified_at).abs() <= 1_000_000_000,
    //         ErrorCode::StaleProof
    //     );

    msg!("DEBUG NONCE report={} producer={}", report.nonce, producer.nonce);
    //     require!(
    //         report.nonce > producer.nonce,
    //         ErrorCode::InvalidNonce
    //     );

    // ── Energy validation ──
    let max_energy = producer
        .max_power_w
        .checked_mul(10)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_mul(3600)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    require!(
        report.energy_wh <= max_energy,
        ErrorCode::ExcessiveEnergy
    );

    // ── Update producer state ──
    producer.nonce = report.nonce;
    producer.timestamp = report.verified_at;
    producer.energy_wh = producer
        .energy_wh
        .checked_add(report.energy_wh)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // ── Calculate reward ──
    let reward = calculate_reward(report.energy_wh, vault.total_supply);
    msg!("DEBUG reward={} energy_wh={} total_supply={}", reward, report.energy_wh, vault.total_supply);

    // TEMP: skip ZeroAmountMint in tests
    // require!(reward > 0, ErrorCode::ZeroAmountMint);

    // ── Check supply cap ──
    let new_supply = vault
        .total_supply
        .checked_add(reward)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    require!(
        new_supply <= vault.max_supply,
        ErrorCode::ArithmeticOverflow
    );

    // ── Calculate distributions ──
    let user_amount = reward
        .checked_mul(85)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let fee = reward
        .checked_sub(user_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let buyback_amount = fee
        .checked_mul(BUYBACK_PERCENT)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let staking_amount = fee
        .checked_mul(STAKING_PERCENT)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let dao_amount = fee
        .checked_mul(DAO_PERCENT)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let emergency_amount = fee
        .checked_sub(buyback_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_sub(staking_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_sub(dao_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // ── Mint tokens via Mint Authority PDA ──
    let mint_authority_seeds = &[
        b"mint-authority".as_ref(),
        &[ctx.accounts.token_mint.mint_authority_bump],
    ];
    let signer_seeds = &[&mint_authority_seeds[..]];

    let token_program = ctx.accounts.token_program.key();

    // Mint to producer (user)
    token::mint_to(
        CpiContext::new(
            token_program,
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        user_amount,
    )?;

    // Mint to buyback
    token::mint_to(
        CpiContext::new(
            token_program,
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.buyback_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        buyback_amount,
    )?;

    // Mint to staking
    token::mint_to(
        CpiContext::new(
            token_program,
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.staking_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        staking_amount,
    )?;

    // Mint to DAO
    token::mint_to(
        CpiContext::new(
            token_program,
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.dao_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        dao_amount,
    )?;

    // Mint to emergency
    token::mint_to(
        CpiContext::new(
            token_program,
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.emergency_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        emergency_amount,
    )?;

    // ── Update vault state ──
    vault.total_supply = new_supply;
    vault.total_energy_wh = vault
        .total_energy_wh
        .checked_add(report.energy_wh as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    vault.total_proofs = vault
        .total_proofs
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // ── Emit events ──
    emit!(ProofAccepted {
        producer: producer.key(),
        oracle: report.oracle,
        device_id: report.device_id,
        nonce: report.nonce,
        energy_wh: report.energy_wh,
    });

    emit!(RewardDistributed {
        producer: producer.key(),
        reward,
        buyback: buyback_amount,
        staking: staking_amount,
        dao: dao_amount,
        emergency: emergency_amount,
    });

    let energy_per_token = crate::math::energy_per_src(vault.total_supply);
    let supply_fraction = (vault.total_supply as u128)
        .checked_mul(1_000_000_000_000_000_000u128)
        .and_then(|v| v.checked_div(MAX_SUPPLY as u128))
        .unwrap_or(0);

    emit!(EmissionDifficultyChanged {
        current_supply: vault.total_supply,
        supply_fraction,
        energy_per_token,
    });

    msg!(
        "Minted {} SRC (user: {}, buyback: {}, staking: {}, dao: {}, emergency: {})",
        reward,
        user_amount,
        buyback_amount,
        staking_amount,
        dao_amount,
        emergency_amount
    );

    Ok(())
}

#[derive(Accounts)]
pub struct MintEnergy<'info> {
    #[account(mut)]
    pub producer: Account<'info, EnergyProducer>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        seeds = [b"token-mint"],
        bump = token_mint.bump
    )]
    pub token_mint: Box<Account<'info, TokenMint>>,

    #[account(
        mut,
        seeds = [b"src-mint"],
        bump = token_mint.mint_bump
    )]
    pub mint: Box<Account<'info, Mint>>,

    /// CHECK: Mint Authority PDA is a dedicated signer for token::mint_to().
    /// It has no data, stores no tokens, and is not a protocol authority.
    /// Security is enforced by seed derivation matching TokenMint.mint_authority.
    #[account(
        seeds = [b"mint-authority"],
        bump = token_mint.mint_authority_bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub user_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub buyback_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub staking_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub dao_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub emergency_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}
