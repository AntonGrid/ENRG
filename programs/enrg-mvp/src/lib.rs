#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, burn, Mint, Token, TokenAccount, Transfer as SplTransfer},
};

declare_id!("8JEw3eD7NgboNYcQQwoSsTG7UF8RrQpRnJzouDr6XQ8a");

const ENRG_DECIMALS: u8 = 9;
const ENRG_BASIS: u64 = 10u64.pow(ENRG_DECIMALS as u32 - 6); // 1000
const COMMISSION_PERCENT: u64 = 15;
const BUYBACK_PERCENT: u64 = 20;
const STAKING_PERCENT: u64 = 40;
const DAO_PERCENT: u64 = 30;

// Асимптотическая модель эмиссии (раздел 23 спецификации)
const MAX_SUPPLY: u64 = 1_000_000_000; // 1 млрд ENRG
const EMISSION_DIFFICULTY_K: u64 = 10; // Коэффициент сложности
const ENERGY_PER_TOKEN_BASE: u64 = 1_000_000; // 1 МВт·ч в Wh

#[program]
pub mod enrg_mvp {
    use super::*;

    // === ПУЛЫ ===
    pub fn create_pool(ctx: Context<CreatePool>, threshold: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.total_energy = 0;
        pool.threshold = threshold as u128;
        pool.producers = Vec::new();
        pool.is_active = true;
        pool.created_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn join_pool(ctx: Context<JoinPool>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let producer = &ctx.accounts.producer;
        if pool.producers.contains(&producer.key()) {
            return Err(ErrorCode::AlreadyInPool.into());
        }
        pool.producers.push(producer.key());
        Ok(())
    }

    // === ОСНОВНЫЕ ИНСТРУКЦИИ ===
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        if vault.deployer == Pubkey::default() {
            vault.deployer = ctx.accounts.authority.key();
        } else {
            require_keys_eq!(
                vault.deployer,
                ctx.accounts.authority.key(),
                ErrorCode::Unauthorized
            );
        }
        vault.mint = ctx.accounts.mint.key();
        vault.authority = ctx.accounts.authority.key();
        Ok(())
    }

    pub fn initialize_funds(_ctx: Context<InitializeFunds>) -> Result<()> {
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
        require!((now - proof.timestamp).unsigned_abs() <= 900, ErrorCode::StaleProof);
        require!(proof.nonce > producer.nonce, ErrorCode::InvalidNonce);

        // Проверка подписи (пока заглушка, будет доработана)
        let verified = true;
        require!(verified, ErrorCode::InvalidSignature);

        // Проверка, что mint authority = vault PDA
        require!(
            match ctx.accounts.mint.mint_authority {
                anchor_lang::solana_program::program_option::COption::Some(auth) => auth == ctx.accounts.vault.key(),
                _ => false,
            },
            ErrorCode::Unauthorized
        );

        let max_energy_wh = producer.max_power_w
            .checked_mul(10)
            .and_then(|x| x.checked_div(60))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(proof.energy_wh <= max_energy_wh, ErrorCode::ExcessiveEnergy);
        require!(proof.energy_wh > 0, ErrorCode::ZeroAmountMint);

        // Асимптотическая эмиссия
        let current_supply = ctx.accounts.mint.supply;
        require!(current_supply < MAX_SUPPLY, ErrorCode::MaxSupplyReached);
        let energy_per_token_u128 = calculate_energy_per_token(current_supply, EMISSION_DIFFICULTY_K)?;
        let energy_per_token = if energy_per_token_u128 > u64::MAX as u128 {
            return Err(ErrorCode::ExcessiveEnergyRequired.into());
        } else {
            energy_per_token_u128 as u64
        };
        require!(proof.energy_wh >= energy_per_token, ErrorCode::InsufficientEnergy);
        let tokens_to_mint = proof.energy_wh
            .checked_div(energy_per_token)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(tokens_to_mint > 0, ErrorCode::ZeroAmountMint);

        producer.nonce = proof.nonce;
        producer.timestamp = now;
        producer.energy_wh = producer.energy_wh
            .checked_add(proof.energy_wh)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        producer.signature = proof.signature;

        let total_mint = tokens_to_mint
            .checked_mul(ENRG_BASIS)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let user_amount = total_mint
            .checked_mul(100 - COMMISSION_PERCENT)
            .and_then(|x| x.checked_div(100))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let commission = total_mint
            .checked_sub(user_amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let buyback_amount = commission
            .checked_mul(BUYBACK_PERCENT)
            .and_then(|x| x.checked_div(100))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let staking_amount = commission
            .checked_mul(STAKING_PERCENT)
            .and_then(|x| x.checked_div(100))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let dao_amount = commission
            .checked_mul(DAO_PERCENT)
            .and_then(|x| x.checked_div(100))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let emergency_amount = commission
            .checked_sub(buyback_amount)
            .and_then(|x| x.checked_sub(staking_amount))
            .and_then(|x| x.checked_sub(dao_amount))
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let supply_fraction = (current_supply as u128)
            .saturating_mul(10_u128.pow(18))
            .checked_div(MAX_SUPPLY as u128)
            .unwrap_or(0);

        emit!(EmissionDifficultyChanged {
            current_supply,
            supply_fraction,
            energy_per_token: energy_per_token_u128,
        });

        let vault_bump = ctx.bumps.vault;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", &[vault_bump]]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            user_amount,
        )?;
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.buyback_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            buyback_amount,
        )?;
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.staking_pool.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            staking_amount,
        )?;
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.dao_reserve.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            dao_amount,
        )?;
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.emergency_fund.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            emergency_amount,
        )?;

        msg!("Minted {} tokens (energy_per_token={}Wh, supply={}/{})",
            tokens_to_mint, energy_per_token, current_supply, MAX_SUPPLY);
        Ok(())
    }

    pub fn buyback_and_burn(ctx: Context<BuybackBurn>, amount: u64) -> Result<()> {
        let vault_bump = ctx.bumps.vault;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", &[vault_bump]]];
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
        msg!("Buyback & Burn: burned {} base units", amount);
        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        let stake_info = &mut ctx.accounts.stake_info;
        if stake_info.owner == Pubkey::default() {
            stake_info.owner = ctx.accounts.user.key();
        } else {
            require_keys_eq!(stake_info.owner, ctx.accounts.user.key(), ErrorCode::Unauthorized);
        }
        stake_info.staked_amount = stake_info.staked_amount
            .checked_add(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let cpi_transfer = CpiContext::new(
            ctx.accounts.token_program.key(),
            SplTransfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.staking_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi_transfer, amount)?;
        msg!("Staked {} base units", amount);
        Ok(())
    }

    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        let stake_info = &mut ctx.accounts.stake_info;
        require!(stake_info.staked_amount >= amount, ErrorCode::InsufficientStake);
        stake_info.staked_amount = stake_info.staked_amount
            .checked_sub(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
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
        msg!("Unstaked {} base units", amount);
        Ok(())
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        let pool = &ctx.accounts.staking_pool;
        let user_stake = &ctx.accounts.stake_info;
        let total_staked = ctx.accounts.staking_vault.amount;
        require!(total_staked > 0 && user_stake.staked_amount > 0, ErrorCode::NoStake);
        let reward = pool.amount
            .checked_mul(user_stake.staked_amount)
            .and_then(|x| x.checked_div(total_staked))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(reward <= pool.amount, ErrorCode::ArithmeticOverflow);
        if reward > 0 {
            let pool_bump = ctx.bumps.staking_pool;
            let signer_seeds: &[&[&[u8]]] = &[&[b"staking", &[pool_bump]]];
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
            msg!("Claimed {} base units reward", reward);
        }
        Ok(())
    }

    pub fn initialize_founder_vesting(
        ctx: Context<InitializeFounderVesting>,
        total_amount: u64,
    ) -> Result<()> {
        let vesting = &mut ctx.accounts.vesting;
        let clock = Clock::get()?;
        vesting.founder = ctx.accounts.founder.key();
        vesting.total_amount = total_amount;
        vesting.start_time = clock.unix_timestamp;
        vesting.withdrawn = 0;
        Ok(())
    }

    pub fn claim_vested(ctx: Context<ClaimVested>) -> Result<()> {
        let vesting = &mut ctx.accounts.vesting;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        let cliff_end = vesting.start_time
            .checked_add(31_536_000)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(now >= cliff_end, ErrorCode::CliffNotReached);

        let vesting_end = cliff_end
            .checked_add(94_608_000)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let total_duration = vesting_end
            .checked_sub(cliff_end)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let elapsed = now
            .checked_sub(cliff_end)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .min(total_duration);

        let elapsed_u64: u64 = elapsed.try_into().map_err(|_| ErrorCode::ArithmeticOverflow)?;
        let total_duration_u64: u64 = total_duration.try_into().map_err(|_| ErrorCode::ArithmeticOverflow)?;

        let total_vested = vesting.total_amount
            .checked_mul(elapsed_u64)
            .and_then(|x| x.checked_div(total_duration_u64))
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let new_claimable = total_vested
            .checked_sub(vesting.withdrawn)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(new_claimable > 0, ErrorCode::NothingToClaim);

        vesting.withdrawn = vesting.withdrawn
            .checked_add(new_claimable)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let vesting_bump = ctx.bumps.vesting;
        let founder_key = ctx.accounts.founder.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"founder-vesting",
            founder_key.as_ref(),
            &[vesting_bump],
        ]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.vesting_vault.to_account_info(),
                    to: ctx.accounts.founder_token_account.to_account_info(),
                    authority: ctx.accounts.vesting.to_account_info(),
                },
                signer_seeds,
            ),
            new_claimable,
        )?;

        msg!("Claimed {} base units vesting", new_claimable);
        Ok(())
    }
}

// === АСИМПТОТИЧЕСКАЯ МОДЕЛЬ ЭМИССИИ ===
fn calculate_energy_per_token(current_supply: u64, k: u64) -> Result<u128> {
    let current_supply_u128 = current_supply as u128;
    let max_supply_u128 = MAX_SUPPLY as u128;
    let s_scaled = current_supply_u128
        .checked_mul(10_u128.pow(18))
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(max_supply_u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let log_k_scaled = match k {
        10 => 2_302_585_092_994_045_684u128,
        3 => 1_098_612_288_668_109_691u128,
        5 => 1_609_437_912_434_100_374u128,
        _ => return Err(ErrorCode::InvalidParameter.into()),
    };
    let exponent = s_scaled
        .checked_mul(log_k_scaled)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(10_u128.pow(18))
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let power_k_s = exp_approx(exponent)?;
    (ENERGY_PER_TOKEN_BASE as u128)
        .checked_mul(power_k_s)
        .ok_or(ErrorCode::ArithmeticOverflow.into())
}

fn exp_approx(x_scaled: u128) -> Result<u128> {
    if x_scaled == 0 {
        return Ok(10_u128.pow(18));
    }
    if x_scaled > 10_u128.pow(19) {
        return Err(ErrorCode::ExcessiveEnergyRequired.into());
    }
    let mut result = 10_u128.pow(18);
    let mut term = 10_u128.pow(18);
    for n in 1..=20 {
        term = term
            .checked_mul(x_scaled)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_div(n as u128 * 10_u128.pow(18))
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        result = result
            .checked_add(term)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        if term < 10_u128.pow(12) {
            break;
        }
    }
    Ok(result)
}

// === Account structs ===
#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(init_if_needed, payer = authority, space = 8 + Vault::LEN, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeFunds<'info> {
    #[account(init, payer = authority, seeds = [b"buyback", mint.key().as_ref()], token::mint = mint, token::authority = vault, bump)]
    pub buyback_account: Account<'info, TokenAccount>,
    #[account(init, payer = authority, seeds = [b"staking", mint.key().as_ref()], token::mint = mint, token::authority = vault, bump)]
    pub staking_pool: Account<'info, TokenAccount>,
    #[account(init, payer = authority, seeds = [b"dao", mint.key().as_ref()], token::mint = mint, token::authority = vault, bump)]
    pub dao_reserve: Account<'info, TokenAccount>,
    #[account(init, payer = authority, seeds = [b"emergency", mint.key().as_ref()], token::mint = mint, token::authority = vault, bump)]
    pub emergency_fund: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    #[account(seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
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
    #[account(seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(init_if_needed, payer = authority, associated_token::mint = mint, associated_token::authority = authority)]
    pub destination: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"buyback", mint.key().as_ref()], bump)]
    pub buyback_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"staking", mint.key().as_ref()], bump)]
    pub staking_pool: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"dao", mint.key().as_ref()], bump)]
    pub dao_reserve: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"emergency", mint.key().as_ref()], bump)]
    pub emergency_fund: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuybackBurn<'info> {
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"buyback", mint.key().as_ref()], bump, token::mint = mint, token::authority = vault)]
    pub buyback_account: Account<'info, TokenAccount>,
    #[account(seeds = [b"vault"], bump)]
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
    #[account(init_if_needed, payer = user, seeds = [b"staking-vault", mint.key().as_ref()], token::mint = mint, token::authority = staking_vault, bump)]
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
    #[account(mut, seeds = [b"staking-vault", mint.key().as_ref()], bump)]
    pub staking_vault: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct InitializeFounderVesting<'info> {
    #[account(init, payer = founder, space = 8 + FounderVesting::LEN, seeds = [b"founder-vesting", founder.key().as_ref()], bump)]
    pub vesting: Account<'info, FounderVesting>,
    #[account(init_if_needed, payer = founder, seeds = [b"vesting-vault", mint.key().as_ref()], token::mint = mint, token::authority = vesting, bump)]
    pub vesting_vault: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub founder: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimVested<'info> {
    #[account(mut, seeds = [b"founder-vesting", founder.key().as_ref()], bump)]
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

// === ПУЛЫ (структуры аккаунтов) ===
#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(init, payer = authority, space = 8 + Pool::LEN, seeds = [b"pool", authority.key().as_ref(), &[0]], bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinPool<'info> {
    #[account(mut, seeds = [b"pool", pool.authority.as_ref(), &[0]], bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"producer", authority.key().as_ref()], bump)]
    pub producer: Account<'info, EnergyProducer>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// === АККАУНТЫ ДЛЯ ХРАНЕНИЯ ===
#[account]
pub struct Vault {
    pub deployer: Pubkey,
    pub mint: Pubkey,
    pub authority: Pubkey,
}
impl Vault { pub const LEN: usize = 32 + 32 + 32; }

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
impl EnergyProducer { pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 64 + 1 + 8; }

#[account]
pub struct Pool {
    pub authority: Pubkey,
    pub total_energy: u128,
    pub threshold: u128,
    pub producers: Vec<Pubkey>,
    pub is_active: bool,
    pub created_at: i64,
}
impl Pool {
    pub const LEN: usize = 32 + 16 + 16 + 4 + 100 * 32 + 1 + 8;
}

#[account]
pub struct StakeInfo {
    pub owner: Pubkey,
    pub staked_amount: u64,
}
impl StakeInfo { pub const LEN: usize = 32 + 8; }

#[account]
pub struct FounderVesting {
    pub founder: Pubkey,
    pub total_amount: u64,
    pub start_time: i64,
    pub withdrawn: u64,
}
impl FounderVesting { pub const LEN: usize = 32 + 8 + 8 + 8; }

// === ВСПОМОГАТЕЛЬНЫЕ СТРУКТУРЫ ===
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Proof {
    pub nonce: u64,
    pub timestamp: i64,
    pub energy_wh: u64,
    pub signature: [u8; 64],
}

// === СОБЫТИЯ ===
#[event]
pub struct EmissionDifficultyChanged {
    pub current_supply: u64,
    pub supply_fraction: u128,
    pub energy_per_token: u128,
}

// === ОШИБКИ ===
#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized signer")]
    Unauthorized,
    #[msg("Proof is too old")]
    StaleProof,
    #[msg("Invalid Ed25519 signature")]
    InvalidSignature,
    #[msg("Energy reading exceeds maximum allowed for device power rating")]
    ExcessiveEnergy,
    #[msg("Nonce must be greater than previous nonce")]
    InvalidNonce,
    #[msg("Insufficient stake to withdraw")]
    InsufficientStake,
    #[msg("No staked amount or staking pool empty")]
    NoStake,
    #[msg("1-year cliff period has not passed")]
    CliffNotReached,
    #[msg("No vested tokens available to claim at this time")]
    NothingToClaim,
    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,
    #[msg("Mint amount must be greater than zero")]
    ZeroAmountMint,
    #[msg("Invalid parameter (k must be 3, 5, or 10)")]
    InvalidParameter,
    #[msg("Excessive energy required, minting impossible")]
    ExcessiveEnergyRequired,
    #[msg("Insufficient energy to mint at current difficulty")]
    InsufficientEnergy,
    #[msg("Maximum supply of 1 billion ENRG reached")]
    MaxSupplyReached,
    #[msg("Producer is already in the pool")]
    AlreadyInPool,
}
