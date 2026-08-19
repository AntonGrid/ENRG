use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::*;

/// Assign/change a device tier (v7.0 §15 — Device Trust Levels).
///
/// The tier is assigned by the **protocol administrator** (Vault authority):
/// the tier is a trust level, not an owner self-declaration. When changing a
/// tier, the administrator resets the monthly energy counter (new limit).
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
    // The tier cannot be "removed"; Basic/Verified/Industrial/Institutional.
    let producer = &mut ctx.accounts.producer;

    producer.tier = tier;
    // New tier — new limit: reset the monthly window.
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
