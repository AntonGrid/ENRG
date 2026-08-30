use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::security::verify_ed25519_signature;
use crate::state::{
    oracle_attest_message, OracleAttestation, OracleRegistry, OracleStake, OracleVote,
    ORACLE_ATTESTATION_THRESHOLD,
};

/// Submit one oracle vote on a proof attestation (P3-6).
///
/// The oracle must be a member of the on-chain OracleRegistry. It signs
/// `b"enrg:oracle:attest" || device_id || nonce || proof_hash` (Ed25519
/// precompile + sysvar). The first vote creates the attestation and fixes the
/// canonical proof_hash; later votes must match it (otherwise `conflict`).
/// When `votes >= ORACLE_ATTESTATION_THRESHOLD` the attestation is finalized.
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct SubmitOracleAttestation<'info> {
    /// Attestation PDA [b"oracle-attest", device_id, nonce].
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + OracleAttestation::INIT_SPACE,
        seeds = [b"oracle-attest", device_id.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub attestation: Account<'info, OracleAttestation>,

    /// One vote per oracle (dedupe): [b"oracle-vote", attestation, oracle].
    #[account(
        init,
        payer = payer,
        space = 8 + OracleVote::INIT_SPACE,
        seeds = [b"oracle-vote", attestation.key().as_ref(), oracle.key().as_ref()],
        bump
    )]
    pub vote: Account<'info, OracleVote>,

    /// The device whose proof is confirmed (read-only, used in the signed msg).
    /// CHECK: bound into the PDA seeds and the signed message.
    pub device_id: AccountInfo<'info>,

    /// The voting oracle (must be in the registry; signs via precompile).
    /// CHECK: read-only; membership is enforced by the oracle_registry
    /// constraint and the Ed25519 precompile signature.
    pub oracle: AccountInfo<'info>,

    /// On-chain OracleRegistry — the trusted oracle set.
    #[account(
        seeds = [b"oracle-registry"],
        bump,
        constraint = oracle_registry.contains(&oracle.key()) @ ErrorCode::UntrustedOracle
    )]
    pub oracle_registry: Account<'info, OracleRegistry>,

    /// The oracle's reputation deposit must exist to count the vote.
    #[account(
        seeds = [b"oracle-stake", oracle.key().as_ref()],
        bump,
        constraint = oracle_stake.slashed == false @ ErrorCode::Unauthorized
    )]
    pub oracle_stake: Account<'info, OracleStake>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// Instructions sysvar — required for Ed25519 signature verification.
    /// CHECK: read-only sysvar; address validated in verify_ed25519_signature.
    pub instructions: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn submit_oracle_attestation(
    ctx: Context<SubmitOracleAttestation>,
    nonce: u64,
    proof_hash: [u8; 32],
    signature: [u8; 64],
) -> Result<()> {
    let device_id = ctx.accounts.device_id.key();
    require!(device_id != Pubkey::default(), ErrorCode::InvalidParameter);
    require!(!proof_hash.iter().all(|&b| b == 0), ErrorCode::InvalidLeafHash);

    let message = oracle_attest_message(&device_id, nonce, &proof_hash);
    verify_ed25519_signature(
        &signature,
        &ctx.accounts.oracle.key().to_bytes(),
        &message,
        &ctx.accounts.instructions.to_account_info(),
    )?;

    let clock = Clock::get()?;
    let attestation_key = ctx.accounts.attestation.key();
    let attestation = &mut ctx.accounts.attestation;
    let vote = &mut ctx.accounts.vote;

    vote.oracle = ctx.accounts.oracle.key();
    vote.attestation = attestation_key;
    vote.proof_hash = proof_hash;
    vote.voted_at = clock.unix_timestamp;

    if attestation.votes == 0 {
        // First vote fixes the canonical proof hash.
        attestation.device_id = device_id;
        attestation.nonce = nonce;
        attestation.proof_hash = proof_hash;
        attestation.created_at = clock.unix_timestamp;
    } else if attestation.proof_hash != proof_hash {
        // Contradictory report — record the conflict (basis for slashing).
        attestation.conflict = true;
    }

    attestation.votes = attestation.votes.saturating_add(1);
    if attestation.votes >= ORACLE_ATTESTATION_THRESHOLD {
        attestation.finalized = true;
    }

    msg!(
        "Oracle attestation: device={} nonce={} votes={} conflict={}",
        device_id,
        nonce,
        attestation.votes,
        attestation.conflict
    );
    Ok(())
}


/// Deposit lamports as the oracle reputation stake (P3-6).
#[derive(Accounts)]
pub struct StakeOracle<'info> {
    #[account(
        init_if_needed,
        payer = oracle_signer,
        space = 8 + OracleStake::INIT_SPACE,
        seeds = [b"oracle-stake", oracle_signer.key().as_ref()],
        bump
    )]
    pub oracle_stake: Account<'info, OracleStake>,

    #[account(
        seeds = [b"oracle-registry"],
        bump,
        constraint = oracle_registry.contains(&oracle_signer.key()) @ ErrorCode::UntrustedOracle
    )]
    pub oracle_registry: Account<'info, OracleRegistry>,

    #[account(mut)]
    pub oracle_signer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn stake_oracle(ctx: Context<StakeOracle>, lamports: u64) -> Result<()> {
    require!(lamports >= 1_000_000, ErrorCode::InsufficientStake); // ≥ 0.001 SOL
    let stake_info = ctx.accounts.oracle_stake.to_account_info();
    let signer_info = ctx.accounts.oracle_signer.to_account_info();
    let stake = &mut ctx.accounts.oracle_stake;
    if stake.oracle == Pubkey::default() {
        stake.oracle = ctx.accounts.oracle_signer.key();
        stake.joined_at = Clock::get()?.unix_timestamp;
    }
    stake.lamports = stake
        .lamports
        .checked_add(lamports)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: signer_info,
                to: stake_info,
            },
        ),
        lamports,
    )?;

    msg!("Oracle stake: {} += {} lamports", stake.oracle, lamports);
    Ok(())
}

/// Slash an oracle deposit for a contradictory report (governance/admin).
/// The escrowed lamports are transferred to the vault (protocol treasury).
#[derive(Accounts)]
pub struct SlashOracle<'info> {
    #[account(
        mut,
        seeds = [b"oracle-stake", oracle.key().as_ref()],
        bump,
        constraint = oracle_stake.slashed == false @ ErrorCode::Unauthorized
    )]
    pub oracle_stake: Account<'info, OracleStake>,

    /// The oracle being slashed (read-only).
    /// CHECK: bound into the stake PDA seeds; the deposit address is derived
    /// from this pubkey, so it cannot be forged.
    pub oracle: AccountInfo<'info>,

    /// Protocol vault (receives the deposit).
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: Account<'info, crate::state::vault::Vault>,

    /// Governance authority executing the slash.
    #[account(
        seeds = [b"governance"],
        bump,
        has_one = authority @ ErrorCode::NotGovernanceAuthority
    )]
    pub governance: Account<'info, crate::state::governance::GovernanceState>,

    pub authority: Signer<'info>,
}

pub fn slash_oracle(ctx: Context<SlashOracle>) -> Result<()> {
    let stake_info = ctx.accounts.oracle_stake.to_account_info();
    let vault_info = ctx.accounts.vault.to_account_info();
    let stake = &mut ctx.accounts.oracle_stake;
    let amount = stake.lamports;
    require!(amount > 0, ErrorCode::NothingToClaim);

    let oracle_key = ctx.accounts.oracle.key();
    let seeds: &[&[u8]] = &[
        b"oracle-stake".as_ref(),
        oracle_key.as_ref(),
        &[ctx.bumps.oracle_stake],
    ];
    use anchor_lang::solana_program::program::invoke_signed;
    let ix = anchor_lang::solana_program::system_instruction::transfer(
        stake_info.key,
        vault_info.key,
        amount,
    );
    invoke_signed(&ix, &[stake_info.clone(), vault_info.clone()], &[seeds])?;

    stake.lamports = 0;
    stake.slashed = true;

    msg!(
        "Oracle slashed: {} -> vault {} lamports",
        oracle_key,
        amount
    );
    Ok(())
}
