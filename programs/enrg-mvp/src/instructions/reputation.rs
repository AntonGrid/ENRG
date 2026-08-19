use anchor_lang::prelude::*;

use crate::constants::ERS_MAX_SCORE;
use crate::error::ErrorCode;
use crate::state::*;

/// Initialize the Reputation PDA (v7.0 §16 — Energy Reputation Score).
#[derive(Accounts)]
pub struct InitializeReputation<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Reputation::INIT_SPACE,
        seeds = [b"reputation", authority.key().as_ref()],
        bump
    )]
    pub reputation: Account<'info, Reputation>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_reputation(ctx: Context<InitializeReputation>) -> Result<()> {
    let reputation = &mut ctx.accounts.reputation;
    let now = Clock::get()?.unix_timestamp;

    reputation.authority = ctx.accounts.authority.key();
    reputation.score = crate::state::reputation::ERS_BASE_SCORE;
    reputation.updated_at = now;
    reputation.total_energy_wh = 0;
    reputation.first_seen = now;
    reputation.anomaly_count = 0;
    reputation.percentile = 20; // starting percentile (approximation)
    reputation.bump = ctx.bumps.reputation;

    Ok(())
}

/// Record a generation profile anomaly (v7.0 §27).
///
/// Signed by a trusted oracle (OracleRegistry). An anomaly (for example,
/// constant power at night) lowers ERS and increments anomaly_count.
#[derive(Accounts)]
pub struct ReportAnomaly<'info> {
    #[account(
        mut,
        seeds = [b"reputation", reputation.authority.as_ref()],
        bump = reputation.bump
    )]
    pub reputation: Account<'info, Reputation>,

    #[account(
        seeds = [b"oracle-registry"],
        bump,
        constraint = oracle_registry.contains(&oracle.key()) @ ErrorCode::UntrustedOracle
    )]
    pub oracle_registry: Account<'info, OracleRegistry>,

    pub oracle: Signer<'info>,
}

pub fn report_anomaly(ctx: Context<ReportAnomaly>, severity: u8) -> Result<()> {
    require!(severity >= 1 && severity <= 10, ErrorCode::InvalidParameter);

    let reputation = &mut ctx.accounts.reputation;
    reputation.score = crate::state::reputation::apply_anomaly_penalty(reputation.score, severity);
    reputation.anomaly_count = reputation
        .anomaly_count
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    reputation.updated_at = Clock::get()?.unix_timestamp;

    emit!(AnomalyReported {
        reputation: reputation.key(),
        score_after: reputation.score,
        severity,
    });

    Ok(())
}

/// Premium access to ENRG Market (v7.0 §16, §30) — interface stub.
/// Returns `true` if ERS >= ERS_PREMIUM_THRESHOLD.
#[derive(Accounts)]
pub struct ErsPremiumAccess<'info> {
    #[account(
        seeds = [b"reputation", reputation.authority.as_ref()],
        bump = reputation.bump
    )]
    pub reputation: Account<'info, Reputation>,
}

pub fn ers_premium_access(ctx: Context<ErsPremiumAccess>) -> Result<bool> {
    let score = ctx.accounts.reputation.score;
    Ok(crate::state::reputation::ers_premium_eligible(score))
}

/// Update ERS after a successful mint (called from mint_energy).
/// Pure logic lives in state/reputation.rs; here — the account write.
pub fn update_reputation_after_mint(
    reputation: &mut Account<Reputation>,
    energy_wh: u64,
    now: i64,
) -> Result<()> {
    reputation.total_energy_wh = reputation
        .total_energy_wh
        .checked_add(energy_wh)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let uptime = now.saturating_sub(reputation.first_seen);
    let new_score = crate::state::reputation::compute_ers_score(reputation.total_energy_wh, uptime);
    // Penalties persist: the score cannot grow above without anomalies returning
    // automatically — we take max(new, current) only when there are no anomalies;
    // otherwise growth is limited by the reduced level. MVP: score = max(score, new)
    // when there are no anomalies; with anomalies the score grows only up to the
    // pre-penalty maximum.
    if reputation.anomaly_count == 0 {
        reputation.score = new_score;
    } else {
        // With anomalies: growth is slowed — half of the increment to the current value.
        let cap = new_score.min(ERS_MAX_SCORE);
        let target = reputation
            .score
            .saturating_add(cap.saturating_sub(reputation.score) / 2);
        reputation.score = target.min(ERS_MAX_SCORE);
    }
    reputation.percentile = ((reputation.score / 10).min(100)) as u8;
    reputation.updated_at = now;

    Ok(())
}
