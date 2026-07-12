use anchor_lang::prelude::*;

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

    pool.producers.push(producer);

    Ok(())
}
