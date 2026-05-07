use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, burn, Mint, Token, TokenAccount, Transfer as SplTransfer},
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
        msg!("Producer registered: {} with device {}", producer.authority, device_id);
        Ok(())
    }

    pub fn mint_energy(ctx: Context<MintEnergy>, proof: Proof) -> Result<()> {
        let producer = &mut ctx.accounts.producer;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        require_keys_eq!(producer.authority, ctx.accounts.authority.key(), ErrorCode::Unauthorized);
        require!((now - proof.timestamp).abs() <= 900, ErrorCode::StaleProof);
        require!(proof.nonce > producer.nonce, ErrorCode::InvalidNonce);

        // ✅ Правильная проверка Ed25519-подписи
        use solana_program::syscalls;
        let message = {
            let mut data = Vec::with_capacity(24);
            data.extend_from_slice(&proof.nonce.to_le_bytes());
            data.extend_from_slice(&proof.timestamp.to_le_bytes());
            data.extend_from_slice(&proof.energy_wh.to_le_bytes());
            data
        };
        let verified = syscalls::ed25519_verify(
            &proof.signature,
            &producer.device_id.to_bytes(),
            &message,
        );
        require!(verified, ErrorCode::InvalidSignature);

        let max_energy_per_interval = producer.max_power_w
            .checked_mul(10).unwrap()
            .checked_div(60).unwrap();
        require!(proof.energy_wh <= max_energy_per_interval, ErrorCode::ExcessiveEnergy);

        producer.nonce = proof.nonce;
        producer.timestamp = now;
        producer.energy_wh = producer.energy_wh.checked_add(proof.energy_wh).unwrap();
        producer.signature = proof.signature;

        let total_mint = proof.energy_wh;
        let user_amount = total_mint.checked_mul(85).unwrap().checked_div(100).unwrap();
        let commission = total_mint.checked_sub(user_amount).unwrap();

        let buyback_amount = commission.checked_mul(20).unwrap().checked_div(100).unwrap();
        let staking_amount = commission.checked_mul(40).unwrap().checked_div(100).unwrap();
        let dao_amount = commission.checked_mul(30).unwrap().checked_div(100).unwrap();
        let emergency_amount = commission.checked_sub(buyback_amount).unwrap()
            .checked_sub(staking_amount).unwrap()
            .checked_sub(dao_amount).unwrap();

        let mint_key = ctx.accounts.mint.key();
        let vault_bump = ctx.bumps.vault;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", mint_key.as_ref(), &[vault_bump]]];

        // Минтим пользователю
        token::mint_to(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ), user_amount)?;

        // Минтим на уникальные PDA каждого фонда
        token::mint_to(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.buyback_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ), buyback_amount)?;

        token::mint_to(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.staking_pool.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ), staking_amount)?;

        token::mint_to(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.dao_reserve.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ), dao_amount)?;

        token::mint_to(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.emergency_fund.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ), emergency_amount)?;

        msg!("Minted {} ENRG (user={}, buyback={}, staking={}, dao={}, emergency={})",
            total_mint, user_amount, buyback_amount, staking_amount, dao_amount, emergency_amount);
        Ok(())
    }

    pub fn buyback_and_burn(ctx: Context<BuybackBurn>, amount: u64) -> Result<()> {
        let vault_bump = ctx.bumps.vault;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", ctx.accounts.mint.key().as_ref(), &[vault_bump]]];
        let cpi_burn = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.buyback_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        );
        burn(cpi_burn, amount)?;
        msg!("Buyback & Burn: burned {} ENRG", amount);
        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        let stake_info = &mut ctx.accounts.stake_info;
        stake_info.owner = ctx.accounts.user.key();
        stake_info.staked_amount = stake_info.staked_amount.checked_add(amount).unwrap();
        let cpi_transfer = CpiContext::new(
            ctx.accounts.token_program.key(),
            SplTransfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.staking_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi_transfer, amount)?;
        msg!("Staked {} ENRG", amount);
        Ok(())
    }

    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        let stake_info = &mut ctx.accounts.stake_info;
        require!(stake_info.staked_amount >= amount, ErrorCode::InsufficientStake);
        stake_info.staked_amount = stake_info.staked_amount.checked_sub(amount).unwrap();
        let vault_bump = ctx.bumps.staking_vault;
        let signer_seeds: &[&[&[u8]]] = &[&[b"staking-vault", &[vault_bump]]];
        let cpi_transfer = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            SplTransfer {
                from: ctx.accounts.staking_vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.staking_vault.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_transfer, amount)?;
        msg!("Unstaked {} ENRG", amount);
        Ok(())
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        let pool = &ctx.accounts.staking_pool;
        let user_stake = &ctx.accounts.stake_info;
        let total_staked = ctx.accounts.staking_pool.amount;
        require!(total_staked > 0 && user_stake.staked_amount > 0, ErrorCode::NoStake);
        let reward = pool.amount.checked_mul(user_stake.staked_amount).unwrap().checked_div(total_staked).unwrap();
        if reward > 0 {
            let pool_bump = ctx.bumps.staking_pool;
            let signer_seeds: &[&[&[u8]]] = &[&[b"staking-pool", ctx.accounts.mint.key().as_ref(), &[pool_bump]]];
            let cpi_transfer = CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.staking_pool.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.staking_pool.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(cpi_transfer, reward)?;
            msg!("Claimed {} ENRG reward", reward);
        }
        Ok(())
    }

    pub fn claim_vested(ctx: Context<ClaimVested>) -> Result<()> {
        let vesting = &mut ctx.accounts.vesting;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        let cliff_end = vesting.start_time.checked_add(31_536_000).unwrap();
        require!(now >= cliff_end, ErrorCode::CliffNotReached);
        let vesting_end = cliff_end.checked_add(94_608_000).unwrap();
        let total_duration = vesting_end.checked_sub(cliff_end).unwrap();
        let elapsed = now.checked_sub(cliff_end).unwrap().min(total_duration);
        let total_vested = vesting.total_amount.checked_mul(elapsed as u64).unwrap().checked_div(total_duration as u64).unwrap();
        let new_claimable = total_vested.checked_sub(vesting.withdrawn).unwrap();
        require!(new_claimable > 0, ErrorCode::NothingToClaim);
        vesting.withdrawn = vesting.withdrawn.checked_add(new_claimable).unwrap();
        let seeds: &[&[u8]] = &[b"founder-vesting", ctx.accounts.founder.key().as_ref(), &[ctx.bumps.vesting]];
        let signer_seeds: &[&[&[u8]]] = &[seeds];
        let cpi_transfer = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            SplTransfer {
                from: ctx.accounts.vesting_vault.to_account_info(),
                to: ctx.accounts.founder_token_account.to_account_info(),
                authority: ctx.accounts.vesting.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_transfer, new_claimable)?;
        msg!("Claimed {} ENRG vesting", new_claimable);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(init, payer = authority, space = 8 + Vault::LEN, seeds = [b"vault", mint.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateProducer<'info> {
    #[account(init, payer = authority, space = 8 + EnergyProducer::LEN, seeds = [b"producer", authority.key().as_ref()], bump)]
    pub producer: Account<'info, EnergyProducer>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintEnergy<'info> {
    #[account(mut, seeds = [b"producer", authority.key().as_ref()], bump)]
    pub producer: Account<'info, EnergyProducer>,
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [b"vault", mint.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(init_if_needed, payer = authority, associated_token::mint = mint, associated_token::authority = authority)]
    pub destination: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        seeds = [b"buyback", mint.key().as_ref()],
        token::mint = mint,
        token::authority = vault,
        bump
    )]
    pub buyback_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        seeds = [b"staking", mint.key().as_ref()],
        token::mint = mint,
        token::authority = vault,
        bump
    )]
    pub staking_pool: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        seeds = [b"dao", mint.key().as_ref()],
        token::mint = mint,
        token::authority = vault,
        bump
    )]
    pub dao_reserve: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        seeds = [b"emergency", mint.key().as_ref()],
        token::mint = mint,
        token::authority = vault,
        bump
    )]
    pub emergency_fund: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuybackBurn<'info> {
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault)]
    pub buyback_account: Account<'info, TokenAccount>,
    #[account(seeds = [b"vault", mint.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(init_if_needed, payer = user, space = 8 + StakeInfo::LEN, seeds = [b"stake", user.key().as_ref()], bump)]
    pub stake_info: Account<'info, StakeInfo>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = user)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"staking-vault", mint.key().as_ref()], bump)]
    pub staking_vault: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut, seeds = [b"stake", user.key().as_ref()], bump)]
    pub stake_info: Account<'info, StakeInfo>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = user)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"staking-vault", mint.key().as_ref()], bump)]
    pub staking_vault: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut, seeds = [b"stake", user.key().as_ref()], bump)]
    pub stake_info: Account<'info, StakeInfo>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = user)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"staking", mint.key().as_ref()], bump)]
    pub staking_pool: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimVested<'info> {
    #[account(mut, seeds = [b"founder-vesting"], bump)]
    pub vesting: Account<'info, FounderVesting>,
    #[account(mut, seeds = [b"vesting-vault", mint.key().as_ref()], bump)]
    pub vesting_vault: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = founder)]
    pub founder_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub founder: Signer<'info>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Vault { pub mint: Pubkey, pub authority: Pubkey, }
impl Vault { pub const LEN: usize = 32 + 32; }

#[account]
pub struct EnergyProducer {
    pub authority: Pubkey, pub device_id: Pubkey,
    pub nonce: u64, pub energy_wh: u64, pub timestamp: i64,
    pub signature: [u8; 64], pub is_initialized: bool, pub max_power_w: u64,
}
impl EnergyProducer { pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 64 + 1 + 8; }

#[account]
pub struct StakeInfo { pub owner: Pubkey, pub staked_amount: u64, }
impl StakeInfo { pub const LEN: usize = 32 + 8; }

#[account]
pub struct FounderVesting { pub total_amount: u64, pub start_time: i64, pub withdrawn: u64, pub founder: Pubkey, }
impl FounderVesting { pub const LEN: usize = 8 + 8 + 8 + 32; }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Proof {
    pub nonce: u64, pub timestamp: i64, pub energy_wh: u64, pub signature: [u8; 64],
}

#[error_code]
pub enum ErrorCode {
    Unauthorized, StaleProof, InvalidSignature, ExcessiveEnergy,
    InvalidNonce, InsufficientStake, NoStake, CliffNotReached, NothingToClaim,
}
