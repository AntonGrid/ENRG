use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::ErrorCode;
use crate::instructions::policy_engine::{MintPreambleInput, MintRewardInput, PolicyEngine};
use crate::math::calculate_reward_dynamic;
use crate::security::verify_ed25519_signature;
use crate::security::validation::verify_nonce;
use crate::state::*;

/// Mint SRC tokens based on verified Oracle report.
///
/// Verifies the device Ed25519 signature before minting.
/// Device metadata (max_power_w) and sliding energy window
/// are managed by enrg-profile via CPI — this instruction
/// calls profile::record_production() after minting.
///
/// ADR-0003: the Verifier and the Policy Engine are separated. This instruction
/// is the Verifier: it checks the device and oracle Ed25519 signatures, the
/// nonce, and the device_id binding, then EXECUTES the Policy Engine decision
/// (`instructions::policy_engine` / PolicyRegistry, PDA `[b"policy-registry"]`).
/// All proof-admissibility decisions — oracle whitelist (C-0), device state
/// (ADR-0005), freshness, tier limits (v7.0 §15), energy per proof, supply cap,
/// and the mint pause — are made in the PolicyEngine, not here.
///
/// Backward compatibility: if the PolicyRegistry is not initialized
/// (policy_registry = None), the protocol default policies apply — behavior
/// identical to the pre-Policy Engine version; existing devices and the
/// oracle keep working unchanged.
pub fn mint_energy(ctx: Context<MintEnergy>, report: OracleReport) -> Result<()> {
    let producer = &mut ctx.accounts.producer;
    let vault = &mut ctx.accounts.vault;

    // ── Clock: used for freshness and the tier window ──
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // ── Normalize the monthly window (ADR-0005) ──
    producer.roll_month(now);

    // ADR-0007: a revoked device can NEVER mint — a hard protocol invariant
    // (not disabled by policy; policy manages the remaining device-state gating).
    require!(!producer.revoked, ErrorCode::DeviceRevoked);

    // ══ C-1: the report must belong to this exact device ══
    require!(
        producer.device_id == report.device_id,
        ErrorCode::DeviceMismatch
    );

    // ══ C-2: transaction signer — device owner OR the report oracle ══
    // (multi-owner mint: any trusted oracle from the OracleRegistry may
    //  initiate a mint on behalf of the device without being its owner;
    //  Policy Engine checks report.oracle membership in OracleRegistry — C-0).
    require!(
        mint_submitter_authorized(
            &producer.authority,
            &ctx.accounts.authority.key(),
            &report.oracle,
        ),
        ErrorCode::NotProducerOwner
    );

    // ── Ed25519 signature verification (device) ──
    // The device signs (device_id, nonce, device_timestamp, energy_wh).
    let device_message = report.device_message_to_sign()?;

    verify_ed25519_signature(
        &report.device_signature,
        &report.device_id.to_bytes(),
        &device_message,
        &ctx.accounts.instructions.to_account_info(),
    )?;

    // ── Oracle signature verification (authenticity of the report) ──
    // The oracle signs (device_id, nonce, device_timestamp, verified_at, energy_wh).
    // Without this signature, any caller could impersonate a trusted oracle
    // by simply putting its pubkey in the report.oracle field.
    let oracle_message = report.oracle_message_to_sign()?;

    verify_ed25519_signature(
        &report.oracle_signature,
        &report.oracle.to_bytes(),
        &oracle_message,
        &ctx.accounts.instructions.to_account_info(),
    )?;

    // ── Proof validation: nonce (verifier) ──
    verify_nonce(producer, report.nonce)?;

    // ══ C-Q: oracle quorum gate (P3-6) ══
    // When the quorum config exists and requires it, the report must be
    // backed by a FINALIZED attestation for (device_id, nonce) whose
    // proof_hash equals SHA-256 of the oracle message. With a single trusted
    // oracle (or no config) the legacy flow is preserved.
    if let Some(cfg) = &ctx.accounts.oracle_quorum_config {
        if cfg.required {
            let att = ctx
                .accounts
                .attestation
                .as_ref()
                .ok_or(ErrorCode::AttestationRequired)?;
            require!(att.finalized, ErrorCode::AttestationNotFinalized);
            require!(att.device_id == report.device_id, ErrorCode::DeviceMismatch);
            require!(att.nonce == report.nonce, ErrorCode::InvalidNonce);
            let (canonical, _) = Pubkey::find_program_address(
                &[
                    b"oracle-attest".as_ref(),
                    report.device_id.as_ref(),
                    report.nonce.to_le_bytes().as_ref(),
                ],
                ctx.program_id,
            );
            require!(att.key() == canonical, ErrorCode::InvalidParameter);
            require!(
                att.proof_hash == report.proof_hash()?,
                ErrorCode::AttestationHashMismatch
            );
        }
    }

    // ══ Policy Engine (ADR-0003): all proof-admissibility decisions ══
    // The Verifier (this instruction) makes no decisions — it executes the
    // policies from PolicyRegistry (or protocol defaults if the registry is not initialized).
    PolicyEngine::evaluate_preamble(MintPreambleInput {
        policy: ctx.accounts.policy_registry.as_ref().map(|a| &**a),
        producer: &*producer,
        report: &report,
        oracle_trusted: ctx.accounts.oracle_registry.contains(&report.oracle),
        profile_rated_power: ctx.accounts.profile.rated_power,
        now,
    })?;

    // ── Update network sliding window ──
    let now_ts = clock.unix_timestamp;
    vault.network_energy_30d = crate::math::update_energy_window_u128(
        vault.network_energy_30d,
        vault.network_energy_updated_at,
        now_ts,
        report.energy_wh as u128,
    );
    vault.network_energy_updated_at = now_ts;

    // ── CPI: record_production into enrg-profile ──
    let profile_ctx = CpiContext::new(
        ctx.accounts.profile_program.to_account_info(),
        crate::enrg_profile::cpi::accounts::RecordProduction {
            authority: ctx.accounts.authority.to_account_info(),
            profile: ctx.accounts.profile.to_account_info(),
        },
    );
    crate::enrg_profile::cpi::record_production(profile_ctx, report.energy_wh, now_ts)?;

    // ── Update producer state ──
    producer.nonce = report.nonce;
    producer.timestamp = report.verified_at;
    producer.energy_wh = producer
        .energy_wh
        .checked_add(report.energy_wh)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    producer.month_energy_wh = producer
        .month_energy_wh
        .checked_add(report.energy_wh)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // ── Calculate reward with dynamic difficulty ──
    let device_energy_30d = ctx.accounts.profile.device_energy_30d as u64;
    let reward = calculate_reward_dynamic(
        report.energy_wh,
        vault.total_supply,
        device_energy_30d,
        vault.network_energy_30d,
    );
    msg!(
        "DEBUG reward={} energy_wh={} total_supply={} device_30d={} network_30d={}",
        reward,
        report.energy_wh,
        vault.total_supply,
        device_energy_30d,
        vault.network_energy_30d,
    );

    // ══ Policy Engine (ADR-0003): reward > 0 and supply cap ══
    // The PolicyEngine decides the reward admissibility and the emission cap.
    PolicyEngine::evaluate_reward(MintRewardInput {
        policy: ctx.accounts.policy_registry.as_ref().map(|a| &**a),
        reward,
        vault_total_supply: vault.total_supply,
        vault_max_supply: vault.max_supply,
    })?;

    // ── Check supply cap (final value for the vault update) ──
    let new_supply = vault
        .total_supply
        .checked_add(reward)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

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
    let token_program = ctx.accounts.token_program.to_account_info();

    token::mint_to(
        CpiContext::new(
            token_program.clone(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        user_amount,
    )?;

    token::mint_to(
        CpiContext::new(
            token_program.clone(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.buyback_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        buyback_amount,
    )?;

    token::mint_to(
        CpiContext::new(
            token_program.clone(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.staking_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        staking_amount,
    )?;

    token::mint_to(
        CpiContext::new(
            token_program.clone(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.dao_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
        )
        .with_signer(signer_seeds),
        dao_amount,
    )?;

    token::mint_to(
        CpiContext::new(
            token_program.clone(),
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
        .and_then(|v| v.checked_div(MAX_SUPPLY_ATOMIC as u128))
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

    // ── ERS (v7.0 §16): update the reputation if the account is provided ──
    if let Some(reputation) = &mut ctx.accounts.reputation {
        crate::instructions::reputation::update_reputation_after_mint(
            reputation,
            report.energy_wh,
            now,
        )?;
        emit!(ReputationUpdated {
            reputation: reputation.key(),
            score: reputation.score,
            total_energy_wh: reputation.total_energy_wh,
        });
    }

    // ── Pool contribution (v7.0 §14): contribute to the pool if the producer is a member ──
    match (&mut ctx.accounts.pool, &mut ctx.accounts.pool_share) {
        (Some(pool), Some(pool_share)) => {
            require!(pool_share.pool == pool.key(), ErrorCode::InvalidParameter);
            require!(pool_share.producer == producer.key(), ErrorCode::InvalidParameter);
            require!(pool.producers.contains(&producer.key()), ErrorCode::NotInPool);
            let (canonical, _) = Pubkey::find_program_address(
                &[b"pool-share", pool.key().as_ref(), producer.key().as_ref()],
                ctx.program_id,
            );
            require!(pool_share.key() == canonical, ErrorCode::InvalidParameter);

            let energy = report.energy_wh as u128;
            pool.total_energy = pool
                .total_energy
                .checked_add(energy)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            pool_share.energy_wh = pool_share
                .energy_wh
                .checked_add(energy)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            pool_share.updated_at = now;

            emit!(PoolEnergyRecorded {
                pool: pool.key(),
                producer: producer.key(),
                energy_wh: energy,
                total_energy: pool.total_energy,
            });

            if crate::state::pool::pool_threshold_reached(pool.total_energy, pool.threshold) {
                emit!(PoolThresholdReached {
                    pool: pool.key(),
                    total_energy: pool.total_energy,
                    threshold: pool.threshold,
                });
            }
        }
        (None, None) => {}
        _ => return Err(ErrorCode::InvalidParameter.into()),
    }

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
        bump = token_mint.mint_bump,
        constraint = mint.key() == token_mint.mint @ ErrorCode::InvalidParameter
    )]
    pub mint: Box<Account<'info, Mint>>,

    /// CHECK: Mint Authority PDA is a dedicated signer for token::mint_to().
    #[account(
        seeds = [b"mint-authority"],
        bump = token_mint.mint_authority_bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// Multi-owner mint: the reward goes to the DEVICE OWNER
    /// (producer.authority), not to the transaction signer (oracle).
    /// The user token account must belong to producer.authority.
    #[account(
        mut,
        constraint = user_token_account.owner == producer.authority @ ErrorCode::UnauthorizedTokenAccountOwner,
    )]
    pub user_token_account: Box<Account<'info, TokenAccount>>,

    /// Protocol buyback fund — strictly bound to the TokenMint configuration.
    #[account(
        mut,
        constraint = buyback_account.key() == token_mint.buyback_account @ ErrorCode::InvalidParameter
    )]
    pub buyback_account: Box<Account<'info, TokenAccount>>,

    /// Protocol staking fund — strictly bound to the TokenMint configuration.
    #[account(
        mut,
        constraint = staking_account.key() == token_mint.staking_account @ ErrorCode::InvalidParameter
    )]
    pub staking_account: Box<Account<'info, TokenAccount>>,

    /// Protocol DAO fund — strictly bound to the TokenMint configuration.
    #[account(
        mut,
        constraint = dao_account.key() == token_mint.dao_account @ ErrorCode::InvalidParameter
    )]
    pub dao_account: Box<Account<'info, TokenAccount>>,

    /// Protocol emergency fund — strictly bound to the TokenMint configuration.
    #[account(
        mut,
        constraint = emergency_account.key() == token_mint.emergency_account @ ErrorCode::InvalidParameter
    )]
    pub emergency_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: Sysvar instructions — used for Ed25519 signature verification.
    #[account(
        constraint = instructions.key() == crate::constants::INSTRUCTIONS_SYSVAR_ID @ ErrorCode::InvalidInstructionsAccount
    )]
    pub instructions: UncheckedAccount<'info>,

    /// Trusted Oracle Registry (whitelist of oracles, ADR-0003 / ADR-0006).
    #[account(
        seeds = [b"oracle-registry"],
        bump
    )]
    pub oracle_registry: Account<'info, OracleRegistry>,

    pub token_program: Program<'info, Token>,

    // ── CPI: enrg-profile ──
    /// CHECK: on-chain enrg-profile program (the only allowed CPI target).
    #[account(
        constraint = profile_program.key() == crate::constants::ENRG_PROFILE_PROGRAM_ID @ ErrorCode::InvalidParameter
    )]
    pub profile_program: UncheckedAccount<'info>,

    /// Transaction signer: the device owner OR a trusted oracle from the
    /// report (multi-owner mint). It does not receive the reward itself —
    /// the reward goes to producer.authority (see user_token_account).
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"profile", producer.authority.as_ref()],
        bump,
        seeds::program = profile_program.key()
    )]
    pub profile: Account<'info, crate::enrg_profile::accounts::EnergyProfile>,

    /// ERS (v7.0 §16) — optional: if provided, updated after the mint.
    /// Bound to the device owner (producer.authority).
    #[account(
        mut,
        seeds = [b"reputation", producer.authority.as_ref()],
        bump = reputation.bump
    )]
    pub reputation: Option<Account<'info, Reputation>>,

    /// Pool (v7.0 §14) — optional: if the producer is a member,
    /// the contribution is recorded in pool.total_energy and pool_share.energy_wh.
    #[account(mut)]
    pub pool: Option<Account<'info, Pool>>,

    /// Pool member contribution (PDA [b"pool-share", pool, producer]).
    #[account(mut)]
    pub pool_share: Option<Account<'info, PoolContribution>>,

    /// Policy Registry (ADR-0003): addressable mint policies. Optional —
    /// if the PDA [b"policy-registry"] is not initialized, the protocol
    /// default policies apply (full backward compatibility with existing
    /// deployments and devices).
    #[account(
        seeds = [b"policy-registry"],
        bump
    )]
    pub policy_registry: Option<Account<'info, PolicyRegistry>>,

    /// Oracle quorum config (P3-6) — optional. When initialized with
    /// required=true, the report must carry a FINALIZED attestation with a
    /// matching proof hash. Not initialized → the legacy single-oracle flow.
    #[account(
        seeds = [b"oracle-quorum-config"],
        bump
    )]
    pub oracle_quorum_config: Option<Account<'info, OracleQuorumConfig>>,

    /// The finalized attestation for (report.device_id, report.nonce) —
    /// required when the quorum config has `required = true`.
    /// CHECK: address is re-derived in the gate (PDA seeds check).
    pub attestation: Option<Account<'info, OracleAttestation>>,
}

/// Whether the transaction signer (submitter) may initiate a mint for the device:
/// either the device owner (producer.authority) or the oracle that signed the
/// report (report.oracle == submitter). report.oracle membership in the
/// OracleRegistry is checked separately (C-0) — here only the "who signs" binding.
pub fn mint_submitter_authorized(
    producer_authority: &Pubkey,
    submitter: &Pubkey,
    report_oracle: &Pubkey,
) -> bool {
    producer_authority == submitter || report_oracle == submitter
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    #[test]
    fn owner_can_submit() {
        let owner = pk(1);
        let oracle = pk(2);
        assert!(
            mint_submitter_authorized(&owner, &owner, &oracle),
            "the device owner may initiate a mint"
        );
    }

    #[test]
    fn registered_oracle_can_submit() {
        let owner = pk(1);
        let oracle = pk(2);
        assert!(
            mint_submitter_authorized(&owner, &oracle, &oracle),
            "the report oracle may initiate a mint (multi-owner flow)"
        );
    }

    #[test]
    fn stranger_cannot_submit() {
        let owner = pk(1);
        let oracle = pk(2);
        let stranger = pk(3);
        assert!(
            !mint_submitter_authorized(&owner, &stranger, &oracle),
            "a stranger cannot initiate a mint"
        );
    }

    #[test]
    fn owner_fabricating_report_still_owner_but_oracle_not_in_registry() {
        // The owner may sign the transaction (authorized=true), BUT if they
        // set themselves as report.oracle and are not in the OracleRegistry —
        // C-0 (UntrustedOracle) rejects it. This is covered by integration tests.
        let owner = pk(1);
        assert!(
            mint_submitter_authorized(&owner, &owner, &owner),
            "the owner is always authorized at C-2; C-0 provides the block"
        );
    }
}

