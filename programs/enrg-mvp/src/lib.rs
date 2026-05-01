use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount},
};

declare_id!("FczG4xFGPmCPAhZVqwVnKu5RXC3VytC5w4MPVDkFjXiN");

#[program]
pub mod enrg_mvp {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.mint = ctx.accounts.mint.key();
        vault.authority = ctx.accounts.authority.key();
        Ok(())
    }

    pub fn create_producer(ctx: Context<CreateProducer>, device_id: Pubkey) -> Result<()> {
        let producer = &mut ctx.accounts.producer;
        producer.authority = ctx.accounts.authority.key();
        producer.device_id = device_id;
        producer.nonce = 0;
        producer.energy_wh = 0;
        producer.timestamp = 0;
        producer.signature = [0u8; 64];
        producer.is_initialized = true;
        msg!("Producer registered: {} with device {}", producer.authority, device_id);
        Ok(())
    }

    pub fn add_energy(ctx: Context<AddEnergy>, amount: u64) -> Result<()> {
        let producer = &mut ctx.accounts.producer;

        require_keys_eq!(
            producer.authority,
            ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );

        // Пока просто накапливаем энергию, полная проверка Proof будет добавлена позже
        producer.energy_wh += amount;
        producer.nonce += 1;
        producer.timestamp = Clock::get()?.unix_timestamp;

        // Минтинг ENRG токенов
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
        token::mint_to(cpi_ctx, amount)?;

        msg!(
            "Energy added: {} Wh. Total: {} Wh. Minted {} ENRG",
            amount,
            producer.energy_wh,
            amount
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
pub struct AddEnergy<'info> {
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
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
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
}

impl EnergyProducer {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 64 + 1;
}

#[error_code]
pub enum ErrorCode {
    #[msg("Only the registered authority can add energy")]
    Unauthorized,
}
