use anchor_lang::prelude::*;

pub mod adapters;
pub mod constants;
pub mod error;
pub mod instructions;
pub mod math;
pub mod security;
pub mod state;

use instructions::*;
use state::producer::DeviceTier;

declare_id!("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");

// Declare enrg-profile program for CPI access.
// IDL is loaded from <workspace-root>/idls/enrg_profile.json
declare_program!(enrg_profile);

#[program]
pub mod enrg_mvp {
    use super::*;

    // ═══════════════════════════════════════════
    //  PHASE 1 — Protocol Initialization
    // ═══════════════════════════════════════════

    pub fn initialize_token(
        ctx: Context<InitializeToken>,
    ) -> Result<()> {
        instructions::initialize_token::initialize_token(ctx)
    }

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
    ) -> Result<()> {
        instructions::initialize::initialize_vault(ctx)
    }

    pub fn initialize_funds(
        ctx: Context<InitializeFunds>,
    ) -> Result<()> {
        instructions::initialize::initialize_funds(ctx)
    }

    /// Change Vault.authority (protocol admin / temporary governor).
    pub fn set_vault_authority(
        ctx: Context<SetVaultAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::initialize::set_vault_authority(ctx, new_authority)
    }

    pub fn init_config(
        ctx: Context<InitConfig>,
        oracle: Pubkey,
        mint: Pubkey,
    ) -> Result<()> {
        instructions::init_config::init_config(ctx, oracle, mint)
    }

    pub fn initialize_oracle_registry(
        ctx: Context<InitializeOracleRegistry>,
    ) -> Result<()> {
        instructions::oracle_registry::initialize_oracle_registry(ctx)
    }

    pub fn initialize_manifest_registry(
        ctx: Context<InitializeManifestRegistry>,
    ) -> Result<()> {
        instructions::manifest_registry::initialize_manifest_registry(ctx)
    }

    pub fn update_merkle_root(
        ctx: Context<UpdateMerkleRoot>,
        new_root: [u8; 32],
        manifest_count: u64,
    ) -> Result<()> {
        instructions::manifest_registry::update_merkle_root(ctx, new_root, manifest_count)
    }

    pub fn set_oracle_authority(
        ctx: Context<SetOracleAuthority>,
        new_oracle: Pubkey,
    ) -> Result<()> {
        instructions::manifest_registry::set_oracle_authority(ctx, new_oracle)
    }

    pub fn register_manifest_verification(
        ctx: Context<RegisterManifestVerification>,
        manifest_id: [u8; 16],
        publisher_key: [u8; 32],
        content_hash: [u8; 32],
        signature: [u8; 64],
        manifest_version: u8,
    ) -> Result<()> {
        instructions::manifest_verification::register_manifest_verification(
            ctx,
            manifest_id,
            publisher_key,
            content_hash,
            signature,
            manifest_version,
        )
    }

    pub fn verify_merkle_proof(
        ctx: Context<VerifyMerkleProof>,
        manifest_id: [u8; 16],
        proof_path: Vec<[u8; 32]>,
        leaf_hash: [u8; 32],
        position: u8,
    ) -> Result<()> {
        instructions::merkle_proof_verification::verify_merkle_proof(
            ctx,
            manifest_id,
            proof_path,
            leaf_hash,
            position,
        )
    }

    // ═══════════════════════════════════════════
    //  PHASE 2 — Oracle Management
    // ═══════════════════════════════════════════

    pub fn add_oracle(
        ctx: Context<AddOracle>,
        oracle: Pubkey,
    ) -> Result<()> {
        instructions::oracle_registry::add_oracle(ctx, oracle)
    }

    pub fn remove_oracle(
        ctx: Context<RemoveOracle>,
        oracle: Pubkey,
    ) -> Result<()> {
        instructions::oracle_registry::remove_oracle(ctx, oracle)
    }

    /// Change oracle_admin (manage the oracle list). Protocol admin only.
    pub fn set_oracle_admin(
        ctx: Context<SetOracleAdmin>,
        new_oracle_admin: Pubkey,
    ) -> Result<()> {
        instructions::oracle_registry::set_oracle_admin(ctx, new_oracle_admin)
    }

    // ═══════════════════════════════════════════
    //  PHASE 3 — Policy Engine (ADR-0003)
    // ═══════════════════════════════════════════

    /// Initialize the Policy Registry (PDA [b"policy-registry"]).
    /// EXPECTED_DEPLOYER only. Defaults = pre-Policy Engine protocol behavior.
    pub fn initialize_policy_registry(
        ctx: Context<InitializePolicyRegistry>,
    ) -> Result<()> {
        instructions::policy_engine::initialize_policy_registry(ctx)
    }

    /// Update the policy set (registry authority).
    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        update: PolicyUpdate,
    ) -> Result<()> {
        instructions::policy_engine::update_policy(ctx, update)
    }

    /// Change the policy administrator (role may later go to Governance ADR-0009).
    pub fn set_policy_authority(
        ctx: Context<SetPolicyAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::policy_engine::set_policy_authority(ctx, new_authority)
    }

    // ═══════════════════════════════════════════
    //  PHASE 4 — Energy Minting
    // ═══════════════════════════════════════════

    pub fn mint_energy(
        ctx: Context<MintEnergy>,
        report: state::OracleReport,
    ) -> Result<()> {
        instructions::mint::mint_energy(ctx, report)
    }

    // ═══════════════════════════════════════════
    //  PHASE 5 — Pool Management
    // ═══════════════════════════════════════════

    pub fn create_pool(
        ctx: Context<CreatePool>,
        threshold: u64,
    ) -> Result<()> {
        instructions::pool::create_pool(ctx, threshold)
    }

    pub fn join_pool(
        ctx: Context<JoinPool>,
    ) -> Result<()> {
        instructions::pool::join_pool(ctx)
    }

    /// Proportional pool distribution when the threshold is reached (v7.0 §14).
    pub fn distribute_pool<'info>(
        ctx: Context<'_, '_, 'info, 'info, DistributePool<'info>>,
    ) -> Result<()> {
        instructions::pool::distribute_pool(ctx)
    }

    // ═══════════════════════════════════════════
    //  PHASE 6 — Staking & Rewards
    // ═══════════════════════════════════════════

    pub fn stake(
        ctx: Context<Stake>,
        amount: u64,
    ) -> Result<()> {
        instructions::staking::stake(ctx, amount)
    }

    pub fn unstake(
        ctx: Context<Unstake>,
        amount: u64,
    ) -> Result<()> {
        instructions::staking::unstake(ctx, amount)
    }

    pub fn claim_rewards(
        ctx: Context<ClaimRewards>,
    ) -> Result<()> {
        instructions::staking::claim_rewards(ctx)
    }

    // ═══════════════════════════════════════════
    //  PHASE 7 — Founder Vesting
    // ═══════════════════════════════════════════

    pub fn initialize_founder_vesting(
        ctx: Context<InitializeFounderVesting>,
    ) -> Result<()> {
        instructions::vesting::initialize_founder_vesting(ctx)
    }

    pub fn claim_vested(
        ctx: Context<ClaimVested>,
    ) -> Result<()> {
        instructions::vesting::claim_vested(ctx)
    }

    // ═══════════════════════════════════════════
    //  PHASE 8 — Token Economics
    // ═══════════════════════════════════════════

    pub fn buyback_and_burn(
        ctx: Context<BuybackAndBurn>,
        amount: u64,
    ) -> Result<()> {
        instructions::buyback::buyback_and_burn(ctx, amount)
    }

    /// One-shot founder premine at launch: mint 2e17 to the founder ATA,
    /// counted in vault.total_supply with a MAX_SUPPLY_ATOMIC check.
    pub fn allocate_founder(
        ctx: Context<AllocateFounder>,
    ) -> Result<()> {
        instructions::init_founder::allocate_founder(ctx)
    }

    /// Withdraw SRC from a protocol fund (buyback/staking/dao/emergency)
    /// to the recipient ATA. Vault.authority only (temporary governor).
    pub fn withdraw_fund(
        ctx: Context<WithdrawFund>,
        fund_tag: u8,
        amount: u64,
    ) -> Result<()> {
        instructions::funds::withdraw_fund(ctx, fund_tag, amount)
    }

    // ═══════════════════════════════════════════
    //  PHASE 9 — Device Lifecycle (ADR-0005)
    // ═══════════════════════════════════════════

    pub fn register_device(
        ctx: Context<RegisterDevice>,
        device_signature: [u8; 64],
        register_timestamp: i64,
    ) -> Result<()> {
        instructions::device_lifecycle::register_device(ctx, device_signature, register_timestamp)
    }

    pub fn claim_device(
        ctx: Context<ClaimDevice>,
        device_signature: [u8; 64],
        claim_nonce: u64,
        claim_timestamp: i64,
    ) -> Result<()> {
        instructions::device_lifecycle::claim_device(
            ctx,
            device_signature,
            claim_nonce,
            claim_timestamp,
        )
    }

    pub fn init_energy_profile(
        ctx: Context<InitEnergyProfile>,
    ) -> Result<()> {
        instructions::device_lifecycle::init_energy_profile(ctx)
    }

    pub fn provision_device(
        ctx: Context<ProvisionDevice>,
    ) -> Result<()> {
        instructions::device_lifecycle::provision_device(ctx)
    }

    pub fn activate_device(
        ctx: Context<ActivateDevice>,
    ) -> Result<()> {
        instructions::device_lifecycle::activate_device(ctx)
    }

    pub fn quarantine_device(
        ctx: Context<QuarantineDevice>,
    ) -> Result<()> {
        instructions::device_lifecycle::quarantine_device(ctx)
    }

    pub fn maintenance_device(
        ctx: Context<MaintenanceDevice>,
    ) -> Result<()> {
        instructions::device_lifecycle::maintenance_device(ctx)
    }

    pub fn release_from_quarantine(
        ctx: Context<ReleaseFromQuarantine>,
    ) -> Result<()> {
        instructions::device_lifecycle::release_from_quarantine(ctx)
    }

    pub fn revoke_device(
        ctx: Context<RevokeDevice>,
    ) -> Result<()> {
        instructions::device_lifecycle::revoke_device(ctx)
    }

    /// Device key rotation (ADR-0007): owner/admin changes the device_id.
    /// The new key MUST sign b"enrg:device:rotate" || ... (PoP).
    pub fn rotate_device_key(
        ctx: Context<RotateDeviceKey>,
        new_device_id: Pubkey,
        device_signature: [u8; 64],
        rotate_nonce: u64,
        rotate_timestamp: i64,
    ) -> Result<()> {
        instructions::device_lifecycle::rotate_device_key(
            ctx,
            new_device_id,
            device_signature,
            rotate_nonce,
            rotate_timestamp,
        )
    }

    /// Assign/change the device tier (v7.0 §15 — Trust Levels).
    pub fn set_device_tier(
        ctx: Context<SetDeviceTier>,
        tier: DeviceTier,
    ) -> Result<()> {
        instructions::tier::set_device_tier(ctx, tier)
    }

    /// Initialize the Reputation PDA (v7.0 §16 — Energy Reputation Score).
    pub fn initialize_reputation(
        ctx: Context<InitializeReputation>,
    ) -> Result<()> {
        instructions::reputation::initialize_reputation(ctx)
    }

    /// Record a generation profile anomaly by a trusted oracle (v7.0 §27).
    pub fn report_anomaly(
        ctx: Context<ReportAnomaly>,
        severity: u8,
    ) -> Result<()> {
        instructions::reputation::report_anomaly(ctx, severity)
    }

    /// Premium access to ENRG Market by ERS (v7.0 §16, §30).
    pub fn ers_premium_access(
        ctx: Context<ErsPremiumAccess>,
    ) -> Result<bool> {
        instructions::reputation::ers_premium_access(ctx)
    }

    // ═══════════════════════════════════════════
    //  PHASE 10 — Governance MVP (ADR-0009)
    // ═══════════════════════════════════════════

    pub fn initialize_governance(
        ctx: Context<InitializeGovernance>,
        members: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::governance::initialize_governance(ctx, members)
    }

    pub fn update_members(
        ctx: Context<UpdateMembers>,
        members: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::governance::update_members(ctx, members)
    }

    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        id: u64,
        title: String,
        amount_atomic: u64,
        destination: Pubkey,
    ) -> Result<()> {
        instructions::governance::create_proposal(ctx, id, title, amount_atomic, destination)
    }

    pub fn vote(
        ctx: Context<Vote>,
        proposal_id: u64,
        yes: bool,
    ) -> Result<()> {
        instructions::governance::vote(ctx, proposal_id, yes)
    }

    pub fn governance_mint(
        ctx: Context<GovernanceMint>,
        proposal_id: u64,
    ) -> Result<()> {
        instructions::governance::governance_mint(ctx, proposal_id)
    }

    // ═══════════════════════════════════════════════
    //  PHASE 11 — Proof-of-Intelligence (ADR-0010)
    // ═══════════════════════════════════════════════

    /// Commit a federated contribution digest on-chain (PDA
    /// [b"poi-commit", round, device_id]). The device Ed25519-signs
    /// b"enrg:poi:commit" || round || device_id || digest.
    pub fn commit_contribution(
        ctx: Context<CommitContribution>,
        round: u64,
        digest: [u8; 32],
        signature: [u8; 64],
    ) -> Result<()> {
        instructions::poi_commitment::commit_contribution(ctx, round, digest, signature)
    }

    // ═══════════════════════════════════════════════
    //  PHASE 12 — Oracle Quorum (P3-6, ADR-0010)
    // ═══════════════════════════════════════════════

    /// A trusted oracle votes on a proof attestation (PDA
    /// [b"oracle-attest", device_id, nonce]); ≥ threshold votes finalize it.
    pub fn submit_oracle_attestation(
        ctx: Context<SubmitOracleAttestation>,
        nonce: u64,
        proof_hash: [u8; 32],
        signature: [u8; 64],
    ) -> Result<()> {
        instructions::oracle_quorum::submit_oracle_attestation(ctx, nonce, proof_hash, signature)
    }

    /// Deposit lamports as the oracle reputation stake (votes require it).
    pub fn stake_oracle(ctx: Context<StakeOracle>, lamports: u64) -> Result<()> {
        instructions::oracle_quorum::stake_oracle(ctx, lamports)
    }

    /// Slash an oracle deposit for a contradictory report (governance).
    pub fn slash_oracle(ctx: Context<SlashOracle>) -> Result<()> {
        instructions::oracle_quorum::slash_oracle(ctx)
    }
}
