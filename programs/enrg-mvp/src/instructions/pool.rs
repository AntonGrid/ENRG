use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Pool::LEN,
        seeds = [b"pool", authority.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinPool<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.authority.as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [b"producer", authority.key().as_ref()],
        bump
    )]
    pub producer: Account<'info, EnergyProducer>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn create_pool(
    ctx: Context<CreatePool>,
    threshold: u64,
) -> Result<()> {

    let pool = &mut ctx.accounts.pool;

    pool.authority = ctx.accounts.authority.key();
    pool.total_energy = 0;

    pool.threshold = if threshold == 0 {
        DEFAULT_POOL_THRESHOLD
    } else {
        threshold as u128
    };

    pool.producers = Vec::new();
    pool.is_active = true;
    pool.created_at = Clock::get()?.unix_timestamp;

    Ok(())
}

pub fn join_pool(
    ctx: Context<JoinPool>,
) -> Result<()> {

    let pool = &mut ctx.accounts.pool;

    let producer = ctx.accounts.producer.key();

    require!(
        !pool.producers.contains(&producer),
        ErrorCode::AlreadyInPool
    );

    require!(
        pool.producers.len() < Pool::MAX_PRODUCERS,
        ErrorCode::InvalidParameter
    );

    pool.producers.push(producer);

    emit!(PoolJoined {
        pool: pool.key(),
        producer,
    });

    Ok(())
}

// ══════════════════════════════════════════════════════════════
//  DISTRIBUTE POOL (v7.0 §14)
// ══════════════════════════════════════════════════════════════
//  При pool.total_energy >= pool.threshold (по умолчанию 1 МВт·ч) награда
//  распределяется ПРОПОРЦИОНАЛЬНО вкладу участников. Каждый участник
//  передаётся группой из 4 remaining-аккаунтов:
//    [producer, pool_share (PDA [b"pool-share", pool, producer]),
//     member_ata, reputation]
//  Доли взвешиваются ERS-бонусом (v7.0 §16) и нормализуются так, что
//  сумма выплат == total_reward (сумма долей = 100%).
#[derive(Accounts)]
pub struct DistributePool<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.authority.as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,

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

    /// CHECK: Mint Authority PDA — signer для token::mint_to (seeds).
    #[account(
        seeds = [b"mint-authority"],
        bump = token_mint.mint_authority_bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,

    /// Инициатор — pool authority.
    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn distribute_pool<'info>(
    ctx: Context<'_, '_, 'info, 'info, DistributePool<'info>>,
) -> Result<()> {
    use anchor_spl::token::TokenAccount;

    require!(
        ctx.accounts.authority.key() == ctx.accounts.pool.authority,
        ErrorCode::Unauthorized
    );

    let pool = &mut ctx.accounts.pool;
    require!(
        crate::state::pool::pool_threshold_reached(pool.total_energy, pool.threshold),
        ErrorCode::PoolThresholdNotReached
    );

    let members = pool.producers.len();
    require!(members > 0, ErrorCode::InvalidParameter);

    let ra = ctx.remaining_accounts;
    require!(ra.len() == members * 4, ErrorCode::InvalidParameter);

    // ── Pass 1: weighted shares (вклад × ERS-бонус) ──
    let energy_total = pool.total_energy;
    let mut weighted_sum: u128 = 0;
    let mut rewards: Vec<u64> = Vec::with_capacity(members);
    let mut atas: Vec<Pubkey> = Vec::with_capacity(members);

    for i in 0..members {
        let producer_info = &ra[i * 4];
        let share_info = &ra[i * 4 + 1];
        let ata_info = &ra[i * 4 + 2];
        let rep_info = &ra[i * 4 + 3];

        let producer = Account::<EnergyProducer>::try_from(producer_info)?;
        let share = Account::<PoolContribution>::try_from(share_info)?;
        let ata = Account::<TokenAccount>::try_from(ata_info)?;
        let reputation = Account::<Reputation>::try_from(rep_info)?;

        require!(pool.producers.contains(&producer.key()), ErrorCode::NotInPool);
        require!(share.pool == pool.key(), ErrorCode::InvalidParameter);
        require!(share.producer == producer.key(), ErrorCode::InvalidParameter);
        require!(reputation.authority == producer.authority, ErrorCode::InvalidParameter);
        require!(ata.owner == producer.authority, ErrorCode::UnauthorizedTokenAccountOwner);
        require!(ata.mint == ctx.accounts.mint.key(), ErrorCode::DestinationMintMismatch);

        let (canonical, _) = Pubkey::find_program_address(
            &[b"pool-share", pool.key().as_ref(), producer.key().as_ref()],
            ctx.program_id,
        );
        require!(share.key() == canonical, ErrorCode::InvalidParameter);

        let bonus = crate::state::reputation::ers_pool_bonus_fp(reputation.score);
        let raw = crate::state::pool::pool_share_fp(share.energy_wh, energy_total);
        let weighted = raw
            .checked_add(crate::math::fp_mul(bonus, raw))
            .unwrap_or(u128::MAX);
        weighted_sum = weighted_sum.checked_add(weighted).unwrap_or(u128::MAX);

        atas.push(ata.key());
        rewards.push(0);
    }
    require!(weighted_sum > 0, ErrorCode::InvalidParameter);

    // ── Награда пула и supply-cap ──
    let total_reward = crate::math::calculate_reward(
        energy_total.min(u64::MAX as u128) as u64,
        ctx.accounts.vault.total_supply,
    );
    require!(total_reward > 0, ErrorCode::ZeroAmountMint);

    let new_supply = ctx
        .accounts
        .vault
        .total_supply
        .checked_add(total_reward)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(new_supply <= ctx.accounts.vault.max_supply, ErrorCode::SupplyLimitExceeded);

    // ── Pass 2: выплаты (последний участник забирает остаток) ──
    let mint_authority_seeds = &[
        b"mint-authority".as_ref(),
        &[ctx.accounts.token_mint.mint_authority_bump],
    ];
    let signer_seeds = &[&mint_authority_seeds[..]];

    let mut distributed: u64 = 0;
    for i in 0..members {
        let share_info = &ra[i * 4 + 1];
        let share = Account::<PoolContribution>::try_from(share_info)?;
        let rep_info = &ra[i * 4 + 3];
        let reputation = Account::<Reputation>::try_from(rep_info)?;

        let bonus = crate::state::reputation::ers_pool_bonus_fp(reputation.score);
        let raw = crate::state::pool::pool_share_fp(share.energy_wh, energy_total);
        let weighted = raw
            .checked_add(crate::math::fp_mul(bonus, raw))
            .unwrap_or(u128::MAX);
        let share_of_total = weighted
            .checked_mul(crate::math::FP_SCALE)
            .map(|v| v / weighted_sum)
            .unwrap_or(0);

        let mut reward = crate::state::pool::pool_reward_for_share(total_reward, share_of_total);
        if i == members - 1 {
            reward = total_reward.saturating_sub(distributed);
        }
        distributed = distributed.saturating_add(reward);
        rewards[i] = reward;

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ra[i * 4 + 2].to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                signer_seeds,
            ),
            reward,
        )?;
    }




    // ── Сброс вкладов участников ──
    for i in 0..members {
        let share_info = &ra[i * 4 + 1];
        let mut share = Account::<PoolContribution>::try_from(share_info)?;
        share.energy_wh = 0;
        share.updated_at = Clock::get()?.unix_timestamp;
    }

    // ── Итоги распределения ──
    ctx.accounts.vault.total_supply = new_supply;
    pool.total_energy = 0;

    emit!(PoolDistributed {
        pool: pool.key(),
        total_energy: energy_total,
        total_reward,
        members: members as u32,
    });

    msg!(
        "Pool distributed: {} Wh -> {} SRC across {} members",
        energy_total,
        total_reward,
        members
    );

    Ok(())
}
