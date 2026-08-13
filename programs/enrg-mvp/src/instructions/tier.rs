use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::*;

/// Назначение/смена tier устройства (v7.0 §15 — Device Trust Levels).
///
/// Тир назначается **протокольным администратором** (Vault authority):
/// tier — это уровень доверия, а не самодекларация владельца. Меняя тир,
/// администратор сбрасывает месячный счётчик энергии (новый лимит).
#[derive(Accounts)]
pub struct SetDeviceTier<'info> {
    #[account(
        seeds = [b"vault"],
        bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [b"producer", producer.device_id.as_ref()],
        bump
    )]
    pub producer: Account<'info, EnergyProducer>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn set_device_tier(ctx: Context<SetDeviceTier>, tier: DeviceTier) -> Result<()> {
    // tier — не может быть «снят»; Basic/Verified/Industrial/Institutional.
    let producer = &mut ctx.accounts.producer;

    producer.tier = tier;
    // Новый тир — новый лимит: сбрасываем месячное окно.
    let now = Clock::get()?.unix_timestamp;
    producer.month_energy_wh = 0;
    producer.month_start_ts = now;

    emit!(DeviceTierSet {
        producer: producer.key(),
        tier,
        changed_by: ctx.accounts.authority.key(),
    });

    msg!("Device tier set to {:?} for {}", tier, producer.key());
    Ok(())
}
