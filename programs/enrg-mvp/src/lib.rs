use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount},
};

declare_id!("CcRjGroz7tsDAroZayWak58KtfAczJ7vbPddnRJDSeL4");

#[program]
pub mod enrg_mvp {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.mint = ctx.accounts.mint.key();
        vault.authority = ctx.accounts.authority.key();
        Ok(())
    }

    pub fn create_producer(ctx: Context<CreateProducer>, device_id: Pubkey, max_power_w: u64) -> Result<()> {
        let producer = &mut ctx.accounts.producer;
        producer.authority = ctx.accounts.authority.key();
        producer.device_id = device_id;
        producer.nonce = 0;
        producer.energy_wh = 0;
        producer.timestamp = 0;
        producer.signature = [0u8; 64];
        producer.is_initialized = true;
        producer.max_power_w = max_power_w;
        msg!(
            "Producer registered: {} with device {} max_power {}W",
            producer.authority,
            device_id,
            max_power_w
        );
        Ok(())
    }

    pub fn mint_energy(ctx: Context<MintEnergy>, proof: Proof) -> Result<()> {
        let producer = &mut ctx.accounts.producer;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        require_keys_eq!(
            producer.authority,
            ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );

        require!(
            (now - proof.timestamp).abs() <= 900,
            ErrorCode::StaleProof
        );

        require!(proof.nonce > producer.nonce, ErrorCode::InvalidNonce);

        let max_energy_per_interval = producer.max_power_w
            .checked_mul(10)
            .unwrap()
            .checked_div(60)
            .unwrap();
        require!(
            proof.energy_wh <= max_energy_per_interval,
            ErrorCode::ExcessiveEnergy
        );

        // TODO: включить проверку Ed25519 подписи после решения проблем с импортом в Anchor 1.0.1
        // Пока полагаемся на проверку на уровне клиента и оракулов

        producer.nonce = proof.nonce;
        producer.timestamp = now;
        producer.energy_wh = producer.energy_wh.checked_add(proof.energy_wh).unwrap();
        producer.signature = proof.signature;

        let mint_key = ctx.accounts.mint.key();
        let vault_bump = ctx.bumps.vault;
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault",
            mint_key.as_ref(),
            &[vault_bump],
        ]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        );
        token::mint_to(cpi_ctx, proof.energy_wh)?;

        msg!(
            "Energy minted: {} Wh. Total: {} Wh. Nonce: {}",
            proof.energy_wh,
            producer.energy_wh,
            proof.nonce
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Vault::LEN,
        seeds = [b"vault", mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateProducer<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + EnergyProducer::LEN,
        seeds = [b"producer", authority.key().as_ref()],
        bump
    )]
    pub producer: Account<'info, EnergyProducer>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintEnergy<'info> {
    #[account(
        mut,
        seeds = [b"producer", authority.key().as_ref()],
        bump
    )]
    pub producer: Account<'info, EnergyProducer>,
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"vault", mint.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = authority,
    )]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Vault {
    pub mint: Pubkey,
    pub authority: Pubkey,
}

impl Vault {
    pub const LEN: usize = 32 + 32;
}

#[account]
pub struct EnergyProducer {
    pub authority: Pubkey,
    pub device_id: Pubkey,
    pub nonce: u64,
    pub energy_wh: u64,
    pub timestamp: i64,
    pub signature: [u8; 64],
    pub is_initialized: bool,
    pub max_power_w: u64,
}

impl EnergyProducer {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 64 + 1 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Proof {
    pub nonce: u64,
    pub timestamp: i64,
    pub energy_wh: u64,
    pub signature: [u8; 64],
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Stale proof")]
    StaleProof,
    #[msg("Invalid signature")]
    InvalidSignature,
    #[msg("Excessive energy")]
    ExcessiveEnergy,
    #[msg("Invalid nonce")]
    InvalidNonce,
}