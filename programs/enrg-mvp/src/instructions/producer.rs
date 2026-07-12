use anchor_lang::prelude::*;

use crate::state::*;

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

pub fn create_producer(
    ctx: Context<CreateProducer>,
    device_id: Pubkey,
    max_power_w: u64,
) -> Result<()> {

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
        "Producer registered: {} ({})",
        producer.authority,
        producer.device_id
    );

    Ok(())
}
