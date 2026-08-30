use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::error::ErrorCode;
use crate::security::verify_ed25519_signature;
use crate::state::{
    oracle_attest_message, OracleAttestation, OracleQuorumConfig, OracleRegistry, OracleStake,
    OracleVote, TokenMint, ORACLE_ATTESTATION_THRESHOLD,
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

    /// Quorum config — optional; when present its `threshold` overrides the
    /// default ORACLE_ATTESTATION_THRESHOLD.
    #[account(
        seeds = [b"oracle-quorum-config"],
        bump
    )]
    pub oracle_quorum_config: Option<Account<'info, OracleQuorumConfig>>,

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
    let threshold = ctx
        .accounts
        .oracle_quorum_config
        .as_ref()
        .map(|c| c.threshold)
        .unwrap_or(ORACLE_ATTESTATION_THRESHOLD);
    if attestation.votes >= threshold {
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

/// Initialize the oracle quorum config (P3-6 phase 2). The PDA
/// `[b"oracle-quorum-config"]` gates `mint_energy`: when `required` is set,
/// every mint must present a FINALIZED attestation. Only the OracleRegistry
/// authority may create it.
#[derive(Accounts)]
pub struct InitOracleQuorum<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + OracleQuorumConfig::INIT_SPACE,
        seeds = [b"oracle-quorum-config"],
        bump
    )]
    pub oracle_quorum_config: Account<'info, OracleQuorumConfig>,

    #[account(
        seeds = [b"oracle-registry"],
        bump,
        constraint = oracle_registry.authority == authority.key() @ ErrorCode::NotOracleAuthority
    )]
    pub oracle_registry: Account<'info, OracleRegistry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn init_oracle_quorum(
    ctx: Context<InitOracleQuorum>,
    required: bool,
    threshold: u8,
    reward_per_vote: u64,
) -> Result<()> {
    require!(
        threshold >= 2 && threshold <= OracleRegistry::MAX_ORACLES as u8,
        ErrorCode::InvalidQuorumThreshold
    );
    let cfg = &mut ctx.accounts.oracle_quorum_config;
    cfg.authority = ctx.accounts.authority.key();
    cfg.required = required;
    cfg.threshold = threshold;
    cfg.reward_per_vote = reward_per_vote;
    msg!(
        "Oracle quorum config: required={} threshold={} reward_per_vote={}",
        cfg.required,
        cfg.threshold,
        cfg.reward_per_vote
    );
    Ok(())
}

/// Update the quorum config (required / threshold / reward).
#[derive(Accounts)]
pub struct SetOracleQuorum<'info> {
    #[account(
        mut,
        seeds = [b"oracle-quorum-config"],
        bump,
        constraint = oracle_quorum_config.authority == authority.key() @ ErrorCode::NotQuorumAuthority
    )]
    pub oracle_quorum_config: Account<'info, OracleQuorumConfig>,

    pub authority: Signer<'info>,
}

pub fn set_oracle_quorum(
    ctx: Context<SetOracleQuorum>,
    required: bool,
    threshold: u8,
    reward_per_vote: u64,
) -> Result<()> {
    require!(
        threshold >= 2 && threshold <= OracleRegistry::MAX_ORACLES as u8,
        ErrorCode::InvalidQuorumThreshold
    );
    let cfg = &mut ctx.accounts.oracle_quorum_config;
    cfg.required = required;
    cfg.threshold = threshold;
    cfg.reward_per_vote = reward_per_vote;
    Ok(())
}

/// Claim the SRC reward for a vote in a FINALIZED attestation. The tokens are
/// transferred from the protocol staking fund (owned by the Vault PDA) to the
/// oracle's token account.
#[derive(Accounts)]
pub struct ClaimOracleReward<'info> {
    /// The vote PDA [b"oracle-vote", attestation, oracle].
    #[account(
        seeds = [b"oracle-vote", attestation.key().as_ref(), oracle_signer.key().as_ref()],
        bump
    )]
    pub oracle_vote: Account<'info, OracleVote>,

    /// The attestation the vote belongs to (read-only).
    /// CHECK: address is bound into the vote PDA seeds; finalized checked in logic.
    pub attestation: Account<'info, OracleAttestation>,

    #[account(
        seeds = [b"oracle-quorum-config"],
        bump
    )]
    pub oracle_quorum_config: Account<'info, OracleQuorumConfig>,

    pub oracle_signer: Signer<'info>,

    #[account(
        seeds = [b"token-mint"],
        bump = token_mint.bump
    )]
    pub token_mint: Account<'info, TokenMint>,

    #[account(
        mut,
        constraint = staking_account.key() == token_mint.staking_account @ ErrorCode::InvalidParameter,
        constraint = staking_account.mint == mint.key() @ ErrorCode::InvalidParameter
    )]
    pub staking_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = oracle_ata.mint == mint.key() @ ErrorCode::InvalidParameter,
        constraint = oracle_ata.owner == oracle_signer.key() @ ErrorCode::UnauthorizedTokenAccountOwner
    )]
    pub oracle_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        seeds = [b"src-mint"],
        bump = token_mint.mint_bump,
        constraint = mint.key() == token_mint.mint @ ErrorCode::InvalidParameter
    )]
    pub mint: Box<Account<'info, Mint>>,

    /// CHECK: Vault PDA — signs the staking-fund transfer via its seeds.
    #[account(seeds = [b"vault"], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn claim_oracle_reward(ctx: Context<ClaimOracleReward>) -> Result<()> {
    let vote = &mut ctx.accounts.oracle_vote;
    require!(vote.attestation == ctx.accounts.attestation.key(), ErrorCode::InvalidParameter);
    require!(ctx.accounts.attestation.finalized, ErrorCode::AttestationNotFinalized);
    require!(!vote.reward_claimed, ErrorCode::AlreadyClaimed);

    let reward = ctx.accounts.oracle_quorum_config.reward_per_vote;
    require!(reward > 0, ErrorCode::NothingToClaim);

    let vault_seeds: &[&[u8]] = &[b"vault".as_ref(), &[ctx.bumps.vault_authority]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.staking_account.to_account_info(),
                to: ctx.accounts.oracle_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[vault_seeds],
        ),
        reward,
    )?;

    vote.reward_claimed = true;
    msg!(
        "Oracle reward: {} += {} SRC for attestation {}",
        ctx.accounts.oracle_signer.key(),
        reward,
        ctx.accounts.attestation.key()
    );
    Ok(())
}

